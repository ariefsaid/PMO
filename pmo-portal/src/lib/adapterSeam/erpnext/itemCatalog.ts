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
