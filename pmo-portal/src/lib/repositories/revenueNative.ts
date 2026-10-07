import { AppError, toAppError } from '@/src/lib/appError';
import {
  cancelNativeReceipt,
  createNativeSalesInvoice,
  recordNativeReceipt,
  transitionNativeSalesInvoice,
} from '@/src/lib/db/revenueNative';
import type { RevenueRepository } from './types';

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
  })).then((id) => ({ id, si_number: null }));
}

/**
 * FR-NAR-007: a PMO receipt settles a named PMO invoice — there is no on-account receipt without an ERP. The cash and
 * withheld amounts are sent only as entered: the server defaults the split, so the client never computes money.
 */
export function createNativePayment(
  input: Parameters<RevenueRepository['createPayment']>[0],
): Promise<{ id: string; ip_number: string | null }> {
  const salesInvoiceId = input.salesInvoiceId;
  if (!salesInvoiceId) {
    return Promise.reject(new AppError('a receipt recorded in PMO must name the invoice it settles', 'native-receipt-needs-invoice'));
  }
  return wrap(() => recordNativeReceipt({
    salesInvoiceId,
    amount: input.paidAmount,
    ...(input.receivedAmount !== undefined ? { receivedAmount: input.receivedAmount } : {}),
    ...(input.withheldAmount !== undefined ? { withheldAmount: input.withheldAmount } : {}),
    ...(input.withholdingSlipNumber ? { withholdingSlipNumber: input.withholdingSlipNumber } : {}),
    // DD-NAR-17: the payment date is always sent — the server refuses a receipt without one.
    date: input.date,
  })).then((id) => ({ id, ip_number: null }));
}

/** FR-NAR-005: approve in PMO — the RPC enforces approver ≠ author and the approver's current role. */
export const approveNativeInvoice = (siId: string): Promise<void> => wrap(() => transitionNativeSalesInvoice(siId, 'Unpaid'));

/** FR-NAR-009: cancel a PMO invoice (Draft, or Unpaid with no live receipt — the RPC decides). */
export const cancelNativeInvoice = (siId: string): Promise<void> => wrap(() => transitionNativeSalesInvoice(siId, 'Cancelled'));

/** AC-NAR-006: cancel a PMO receipt; the RPC recomputes the invoice balance. */
export const cancelNativePayment = (ipId: string): Promise<void> => wrap(() => cancelNativeReceipt(ipId));
