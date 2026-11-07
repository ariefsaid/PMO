/**
 * The Odoo ledger feed's model, filter, fields and row parser (FR-ODA-001/008). Reads `account.move.line` of the
 * activated company, posted and not, so a repost flips a line back without a delete. The line is kept whole in `attrs`;
 * the split into project rows (`fanOutLine`) happens when the page is applied.
 */
import type { OdooCall } from '../client.ts';
import { companyDomain, type DirectoryRow, type KindSpec } from '../kinds.ts';
import type { KindReaders } from '../sweep.ts';
import { formatCents, nanoToCents, toNano } from './cents.ts';

/**
 * ⚑ The ONE place Odoo field names for the ledger live (V-ODA1). Bed-UNVERIFIED as a set: `parent_state`, `date`,
 * `debit`, `credit`, `balance`, `account_id`, `move_id`, `move_name`, `journal_id`, `partner_id`, `company_id`,
 * `currency_id`, `amount_currency`; only `analytic_distribution` and `write_date` are bed-verified (report §4-§5).
 * S0's verdicts correct this list and nothing else.
 */
export const LEDGER_LINE_FIELDS = [
  'date', 'parent_state', 'debit', 'credit', 'balance', 'account_id', 'move_id', 'move_name', 'journal_id',
  'partner_id', 'company_id', 'currency_id', 'amount_currency', 'analytic_distribution', 'write_date',
];

type Raw = Record<string, unknown>;
const WRITE_DATE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const m2o = (v: unknown): string | null | undefined =>
  v === false || v == null ? null : Array.isArray(v) && typeof v[0] === 'number' ? String(v[0]) : undefined;
const m2oName = (v: unknown): string | null =>
  Array.isArray(v) && typeof v[1] === 'string' && v[1] !== '' ? v[1] : null;
const money = (v: unknown): string | null => {
  const n = typeof v === 'number' ? toNano(v) : null;
  return n === null ? null : formatCents(nanoToCents(n));
};

function distribution(v: unknown): Record<string, number> | null | undefined {
  if (v === false || v == null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v);
  return entries.every(([, p]) => typeof p === 'number' && Number.isFinite(p)) ? (v as Record<string, number>) : undefined;
}

function parse(r: Raw): DirectoryRow | null {
  const account = m2o(r.account_id), company = m2o(r.company_id), currency = m2o(r.currency_id), dist = distribution(r.analytic_distribution);
  const debit = money(r.debit), credit = money(r.credit);
  if (typeof r.id !== 'number' || !Number.isSafeInteger(r.id) || r.id <= 0
    || typeof r.write_date !== 'string' || !WRITE_DATE.test(r.write_date)
    || typeof r.parent_state !== 'string' || typeof r.date !== 'string' || !DAY.test(r.date)
    || typeof r.move_name !== 'string' || r.move_name === ''
    || !account || company === undefined || currency === undefined || dist === undefined || debit === null || credit === null) return null;
  return {
    external_id: String(r.id), code: null, name: r.move_name, parent_external_id: null, active: true,
    source_write_date: r.write_date,
    attrs: {
      // A line in another currency is mirrored at its company-currency value and flagged (OQ-ODA-5).
      parent_state: r.parent_state, date: r.date, debit, credit, account_id: account,
      journal: m2oName(r.journal_id), partner: m2oName(r.partner_id), company_id: company,
      foreign_currency: typeof r.amount_currency === 'number' && r.amount_currency !== r.balance,
      analytic_distribution: dist,
    },
  };
}

export const LEDGER_FEED_SPEC: KindSpec = { model: 'account.move.line', fields: LEDGER_LINE_FIELDS, company: 'company_id', parse };

/** Reader adapter for runKind: the activated company scopes the read. */
export function ledgerFeedReaders(call: OdooCall, companyId: number): KindReaders {
  const scope = companyDomain(LEDGER_FEED_SPEC, companyId);
  return {
    read: (domain, order, limit) => call<unknown[]>(LEDGER_FEED_SPEC.model, 'search_read', { domain: [...domain, ...scope], fields: ['id', ...LEDGER_FEED_SPEC.fields], order, limit }),
    readIds: (afterId, limit) => call<number[]>(LEDGER_FEED_SPEC.model, 'search', { domain: [['id', '>', afterId], ...scope], order: 'id asc', limit }),
  };
}
