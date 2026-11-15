import { AdapterError } from '../contract.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';

export type ItemPurpose = 'sales' | 'purchase';
export interface ErpItem {
  code: string;
  name: string;
}
interface ItemSource {
  name: string;
  item_name?: string;
  disabled: number;
  is_sales_item: number;
  is_purchase_item: number;
}

/** The picker and money preflight read the same ERP-owned catalog; no PMO-authored item authority. */
export async function listErpItems(
  client: ErpClientDeps,
  purpose: ItemPurpose,
): Promise<ErpItem[]> {
  const items: ErpItem[] = [];
  const pageSize = 200;
  for (let start = 0; ; start += pageSize) {
    const params = new URLSearchParams({
      fields: JSON.stringify([
        'name',
        'item_name',
        'disabled',
        'is_sales_item',
        'is_purchase_item',
      ]),
      filters: JSON.stringify([
        ['disabled', '=', 0],
        [`is_${purpose}_item`, '=', 1],
      ]),
      order_by: 'name asc',
      limit_start: String(start),
      limit_page_length: String(pageSize),
    });
    const result = (await erpnextRequest(client, {
      method: 'GET',
      path: `/api/resource/Item?${params}`,
    })) as { data?: ItemSource[] };
    if (!Array.isArray(result?.data))
      throw new AdapterError('external-unreachable', 'ERP item catalog could not be read');
    for (const row of result.data) {
      // Keep the authoritative filter even if an upstream endpoint ignores its query filters.
      if (
        typeof row.name === 'string' &&
        row.name &&
        row.disabled === 0 &&
        row[`is_${purpose}_item`] === 1
      ) {
        items.push({ code: row.name, name: row.item_name || row.name });
      }
    }
    if (result.data.length < pageSize) return items;
  }
}

/** #2116: codes per request — ~100 codes pushed the GET URL near 15 KB and the ERP call failed as unreachable. */
export const ITEM_CODE_BATCH_SIZE = 40;

/**
 * #2116: the money preflight's read — only the command's own codes, one filtered GET per ITEM_CODE_BATCH_SIZE distinct
 * codes, never the whole catalogue. Same authority as `listErpItems`: an enabled item of this purpose,
 * re-checked per row in case an upstream endpoint ignores the query filters (fail closed).
 */
export async function findErpItemsByCode(
  client: ErpClientDeps,
  purpose: ItemPurpose,
  codes: readonly unknown[],
): Promise<ErpItem[]> {
  const wanted = [...new Set(codes.filter((code): code is string => typeof code === 'string' && code !== ''))];
  const flag = `is_${purpose}_item` as const;
  const items: ErpItem[] = [];
  const chunkSize = ITEM_CODE_BATCH_SIZE;
  for (let offset = 0; offset < wanted.length; offset += chunkSize) {
    const chunk = wanted.slice(offset, offset + chunkSize);
    const params = new URLSearchParams({
      fields: JSON.stringify(['name', 'disabled', flag]),
      filters: JSON.stringify([
        ['name', 'in', chunk],
        ['disabled', '=', 0],
        [flag, '=', 1],
      ]),
      limit_start: '0',
      limit_page_length: String(chunk.length),
    });
    const result = (await erpnextRequest(client, {
      method: 'GET',
      path: `/api/resource/Item?${params}`,
    })) as { data?: Array<Partial<ItemSource>> };
    if (!Array.isArray(result?.data))
      throw new AdapterError('external-unreachable', 'ERP item catalog could not be read');
    for (const row of result.data) {
      if (typeof row.name === 'string' && chunk.includes(row.name) && row.disabled === 0 && row[flag] === 1) {
        items.push({ code: row.name, name: row.name });
      }
    }
  }
  return items;
}

export function validateItemLines(lines: readonly unknown[], catalog: readonly ErpItem[]): void {
  const codes = new Set(catalog.map((item) => item.code));
  for (const [index, line] of lines.entries()) {
    const code = (line as { item_code?: unknown } | null)?.item_code;
    if (typeof code !== 'string' || !codes.has(code)) {
      throw new AdapterError(
        'commit-rejected',
        `Line ${index + 1}: item "${typeof code === 'string' ? code : ''}" is not an enabled ERP item`,
      );
    }
  }
}
