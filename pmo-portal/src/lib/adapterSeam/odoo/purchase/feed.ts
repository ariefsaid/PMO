/**
 * The inbound purchase feed (FR-OPP-080..083): per domain the Odoo model, the fields and filter the sweep reads, the strict row
 * parser and the readers that enrich a page with what it needs (line analytic distributions, tax lines, PMO anchors). The pages
 * ride the O1 keyset/overlap/census machinery unchanged (`runKind` / `runCensus` over a `KindSpec`-shaped spec): the row's
 * facts travel in `attrs`, which `apply_odoo_purchase_page` (migration 0507) reads. Every Odoo model and field name for the feed
 * lives here (NFR-OPP-009). An unparseable row is skipped whole, never partly written.
 */
import type { OdooCall } from '../client.ts';
import { companyDomain, type DirectoryRow, type KindSpec } from '../kinds.ts';
import type { KindReaders } from '../sweep.ts';
import { keyFromExternalIdentifier } from './anchors.ts';
import { moneyHeader } from './moneyHeader.ts';
import type { PurchaseKind } from './nextStep.ts';
import { purchaseDocstatus, purchaseStatus } from './status.ts';

export const PURCHASE_DOMAINS = ['purchase-order', 'receipt', 'bill', 'payment'] as const;
export type PurchaseDomain = (typeof PURCHASE_DOMAINS)[number];

type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;
const m2o = (v: unknown): string | null | undefined => (v === false || v == null ? null : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : undefined);
const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
/** A company-currency figure as the fixed two-decimal string the mirror and `moneyHeader` read; anything else is absent. */
const money = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : null);
const day = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v.slice(0, 10) : null);

export interface PurchaseSpec extends KindSpec {
  domain: PurchaseDomain;
  kind: PurchaseKind;
  /** Terms that keep the feed to what PMO mirrors: vendor bills only, outbound supplier payments only, incoming transfers only. */
  filter: unknown[];
  /** Rows of this domain that an anchor (`ir.model.data`, module `pmo`) can name. */
  anchored: boolean;
}

function parseRow(spec: PurchaseSpec, r: Raw): DirectoryRow | null {
  const partner = m2o(r.partner_id);
  if (typeof r.id !== 'number' || typeof r.name !== 'string' || !r.name || typeof r.write_date !== 'string' || !WRITE_DATE.test(r.write_date)
    || typeof r.state !== 'string' || partner === undefined) return null;
  const state = r.state;
  const { status, cancelled } = purchaseStatus(spec.kind, state, money(r.amount_residual) ?? undefined);
  const attrs: Record<string, unknown> = {
    state, status: spec.kind === 'payment' ? (status === 'Posted' ? 'Paid' : 'Scheduled') : status,
    docstatus: purchaseDocstatus(spec.kind, state), cancelled,
    anchor_key: text(r._anchor), partner, partner_name: Array.isArray(r.partner_id) && typeof r.partner_id[1] === 'string' ? r.partner_id[1] : null,
    analytic_ids: Array.isArray(r._analytic) ? r._analytic : [],
  };
  if (spec.kind === 'order') Object.assign(attrs, { date: day(r.date_order), amount_total: money(r.amount_total), amount_untaxed: money(r.amount_untaxed) });
  if (spec.kind === 'bill') {
    const total = money(r.amount_total), residual = money(r.amount_residual);
    Object.assign(attrs, {
      date: day(r.invoice_date), due_date: day(r.invoice_date_due), bill_no: text(r.ref), amount_total: total, amount_untaxed: money(r.amount_untaxed), residual,
      // Whole header or none (FR-OPP-082): `moneyHeader` answers null when any part is missing, and the database then writes none of it.
      money: total && residual && Array.isArray(r._taxLines) ? moneyHeader({ amount_total: total, amount_residual: residual }, r._taxLines as Array<{ balance?: string }>) : null,
    });
  }
  if (spec.kind === 'payment') Object.assign(attrs, { amount: money(r.amount), date: day(r.date) });
  return { external_id: String(r.id), code: null, name: r.name, parent_external_id: null, active: true, attrs, source_write_date: r.write_date };
}

const spec = (domain: PurchaseDomain, kind: PurchaseKind, model: string, fields: string[], filter: unknown[], anchored: boolean): PurchaseSpec => {
  const s: PurchaseSpec = { domain, kind, model, fields, company: 'company_id', filter, anchored, parse: (r) => parseRow(s, r) };
  return s;
};

export const PURCHASE_SPECS: Record<PurchaseDomain, PurchaseSpec> = {
  'purchase-order': spec('purchase-order', 'order', 'purchase.order', ['name', 'state', 'partner_id', 'date_order', 'amount_total', 'amount_untaxed', 'write_date'], [], true),
  receipt: spec('receipt', 'receipt', 'stock.picking', ['name', 'state', 'partner_id', 'write_date'], [['picking_type_code', '=', 'incoming']], false),
  bill: spec('bill', 'bill', 'account.move', ['name', 'state', 'partner_id', 'invoice_date', 'invoice_date_due', 'ref', 'amount_total', 'amount_untaxed', 'amount_residual', 'write_date'], [['move_type', '=', 'in_invoice']], true),
  payment: spec('payment', 'payment', 'account.payment', ['name', 'state', 'partner_id', 'amount', 'date', 'write_date'], [['payment_type', '=', 'outbound'], ['partner_type', '=', 'supplier']], false),
};

/** The analytic account ids of a distribution map (`{"88": 100, "91,92": 50}`); a key may name several accounts. */
function accountIds(distribution: unknown): string[] {
  if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) return [];
  return Object.keys(distribution).flatMap((k) => k.split(',')).filter((id) => /^[1-9][0-9]*$/.test(id));
}
const m2oId = (v: unknown): number | null => (Array.isArray(v) && typeof v[0] === 'number' ? v[0] : typeof v === 'number' ? v : null);

/**
 * What the page's rows need beyond their own fields: the line analytic distributions (project attribution), a bill's tax lines
 * (VAT and withholding) and the PMO anchors. Each is one extra call per page; the sweep budget counts the page, not these.
 * ponytail: three Odoo calls per page against a one-unit budget; count them if a tick ever runs long.
 */
async function enrich(call: OdooCall, s: PurchaseSpec, rows: Raw[]): Promise<Raw[]> {
  const ids = rows.map((r) => r.id).filter((id): id is number => typeof id === 'number');
  if (ids.length === 0) return rows;
  const analytic = new Map<number, Set<string>>(), tax = new Map<number, Array<{ balance: string }>>(), anchor = new Map<number, string>();
  const add = (id: number | null, accounts: string[]) => { if (id !== null) { const set = analytic.get(id) ?? new Set<string>(); accounts.forEach((a) => set.add(a)); analytic.set(id, set); } };
  if (s.kind === 'order') {
    const lines = await call<Raw[]>('purchase.order.line', 'search_read', { domain: [['order_id', 'in', ids]], fields: ['order_id', 'analytic_distribution'], context: { active_test: false } });
    for (const l of lines) add(m2oId(l.order_id), accountIds(l.analytic_distribution));
  }
  if (s.kind === 'bill') {
    const lines = await call<Raw[]>('account.move.line', 'search_read', { domain: [['move_id', 'in', ids]], fields: ['move_id', 'balance', 'tax_line_id', 'analytic_distribution'] });
    for (const l of lines) {
      const move = m2oId(l.move_id);
      if (move === null) continue;
      if (l.tax_line_id) {
        // A balance that is not a number leaves the header unreadable (null), never a silent zero.
        const list = tax.get(move) ?? [];
        list.push({ balance: typeof l.balance === 'number' && Number.isFinite(l.balance) ? l.balance.toFixed(2) : '' });
        tax.set(move, list);
      } else add(move, accountIds(l.analytic_distribution));
    }
  }
  if (s.anchored) {
    const named = await call<Array<{ res_id: number; name: string }>>('ir.model.data', 'search_read', { domain: [['module', '=', 'pmo'], ['model', '=', s.model], ['res_id', 'in', ids]], fields: ['res_id', 'name'] });
    for (const n of named) { const key = keyFromExternalIdentifier(n.name); if (key) anchor.set(n.res_id, key); }
  }
  return rows.map((r) => ({
    ...r,
    _analytic: [...(analytic.get(r.id as number) ?? [])],
    ...(s.kind === 'bill' ? { _taxLines: tax.get(r.id as number) ?? [] } : {}),
    ...(anchor.has(r.id as number) ? { _anchor: anchor.get(r.id as number) } : {}),
  }));
}

/** The readers `runKind` / `runCensus` run over: the O1 shape, plus this domain's filter and the page enrichment. */
export function purchaseReaders(call: OdooCall, s: PurchaseSpec, companyId: number): KindReaders {
  const scope = [...s.filter, ...companyDomain(s, companyId)];
  const context = { active_test: false };
  return {
    read: async (domain, order, limit) => enrich(call, s, await call<Raw[]>(s.model, 'search_read', { domain: [...domain, ...scope], fields: ['id', ...s.fields], order, limit, context })),
    readIds: (afterId, limit) => call<number[]>(s.model, 'search', { domain: [['id', '>', afterId], ...scope], order: 'id asc', limit, context }),
  };
}
