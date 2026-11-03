/**
 * What the Odoo bill says after it was posted, turned into the canonical record PMO mirrors (FR-OPP-043/044, AC-OPP-020 U), pure.
 * The ledger is the oracle (ADR-0048, NFR-OPP-004): the money written is Odoo's, never PMO's figure and never recomputed. A
 * difference from what PMO sent, or a posted line without the project's cost account, is FLAGGED on the canonical
 * (`odoo_outcome` / `odoo_attention`); nothing is overwritten, deleted or reversed. A money header that is incomplete, or that the
 * `procurement_invoices` constraints (0196: withheld no larger than gross, no negative gross) would refuse, leaves the money keys
 * out whole (DD-VWH-2/5): the shipped mirror writer then refuses a create and writes none of it on an update.
 */
import type { PmoRecord } from '../../contract.ts';
import { compareSent, moneyHeader } from './moneyHeader.ts';

type Amount = number | string;
export interface BillRead {
  move: {
    name: string; state: string; amount_total?: Amount; amount_residual?: Amount; ref?: unknown; invoice_date?: unknown;
    currency_id?: unknown; write_date: string;
  };
  /** The posted tax lines (`balance`: positive VAT, negative withholding). */
  taxLines: ReadonlyArray<{ balance?: Amount }> | null;
  /** The posted product lines' analytic distributions. */
  productLines: ReadonlyArray<{ analytic_distribution?: unknown }>;
}
export interface BillExpect {
  /** The total PMO expected Odoo to answer, from the lines and explicit taxes it sent. */
  total: string;
  costAccountId: string | null;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const docstatus = (state: string): number => (state === 'posted' ? 1 : state === 'cancel' ? 2 : 0);

const carriesAccount = (distribution: unknown, account: string): boolean =>
  !!distribution && typeof distribution === 'object' && !Array.isArray(distribution)
  && Object.entries(distribution).length === 1 && (distribution as Record<string, unknown>)[account] === 100;

export function readBackBill(pmoId: string, read: BillRead, expect: BillExpect): PmoRecord {
  const { move } = read;
  const header = moneyHeader(move, read.taxLines as never);
  const sane = header !== null && Number(header.gross) >= 0 && Number(header.withheld) <= Number(header.gross);
  const attention: string[] = [];
  if (!sane) attention.push('money-unreadable');
  else if (compareSent(expect.total, move.amount_total as Amount) === 'mismatch') attention.push('total-mismatch');
  if (expect.costAccountId !== null && read.productLines.some((l) => !carriesAccount(l.analytic_distribution, expect.costAccountId!))) attention.push('cost-account-missing');
  const currency = Array.isArray(move.currency_id) ? text(move.currency_id[1]) : null;
  return {
    id: pmoId,
    vi_number: move.name,
    invoice_date: text(move.invoice_date),
    reference_number: text(move.ref),
    ...(currency ? { currency } : {}),
    ...(sane ? { amount: header.gross, tax_amount: header.vat, withheld_amount: header.withheld, erp_outstanding_amount: header.outstanding } : {}),
    pmo_amount: expect.total,
    erp_docstatus: docstatus(move.state),
    erp_modified: move.write_date,
    erp_amended_from: null,
    ...(attention.length ? { odoo_outcome: 'needs-attention', odoo_attention: attention } : {}),
  };
}
