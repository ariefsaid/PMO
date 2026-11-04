/**
 * The Odoo payment for one customer receipt (PD-2, DD-OCI-6). One receipt settles one posted invoice of the caller's tenant,
 * `0 < settled <= outstanding`, in company currency. Odoo itself accepts a receipt above the residual (V-OCI7), so the
 * over-receipt refusal here is the only guard. Tax the client withheld is the payment difference booked to the tax-prepaid
 * account (cash + withheld = settled). Every refusal comes before any write; the recorder is passed in from the verified
 * subject and never read from the payload.
 */
import { anchorMemo, ODOO_REVENUE_ANCHORS, REVENUE_KEY_RE } from './anchors.ts';
import { centsOf, centsToDecimal } from './moneyHeader.ts';

type Money = number | string | null | undefined;
export interface ReceiptInput {
  id: string; orgId: string; date: string; currency: string;
  /** The amount allocated to the invoice (gross). */
  settled: Money;
  /** Cash received; defaults to settled when nothing was withheld. */
  cash?: Money;
  withheld?: Money;
  /** The bukti-potong number; required with a withheld amount. */
  slipNumber?: string | null;
  /** A per-receipt journal override of the org default. */
  journalId?: number | null;
}
export interface ReceiptInvoice { id: string; orgId: string; customerId: string; state: string; outstanding: Money; currency: string }
export interface ReceiptDefaults {
  companyCurrency: string;
  partners: Readonly<Record<string, number>>;
  journalId: number | null;
  inboundMethodLineId: number | null;
  taxPrepaidAccountId: number | null;
  /** The currencies of the receivable, cash, and tax-prepaid accounts a withholding receipt posts between. */
  accountCurrencies?: { receivable: string; cash: string; taxPrepaid: string };
}
export type ReceiptRefusal = 'invoice' | 'invoice-not-posted' | 'currency' | 'client' | 'amount' | 'over-receipt' | 'amounts'
  | 'withheld-partial' | 'receipt' | 'date' | 'tax-prepaid-account' | 'withholding-slip' | 'account-currency' | 'journal' | 'journal-method';
export type ReceiptBodyResult =
  | { outcome: 'ready'; body: Record<string, unknown>; writeOff: { accountId: number; amount: number; label: string } | null; recordedBy: string }
  | { outcome: 'refused'; code: 'config-rejected' | 'cross-org-link-rejected'; thing: ReceiptRefusal };

const refuse = (thing: ReceiptRefusal, code: 'config-rejected' | 'cross-org-link-rejected' = 'config-rejected'): ReceiptBodyResult => ({ outcome: 'refused', code, thing });
const SLIP_MAX = 140;

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function buildReceiptBody(receipt: ReceiptInput, invoice: ReceiptInvoice | null, defaults: ReceiptDefaults, recordedBy: string): ReceiptBodyResult {
  if (!REVENUE_KEY_RE.test(`ip:${receipt.id}`)) return refuse('receipt');
  if (!validDateOnly(receipt.date)) return refuse('date');
  if (!invoice) return refuse('invoice');
  if (invoice.orgId !== receipt.orgId) return refuse('invoice', 'cross-org-link-rejected');
  if (invoice.state !== 'posted') return refuse('invoice-not-posted');
  if (receipt.currency !== defaults.companyCurrency || invoice.currency !== defaults.companyCurrency) return refuse('currency');
  const partnerId = defaults.partners[invoice.customerId];
  if (partnerId === undefined) return refuse('client');

  const settled = centsOf(receipt.settled), outstanding = centsOf(invoice.outstanding);
  if (settled === null || outstanding === null || settled <= 0n) return refuse('amount');
  if (settled > outstanding) return refuse('over-receipt');
  const withheld = receipt.withheld == null ? 0n : centsOf(receipt.withheld);
  const cash = receipt.cash == null ? settled - (withheld ?? 0n) : centsOf(receipt.cash);
  if (withheld === null || cash === null || withheld < 0n || cash <= 0n || cash + withheld !== settled) return refuse('amounts');

  const slip = typeof receipt.slipNumber === 'string' ? receipt.slipNumber.trim() : '';
  if (withheld > 0n) {
    // Odoo's wizard writes off residual - amount, not the withheld figure, so a partial settle would lose receivable.
    if (settled !== outstanding) return refuse('withheld-partial');
    if (defaults.taxPrepaidAccountId === null) return refuse('tax-prepaid-account');
    if (slip === '' || slip.length > SLIP_MAX) return refuse('withholding-slip');
    if (!defaults.accountCurrencies || [defaults.accountCurrencies.receivable, defaults.accountCurrencies.cash, defaults.accountCurrencies.taxPrepaid]
      .some((currency) => currency !== defaults.companyCurrency)) return refuse('account-currency');
  }
  const journalId = receipt.journalId ?? defaults.journalId;
  if (journalId === null) return refuse('journal');
  if (defaults.inboundMethodLineId === null) return refuse('journal-method');

  const trace = ODOO_REVENUE_ANCHORS['incoming-payment'].secondary.field;
  return {
    outcome: 'ready',
    recordedBy,
    writeOff: withheld > 0n ? { accountId: defaults.taxPrepaidAccountId!, amount: Number(centsToDecimal(withheld)), label: slip } : null,
    body: {
      payment_type: 'inbound', partner_type: 'customer', partner_id: partnerId, amount: Number(centsToDecimal(cash)), date: receipt.date,
      journal_id: journalId, payment_method_line_id: defaults.inboundMethodLineId, [trace]: anchorMemo(`ip:${receipt.id}`),
    },
  };
}
