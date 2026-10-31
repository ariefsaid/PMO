/**
 * The Odoo directory kinds the sweep mirrors (FR-ODC-040, AC-ODC-024): model, fields, company scoping and one strict
 * parser per kind. An unparseable row is skipped whole, never partly written. Field names live only here, in
 * discovery.ts and in normalise.ts.
 */
/** Keep in step with the kind check on external_master_records and assert_odoo_master_kind (migration 0421). */
export const DIRECTORY_KINDS = ['company', 'partner', 'product', 'uom', 'warehouse', 'location', 'account', 'tax', 'analytic_plan', 'analytic_account'] as const;
export type DirectoryKind = (typeof DIRECTORY_KINDS)[number];

export interface DirectoryRow {
  external_id: string;
  code: string | null;
  name: string;
  parent_external_id: string | null;
  active: boolean;
  attrs: Record<string, unknown>;
  source_write_date: string;
}

type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
/** A many2one is `false` or `[id, name]`; anything else is malformed (`undefined`). */
const m2o = (v: unknown): string | null | undefined =>
  v === false || v == null ? null : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : undefined;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function base(r: Raw, name: unknown, code: unknown, parent: unknown): DirectoryRow | null {
  const p = m2o(parent);
  if (typeof r.id !== 'number' || typeof name !== 'string' || !name || typeof r.write_date !== 'string' || !WRITE_DATE.test(r.write_date) || p === undefined) return null;
  return { external_id: String(r.id), code: str(code), name, parent_external_id: p, active: r.active !== false, attrs: {}, source_write_date: r.write_date };
}

/** Attributes holding a many2one id reject the whole row when the value is malformed. */
function withAttrs(row: DirectoryRow | null, attrs: Record<string, unknown>): DirectoryRow | null {
  return row && !Object.values(attrs).includes(undefined) ? { ...row, attrs } : null;
}

export interface KindSpec {
  model: string;
  fields: string[];
  /** How the activated company scopes this model: a single company field (shared rows have `false`), a set, or none. */
  company: 'company_id' | 'company_ids' | null;
  parse: (r: Raw) => DirectoryRow | null;
}

export const KIND_SPECS: Record<DirectoryKind, KindSpec> = {
  company: { model: 'res.company', fields: ['name', 'currency_id', 'write_date'], company: null,
    parse: (r) => withAttrs(base(r, r.name, null, false), { currency: m2o(r.currency_id) }) },
  partner: { model: 'res.partner', fields: ['name', 'vat', 'ref', 'is_company', 'parent_id', 'active', 'supplier_rank', 'customer_rank', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.ref, r.parent_id), { vat: str(r.vat), is_company: r.is_company === true, supplier_rank: Number(r.supplier_rank ?? 0), customer_rank: Number(r.customer_rank ?? 0) }) },
  product: { model: 'product.product', fields: ['default_code', 'name', 'uom_id', 'purchase_ok', 'sale_ok', 'is_storable', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.default_code, false), { uom_id: m2o(r.uom_id), purchasable: r.purchase_ok === true, sellable: r.sale_ok === true, storable: r.is_storable === true }) },
  uom: { model: 'uom.uom', fields: ['name', 'relative_factor', 'relative_uom_id', 'active', 'write_date'], company: null,
    parse: (r) => (typeof r.relative_factor !== 'number' ? null : withAttrs(base(r, r.name, null, r.relative_uom_id), { relative_factor: r.relative_factor })) },
  warehouse: { model: 'stock.warehouse', fields: ['name', 'code', 'lot_stock_id', 'view_location_id', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.code, false), { stock_location_id: m2o(r.lot_stock_id), view_location_id: m2o(r.view_location_id) }) },
  location: { model: 'stock.location', fields: ['complete_name', 'usage', 'location_id', 'warehouse_id', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.complete_name, null, r.location_id), { usage: str(r.usage), warehouse_id: m2o(r.warehouse_id) }) },
  account: { model: 'account.account', fields: ['code', 'name', 'account_type', 'active', 'write_date'], company: 'company_ids',
    parse: (r) => withAttrs(base(r, r.name, r.code, false), { account_type: str(r.account_type) }) },
  tax: { model: 'account.tax', fields: ['name', 'amount', 'type_tax_use', 'active', 'write_date'], company: 'company_id',
    parse: (r) => (typeof r.amount !== 'number' ? null : withAttrs(base(r, r.name, null, false), { amount: r.amount, use: str(r.type_tax_use) })) },
  analytic_plan: { model: 'account.analytic.plan', fields: ['name', 'write_date'], company: null, parse: (r) => base(r, r.name, null, false) },
  analytic_account: { model: 'account.analytic.account', fields: ['name', 'code', 'plan_id', 'company_id', 'active', 'write_date'], company: 'company_id',
    parse: (r) => withAttrs(base(r, r.name, r.code, r.plan_id), { company_id: m2o(r.company_id) }) },
};

/** The domain terms that limit a kind to the activated company (and rows shared by every company). */
export function companyDomain(spec: KindSpec, companyId: number): unknown[] {
  if (spec.company === 'company_id') return [['company_id', 'in', [companyId, false]]];
  if (spec.company === 'company_ids') return [['company_ids', 'in', [companyId]]];
  return [];
}

export function parsePage(spec: KindSpec, rows: unknown[]): { rows: DirectoryRow[]; skipped: number } {
  const out: DirectoryRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const p = r && typeof r === 'object' ? spec.parse(r as Raw) : null;
    if (p) out.push(p);
    else skipped++;
  }
  return { rows: out, skipped };
}
