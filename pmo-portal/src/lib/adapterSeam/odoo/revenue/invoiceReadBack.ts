/**
 * What Odoo says about a posted customer invoice, turned into the canonical record PMO's `sales_invoices` mirror writes (FR-OCI-014/016/022a/024,
 * AC-OCI-013/016/030), pure. The ledger is the oracle (ADR-0048, NFR-OCI-004): amount, tax and outstanding are Odoo's, never recomputed. What
 * differs from what PMO sent, or a posted line without the project's cost account, is FLAGGED on the canonical (`odoo_attention`) and nothing is
 * overwritten, deleted or reversed; the figure PMO sent stays beside Odoo's (`odoo_sent_total`). A money header that is incomplete, or that the
 * `sales_invoices` constraints (0188: a tax that is not negative) would refuse, leaves the money keys out whole (DD-VWH-2/5): the mirror writer then
 * refuses a create and writes none of it on an update, and the invoice is flagged `money-unreadable`.
 */
import type { PmoRecord } from '../../contract.ts';
import { centsOf, checkCostAccount, compareSent, moneyHeader } from './moneyHeader.ts';

type Amount = number | string;
export interface InvoiceRead {
  move: {
    name: unknown; state: string; amount_untaxed?: Amount; amount_tax?: Amount; amount_total?: Amount; amount_residual?: Amount;
    ref?: unknown; invoice_date?: unknown; currency_id?: unknown; write_date: string;
  };
  /** The posted product lines (`account.move.line`, display_type product); null when they could not be read. */
  productLines: ReadonlyArray<{
    id: number; display_type?: string; analytic_distribution?: Record<string, number> | false | null;
    product_id?: unknown; account_id?: unknown;
  }> | null;
  /** When Odoo was read (the as-of age the screens show). */
  readAt: string;
}
export interface InvoiceExpect {
  /** The total PMO expected Odoo to answer: the figure the command sent. */
  total: string;
  /** The project's cost account id, or null when the invoice has no project. */
  costAccountId: number | null;
  /** A down-payment or recovery product and the configured customer-advance liability account it must post to. */
  advanceAccount?: { productId: number; accountId: number };
}
export type InvoiceAttention = 'total-mismatch' | 'cost-account-missing' | 'advance-account-mismatch' | 'money-unreadable' | 'lines-unreadable';

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const many2oneId = (value: unknown): number | null => typeof value === 'number' && Number.isInteger(value) && value > 0
  ? value
  : Array.isArray(value) && typeof value[0] === 'number' && Number.isInteger(value[0]) && value[0] > 0 ? value[0] : null;
const STATES: ReadonlySet<string> = new Set(['draft', 'posted', 'cancel']);
const docstatus = (state: string): number => (state === 'posted' ? 1 : state === 'cancel' ? 2 : 0);

function checkAdvanceAccount(
  lines: InvoiceRead['productLines'],
  expected: InvoiceExpect['advanceAccount'],
): { outcome: 'ok' } | { outcome: 'needs-attention' } | { outcome: 'unreadable' } {
  if (!expected) return { outcome: 'ok' };
  if (lines === null) return { outcome: 'unreadable' };
  const productLines = lines.filter((line) => line.display_type === undefined || line.display_type === 'product');
  if (productLines.some((line) => many2oneId(line.product_id) === null)) return { outcome: 'unreadable' };
  const advanceLines = productLines.filter((line) => many2oneId(line.product_id) === expected.productId);
  if (advanceLines.length === 0) return { outcome: 'needs-attention' };
  return advanceLines.every((line) => many2oneId(line.account_id) === expected.accountId)
    ? { outcome: 'ok' }
    : { outcome: 'needs-attention' };
}

export function readBackInvoice(pmoId: string, read: InvoiceRead, expect: InvoiceExpect): PmoRecord {
  const { move } = read;
  const header = moneyHeader(move);
  const [untaxed, tax, total] = [centsOf(move.amount_untaxed), centsOf(move.amount_tax), centsOf(move.amount_total)];
  const sane = header !== null && untaxed !== null && tax !== null && total !== null && total >= 0n && tax >= 0n && tax <= total;
  const mismatch = sane && compareSent(expect.total, move.amount_total) === 'mismatch';
  const costAccount = expect.costAccountId === null ? ({ outcome: 'ok' } as const) : checkCostAccount(read.productLines, expect.costAccountId);
  const advanceAccount = checkAdvanceAccount(read.productLines, expect.advanceAccount);
  // One column holds one reason; the order is the order a person should look in.
  const attention: InvoiceAttention | null = !sane ? 'money-unreadable'
    : costAccount.outcome === 'needs-attention' ? 'cost-account-missing'
    : advanceAccount.outcome === 'needs-attention' ? 'advance-account-mismatch'
    : mismatch ? 'total-mismatch'
    : costAccount.outcome === 'unreadable' || advanceAccount.outcome === 'unreadable' ? 'lines-unreadable'
    : null;
  const currency = Array.isArray(move.currency_id) ? text(move.currency_id[1]) : null;
  return {
    id: pmoId,
    si_number: text(move.name),
    invoice_date: text(move.invoice_date),
    reference_number: text(move.ref),
    ...(currency ? { currency } : {}),
    ...(sane ? { amount: header.total, tax_amount: header.tax, erp_outstanding_amount: header.outstanding } : {}),
    erp_docstatus: docstatus(move.state),
    erp_modified: move.write_date,
    erp_amended_from: null,
    odoo_state: STATES.has(move.state) ? move.state : null,
    odoo_attention: attention,
    odoo_sent_total: mismatch ? expect.total : null,
    odoo_read_at: read.readAt,
  };
}

const roundHalfAway = (n: number) => (n < 0 ? -1 : 1) * Math.round(Math.abs(n));

/**
 * The total PMO expects Odoo to answer for the lines it sends and the explicit tax rates (percent): each line's net to the cent, each tax rounded per
 * line as Odoo does. It is an EXPECTATION to judge Odoo's answer by (FR-OCI-024), never a figure PMO stores: the ledger's total is the one written.
 */
export function expectedInvoiceTotal(lines: ReadonlyArray<{ quantity: number; unitPrice: number }>, taxRates: readonly number[]): string {
  let cents = 0;
  for (const line of lines) {
    const base = Math.round(line.quantity * line.unitPrice * 100);
    cents += base + taxRates.reduce((sum, rate) => sum + roundHalfAway((base * rate) / 100), 0);
  }
  return `${cents < 0 ? '-' : ''}${Math.trunc(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}
