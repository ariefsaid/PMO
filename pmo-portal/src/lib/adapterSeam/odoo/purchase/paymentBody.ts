/**
 * The Odoo vendor-payment (`account.payment`, outbound supplier) create body (FR-OPP-050/051), pure. Everything is resolved before
 * it is called and a thing that did not resolve refuses here, naming it, so no Odoo write is attempted. Odoo ACCEPTS an overpayment
 * (bed V-OPP7), so the ceiling lives here: an amount above the bill's outstanding net payable is refused before any write. The
 * anchor is the memo (the payment is the one purchase kind whose anchor is a business-visible text field, DD-OPP-4 amendment); the
 * bill's own residual is Odoo's figure, never PMO's (ADR-0048).
 */
import { AdapterError } from '../../contract.ts';
import { anchorValue, parseOdooExternalRef } from './anchors.ts';

export interface PaymentInput {
  /** The Odoo bill this pays, in the model-qualified `account.move:<id>` form, as mapped when the bill was pushed. */
  billRef: string | null;
  /** What to pay now: above zero and not above the bill's residual. */
  amount: number | string;
  /** `YYYY-MM-DD`; Odoo's own default (today) when absent. */
  date?: string | null;
  /** The vendor's Odoo partner as PMO knows it; when present it must be the bill's own. */
  vendorPartnerId?: number | null;
}
export interface PaymentBill {
  id: number;
  state: string;
  moveType: string;
  /** Odoo's `amount_residual`, read just before the payment. */
  residual: number | string;
  currencyId: number | null;
  partnerId: number | null;
}
export interface PaymentCtx {
  companyCurrencyId: number;
  /** The chosen payment journal and its first outbound payment method line (OQ-OPP-6); null when none is chosen. */
  journal: { id: number; methodLineId: number | null } | null;
  /** The bill as Odoo has it now; null when it could not be read. */
  bill: PaymentBill | null;
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const cents = (v: unknown): number => (typeof v === 'string' && v.trim() === '' ? Number.NaN : Math.round(Number(v) * 100));

export function buildPaymentBody(input: PaymentInput, ctx: PaymentCtx, key: string): Record<string, unknown> {
  if (!key.startsWith('pay:')) throw new Error('Invalid purchase key');
  const memo = anchorValue(key);
  const billId = parseOdooExternalRef('account.move', input.billRef) ?? refuse('payment-bill-required');
  const bill = ctx.bill && ctx.bill.id === billId ? ctx.bill : refuse('bill-missing');
  if (bill.moveType !== 'in_invoice') refuse('bill-not-a-vendor-bill');
  if (bill.state !== 'posted') refuse('bill-not-posted');
  if (bill.currencyId !== ctx.companyCurrencyId) refuse('currency-mismatch');
  const pay = cents(input.amount);
  if (!Number.isFinite(pay) || pay <= 0) refuse('amount-invalid');
  if (pay > cents(bill.residual)) refuse('over-payment');
  if (input.vendorPartnerId != null && input.vendorPartnerId !== bill.partnerId) refuse('vendor-mismatch');
  if (bill.partnerId == null) refuse('bill-missing');
  if (input.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) refuse('date-invalid');
  if (!ctx.journal) refuse('journal-missing');
  if (ctx.journal!.methodLineId == null) refuse('journal-no-outbound-method');
  return {
    payment_type: 'outbound', partner_type: 'supplier', partner_id: bill.partnerId, amount: pay / 100, currency_id: ctx.companyCurrencyId,
    journal_id: ctx.journal!.id, payment_method_line_id: ctx.journal!.methodLineId, ...(input.date ? { date: input.date } : {}), memo,
  };
}
