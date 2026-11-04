/** ERP-owned Odoo item choices for invoice and purchase lines. */
import type { OdooCall } from './client.ts';

export type OdooItemPurpose = 'sales' | 'purchase';
export interface OdooItemOption {
  code: string;
  name: string;
}

interface ProductRow {
  default_code?: unknown;
  name?: unknown;
  active?: unknown;
  sale_ok?: unknown;
  purchase_ok?: unknown;
  company_id?: unknown;
}

const PAGE_SIZE = 200;
const MAX_CATALOGUE_ITEMS = 2000;
const BASE_FIELDS = ['default_code', 'name', 'active'];

function belongsToCompany(value: unknown, companyId: number): boolean {
  if (value === false || value === null) return true;
  if (typeof value === 'number') return value === companyId;
  return Array.isArray(value) && typeof value[0] === 'number' && value[0] === companyId;
}

/** Read all active, invoice-eligible products visible to the activated company. Ambiguous default codes are omitted
 * because PMO stores the chosen code and the money dispatcher must resolve it to exactly one Odoo product. */
export async function listOdooItems(
  call: OdooCall,
  companyId: number,
  purpose: OdooItemPurpose,
): Promise<OdooItemOption[]> {
  if (!Number.isInteger(companyId) || companyId <= 0) throw new Error('Odoo company is unavailable');

  const eligibleField = purpose === 'sales' ? 'sale_ok' : 'purchase_ok';
  const rows: ProductRow[] = [];
  const readPage = async (offset: number, limit: number) => {
    const page = await call<unknown>('product.product', 'search_read', {
      domain: [
        ['active', '=', true],
        [eligibleField, '=', true],
        ['company_id', 'in', [companyId, false]],
      ],
      fields: [...BASE_FIELDS, eligibleField, 'company_id'],
      offset,
      limit,
      order: 'default_code asc',
    });
    if (!Array.isArray(page)) throw new Error('Odoo product catalogue is unavailable');
    return page as ProductRow[];
  };
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, MAX_CATALOGUE_ITEMS - offset);
    const page = await readPage(offset, limit);
    rows.push(...page as ProductRow[]);
    if (page.length < limit) break;
    if (rows.length === MAX_CATALOGUE_ITEMS) {
      if ((await readPage(offset + limit, 1)).length > 0) throw new Error('Odoo product catalogue exceeds supported size');
      break;
    }
  }

  const candidates = rows.flatMap((row) => {
    const code = row.default_code;
    if (typeof code !== 'string' || code.trim() === '' || typeof row.name !== 'string' || row.name.trim() === '') return [];
    if (row.active !== true || row[eligibleField] !== true || !belongsToCompany(row.company_id, companyId)) return [];
    return [{ code, name: row.name }];
  });
  const codeCounts = new Map<string, number>();
  for (const item of candidates) codeCounts.set(item.code, (codeCounts.get(item.code) ?? 0) + 1);
  return candidates.filter((item) => codeCounts.get(item.code) === 1);
}
