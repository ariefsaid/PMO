/**
 * PMO statuses derived from Odoo state (FR-081, DD-OCI-7): read, never set. A cancelled document is marked, never
 * deleted. An unknown state mirrors nothing and cancels nothing. The residual is Odoo's own; a missing one is not zero,
 * so an invoice is never called Paid on a guess (as the ERPNext derivation).
 */
import type { PaymentClassification } from '../../contractSuite/harness.ts';
import { centsOf } from './moneyHeader.ts';

export type RevenueStatus = { mirrored: boolean; status: string | null; cancelled: boolean };
const NOT_MIRRORED: RevenueStatus = { mirrored: false, status: null, cancelled: false };
const CANCELLED: RevenueStatus = { mirrored: true, status: 'Cancelled', cancelled: true };

export function invoiceStatus(state: string | undefined, residual: number | string | null | undefined): RevenueStatus {
  if (state === 'cancel') return CANCELLED;
  if (state !== 'posted') return NOT_MIRRORED;
  return { mirrored: true, status: centsOf(residual) === 0n ? 'Paid' : 'Unpaid', cancelled: false };
}

export function creditNoteStatus(state: string | undefined): RevenueStatus & { negative: true } {
  if (state === 'cancel') return { ...CANCELLED, negative: true };
  return state === 'posted' ? { mirrored: true, status: 'Posted', cancelled: false, negative: true } : { ...NOT_MIRRORED, negative: true };
}

/** `in_process` is a posted payment awaiting bank reconciliation; `paid` is what a posted payment reads on the bed. */
export function paymentStatus(state: string | undefined): RevenueStatus {
  if (state === 'paid' || state === 'in_process' || state === 'posted') return { mirrored: true, status: 'Posted', cancelled: false };
  return state === 'canceled' || state === 'cancel' || state === 'rejected' ? CANCELLED : NOT_MIRRORED;
}

/** Inbound from a customer is a receipt, outbound to a supplier a vendor payment; any other pair, blank or absent is skipped. */
export function classifyPaymentDirection(paymentType: string | undefined, partnerType: string | undefined): PaymentClassification {
  if (paymentType === 'inbound' && partnerType === 'customer') return { kind: 'receipt', domain: 'revenue', table: 'incoming_payments' };
  if (paymentType === 'outbound' && partnerType === 'supplier') return { kind: 'vendor-payment', domain: 'procurement', table: 'payments' };
  return { kind: 'skipped' };
}
