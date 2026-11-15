/**
 * #2282 D1/D2: the issued-material cost kind of the Odoo ledger feed. Reads Odoo's `picking_entry` analytic lines (the project cost
 * `project_stock_account` books when an issue is validated) of the activated company that have NO journal item: a line with a
 * `move_line_id` is already counted through that journal line's `analytic_distribution` by the GL kind, so excluding it here is what
 * makes "counted once" hold by construction.
 */
import type { OdooCall } from '../client.ts';
import type { DirectoryRow, KindSpec } from '../kinds.ts';
import type { KindReaders } from '../sweep.ts';
import { formatCents, nanoToCents, toNano } from './cents.ts';

/**
 * ⚑ The ONE place Odoo field names for the stock-cost kind live (the feed.ts rule). Every name here, and on the related models
 * (`stock.picking.return_id`, `product.product.property_account_expense_id` and `categ_id`, `product.category.property_account_expense_categ_id`,
 * `stock.move.picking_id`, `stock.move.account_move_id`), is bed-proven (15 Nov 2026, research section 11, `odooStockCost.bed.test.ts`).
 */
export const STOCK_COST_LINE_FIELDS = [
  'name', 'category', 'move_line_id', 'account_id', 'general_account_id', 'product_id', 'unit_amount', 'amount', 'date', 'company_id', 'write_date',
];
export const PICKING_ENTRY = 'picking_entry';
export const PICKING_FIELDS = ['name', 'return_id'];
export const PRODUCT_EXPENSE_FIELDS = ['name', 'property_account_expense_id', 'categ_id'];
export const CATEGORY_EXPENSE_FIELDS = ['property_account_expense_categ_id'];
/** The stock move's link to its valuation entry (bed-verified 15 Nov): the no-double-count check reads the entry's journal items. `account.move.line.stock_move_id` exists but Odoo never fills it. */
export const JOURNAL_ENTRY_OF_MOVE = 'account_move_id';

type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const m2o = (v: unknown): string | null | undefined =>
  v === false || v == null ? null : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : undefined;

/** One stored analytic line. `debit`/`credit` are exact two-decimal strings: Odoo's negative amount is a cost (debit). */
export interface StockCostAttrs {
  analytic_account_id: string | null;
  general_account_id: string | null;
  product_id: string;
  company_id: string;
  unit_amount: string;
  debit: string;
  credit: string;
  date: string;
}

function parse(r: Raw): DirectoryRow | null {
  const moveLine = m2o(r.move_line_id), account = m2o(r.account_id), general = m2o(r.general_account_id),
    product = m2o(r.product_id), company = m2o(r.company_id);
  const amount = typeof r.amount === 'number' ? toNano(r.amount) : null;
  const qty = typeof r.unit_amount === 'number' ? toNano(r.unit_amount) : null;
  if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0
    || typeof r.write_date !== 'string' || !WRITE_DATE.test(r.write_date)
    || typeof r.date !== 'string' || !DAY.test(r.date)
    || r.category !== PICKING_ENTRY
    // A line with a journal item is the GL kind's to count; this kind never stores it.            mut:osc_move_line
    || moveLine !== null
    || typeof r.name !== 'string' || r.name === ''
    || account === undefined || general === undefined || !product || !company || amount === null || qty === null) return null;
  const cents = nanoToCents(amount);
  const attrs: StockCostAttrs = {
    analytic_account_id: account, general_account_id: general, product_id: product, company_id: company,
    unit_amount: String(r.unit_amount), debit: formatCents(cents < 0n ? -cents : 0n), credit: formatCents(cents > 0n ? cents : 0n), date: r.date,
  };
  return { external_id: String(r.id), code: null, name: r.name, parent_external_id: null, active: true, source_write_date: r.write_date, attrs: attrs as unknown as Record<string, unknown> };
}

export const STOCK_COST_FEED_SPEC: KindSpec = { model: 'account.analytic.line', fields: STOCK_COST_LINE_FIELDS, company: 'company_id', parse };

/** The D2 domain: the activated company's own `picking_entry` lines (a shared, company-less line is not this org's cost) with no journal item. */
export function stockCostDomain(companyId: number): unknown[] {
  return [['company_id', '=', companyId], ['category', '=', PICKING_ENTRY], ['move_line_id', '=', false]];
}

/** Reader adapter for runKind and the census: every read carries the D2 domain. */
export function stockCostFeedReaders(call: OdooCall, companyId: number): KindReaders {
  const scope = stockCostDomain(companyId);
  return {
    read: (domain, order, limit) => call<unknown[]>(STOCK_COST_FEED_SPEC.model, 'search_read', { domain: [...domain, ...scope], fields: ['id', ...STOCK_COST_FEED_SPEC.fields], order, limit }),
    readIds: (afterId, limit) => call<number[]>(STOCK_COST_FEED_SPEC.model, 'search', { domain: [['id', '>', afterId], ...scope], order: 'id asc', limit }),
  };
}

/** The pickings a page names (`name` = picking name within the company), read once per page: id and the picking a return returns. */
export async function readPickings(call: OdooCall, companyId: number, names: readonly string[]): Promise<Map<string, { id: number; returnOf: number | null }>> {
  const unique = [...new Set(names)];
  if (unique.length === 0) return new Map();
  const rows = await call<Array<Record<string, unknown>>>('stock.picking', 'search_read', {
    domain: [['name', 'in', unique], ['company_id', '=', companyId]], fields: PICKING_FIELDS, context: { active_test: false },
  });
  const out = new Map<string, { id: number; returnOf: number | null }>();
  for (const p of rows) {
    if (typeof p.id !== 'number' || typeof p.name !== 'string') continue;
    const ret = m2o(p.return_id);
    out.set(p.name, { id: p.id, returnOf: ret ? Number(ret) : null });
  }
  return out;
}
