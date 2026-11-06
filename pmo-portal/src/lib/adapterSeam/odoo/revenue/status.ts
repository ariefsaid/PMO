/**
 * PMO statuses derived from Odoo state (FR-081, DD-OCI-7): read, never set. A cancelled document is marked, never
 * deleted. An unknown state mirrors nothing and cancels nothing. The residual is Odoo's own; a missing one is not zero,
 * so an invoice is never called Paid on a guess (as the ERPNext derivation).
 */
import { centsOf } from './moneyHeader.ts';

export type RevenueStatus = { mirrored: boolean; status: string | null; cancelled: boolean };
const NOT_MIRRORED: RevenueStatus = { mirrored: false, status: null, cancelled: false };
const CANCELLED: RevenueStatus = { mirrored: true, status: 'Cancelled', cancelled: true };

export function invoiceStatus(state: string | undefined, residual: number | string | null | undefined): RevenueStatus {
  if (state === 'cancel' || state === 'cancelled' || state === 'canceled') return CANCELLED;
  if (state !== 'posted') return NOT_MIRRORED;
  return { mirrored: true, status: centsOf(residual) === 0n ? 'Paid' : 'Unpaid', cancelled: false };
}

export function creditNoteStatus(state: string | undefined): RevenueStatus & { negative: true } {
  if (state === 'cancel' || state === 'cancelled' || state === 'canceled') return { ...CANCELLED, negative: true };
  return state === 'posted' ? { mirrored: true, status: 'Posted', cancelled: false, negative: true } : { ...NOT_MIRRORED, negative: true };
}

export function paymentStatus(state: string | undefined): RevenueStatus {
  if (state === 'paid' || state === 'reconciled') return { mirrored: true, status: 'Paid', cancelled: false };
  if (state === 'draft') return { mirrored: true, status: 'Scheduled', cancelled: false };
  if (state === 'canceled' || state === 'rejected') return CANCELLED;
  return NOT_MIRRORED;
}

const RECEIPT_SENT_STATES = new Set(['pending', 'committing', 'committed', 'quarantined', 'held', 'confirmed']);

function parseUtcTimestamp(value: string): number {
  // Odoo's `write_date` is UTC without an explicit zone; parse it as UTC instead of browser-local time.
  const timestamp = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
    ? `${value.replace(' ', 'T').replace(/Z$/, '')}Z`
    : value;
  return Date.parse(timestamp);
}

/** A posted receipt is not proof that the invoice read model has caught up. The proof is single-system
 *  (#1825): the receipt's own Odoo reference — the one the outbox recorded at commit, after the settle
 *  read-back verified that the receipt is reconciled with this invoice — appearing in the invoice's
 *  read-back (`odoo_matched_payment_refs`). Clocks decide nothing while that evidence stands.
 *  When no reference evidence exists (rows committed before it did, or commands with no recorded
 *  reference), the read falls back to comparing Odoo's `write_date` with the outbox's creation time —
 *  two clocks, so an Odoo clock running behind PMO's keeps the flag up until some later write moves
 *  `write_date` forward. `updated_at` is when the outbox confirms; Odoo may have already updated the
 *  invoice before then. */
export function invoiceReceiptAwaitingOdoo(input: {
  invoiceStatus: string;
  invoiceErpModified: string | null | undefined;
  receiptCommandState: string | null | undefined;
  receiptCommandCreatedAt: string | null | undefined;
  /** The receipt references the invoice read-back shows matched (`odoo_matched_payment_refs`). */
  invoiceMatchedPaymentRefs?: readonly string[] | null;
  /** The receipt's own Odoo reference the outbox recorded at commit (e.g. `account.payment:42`). */
  receiptCommandExternalRef?: string | null;
  /** Whether the committed command's read-back recorded the reference evidence (absent for rows finalized before #1825). */
  receiptCommandRecordedReadBack?: boolean;
}): boolean {
  if (input.invoiceStatus !== 'Submitted' && input.invoiceStatus !== 'Unpaid') return false;
  if (!input.receiptCommandState || !RECEIPT_SENT_STATES.has(input.receiptCommandState)) return false;
  // While the outbox is active, an invoice read can race the ERP POST that happens after row creation.
  // Active commands always wait; after completion the read-back evidence (or, without it, the clocks) decides.
  if (input.receiptCommandState === 'pending' || input.receiptCommandState === 'committing') return true;
  if (input.receiptCommandRecordedReadBack) {
    return !(input.receiptCommandExternalRef != null && input.invoiceMatchedPaymentRefs?.includes(input.receiptCommandExternalRef) === true);
  }
  // Ceiling: without the reference evidence this compares two clocks.
  if (!input.receiptCommandCreatedAt) return true;

  const commandAt = parseUtcTimestamp(input.receiptCommandCreatedAt);
  if (!Number.isFinite(commandAt)) return true;
  if (!input.invoiceErpModified) return true;
  const invoiceReadAt = parseUtcTimestamp(input.invoiceErpModified);
  return !Number.isFinite(invoiceReadAt) || invoiceReadAt <= commandAt;
}
