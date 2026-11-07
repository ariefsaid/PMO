import { AppError, toAppError } from '@/src/lib/appError';
import {
  applyNativeReceipt,
  cancelNativeReceipt,
  createNativeSalesInvoice,
  recordNativeOnAccountReceipt,
  recordNativeReceipt,
  transitionNativeSalesInvoice,
  unapplyNativeAllocation,
} from '@/src/lib/db/revenueNative';
import { newCommandIntent } from './commandIntent';
import type { CommandIntent, RevenueRepository } from './types';

/**
 * #784 (ADR-0055 addendum 2026-10-07): the PMO-native revenue writes the revenue repository routes to while no ERP owns
 * revenue for the org. Thin by design: migration 0275's RPCs enforce role, approval SoD, ownership and balances.
 */

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw toAppError(err);
  }
}

/** AC-NAR-004 (DD-NAR-11): a PMO invoice or receipt from before the ERP took revenue over is history — never pushed. */
export function nativeReadOnly(): AppError {
  return new AppError('this was recorded in PMO before the ERP was connected and is read-only', 'native-revenue-read-only');
}

/**
 * DD-NAR-1/7: PMO raises the invoice; the project decides its VAT, so it is required. A Draft has no number yet
 * (DD-NAR-9 mints it on approval), so the number is null rather than an empty string.
 */
export function createNativeInvoice(
  input: Parameters<RevenueRepository['createInvoice']>[0],
): Promise<{ id: string; si_number: string | null }> {
  const projectId = input.projectId;
  if (!projectId) {
    return Promise.reject(new AppError('an invoice raised in PMO needs a project — the project decides its VAT', 'native-invoice-needs-project'));
  }
  return wrap(() => createNativeSalesInvoice({
    projectId,
    customerId: input.customerId,
    lines: input.items,
    workOrderId: input.workOrderId ?? null,
    ...(input.billingKind ? { billingKind: input.billingKind } : {}),
  })).then((id) => ({ id, si_number: null }));
}

/**
 * FR-NAR-007: a PMO receipt settles a named PMO invoice; #1415: with no invoice named it is an ON-ACCOUNT receipt for the customer, applied
 * to invoices afterwards. The cash and withheld amounts are sent only as entered: the server defaults the split, so the client never
 * computes money. The on-account receipt's id is the form session's intent id: a retry after a lost response replays, never doubles.
 */
export function createNativePayment(
  input: Parameters<RevenueRepository['createPayment']>[0],
  intent?: CommandIntent,
): Promise<{ id: string; ip_number: string | null }> {
  const salesInvoiceId = input.salesInvoiceId;
  const split = {
    ...(input.receivedAmount !== undefined ? { receivedAmount: input.receivedAmount } : {}),
    ...(input.withheldAmount !== undefined ? { withheldAmount: input.withheldAmount } : {}),
    ...(input.withholdingSlipNumber ? { withholdingSlipNumber: input.withholdingSlipNumber } : {}),
  };
  if (!salesInvoiceId) {
    return wrap(() => recordNativeOnAccountReceipt({
      customerId: input.customerId,
      amount: input.paidAmount,
      ...split,
      date: input.date,
      receiptId: (intent ?? newCommandIntent()).id,
    })).then((id) => ({ id, ip_number: null }));
  }
  return wrap(() => recordNativeReceipt({
    salesInvoiceId,
    amount: input.paidAmount,
    ...split,
    // DD-NAR-17: the payment date is always sent — the server refuses a receipt without one.
    date: input.date,
  })).then((id) => ({ id, ip_number: null }));
}

/** #1415: apply a PMO receipt across invoices (the RPC refuses an over-allocation, a foreign id, an ERP-owned org). */
export const applyNativeReceiptToInvoices = (
  input: Parameters<RevenueRepository['applyReceipt']>[0],
): Promise<string[]> => wrap(() => applyNativeReceipt(input));

/** #1415: reverse one allocation of a PMO receipt; the RPC restates the invoice. */
export const unapplyNativeReceiptAllocation = (allocationId: string): Promise<void> =>
  wrap(() => unapplyNativeAllocation(allocationId));

/** FR-NAR-005: approve in PMO — the RPC enforces approver ≠ author and the approver's current role. */
export const approveNativeInvoice = (siId: string): Promise<void> => wrap(() => transitionNativeSalesInvoice(siId, 'Unpaid'));

/** FR-NAR-009: cancel a PMO invoice (Draft, or Unpaid with no live receipt — the RPC decides). */
export const cancelNativeInvoice = (siId: string): Promise<void> => wrap(() => transitionNativeSalesInvoice(siId, 'Cancelled'));

/** AC-NAR-006: cancel a PMO receipt; the RPC recomputes the invoice balance. */
export const cancelNativePayment = (ipId: string): Promise<void> => wrap(() => cancelNativeReceipt(ipId));
