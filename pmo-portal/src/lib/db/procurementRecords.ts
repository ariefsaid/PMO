import { supabase } from '@/src/lib/supabase/client';
import type { Tables } from '@/src/lib/supabase/database.types';
import { ProcurementError } from './procurementLifecycle';

// ---------------------------------------------------------------------------
// Procurement Record-type DAL (Slice 5.2, FR-PR-005/006/007/008/017).
//
// Thin security-definer RPC wrappers for the four new ERP-canonical record types
// (purchase_requests / rfqs / purchase_orders / payments). These are the inline-
// capture authority for records NOT minted by the transition RPC (FR-PR-017
// permissive capture). Mirrors the createReceipt / createInvoice pattern in
// procurementLifecycle.ts.
//
// CONTRACT (mirrors procurementLifecycle.ts / companies.ts):
//   • org_id is NEVER sent — the security-definer RPC re-asserts auth context.
//   • Every write rethrows a ProcurementError preserving the Postgres/PostgREST
//     .code (42501 role/org denial, P0002 proc-not-found, …) so the UI can
//     classify the toast via classifyMutationError.
//   • Reference-number is bounded client-side at the form layer (Slice 6).
// ---------------------------------------------------------------------------

export type PurchaseRequestRow = Tables<'purchase_requests'>;
export type RfqRow = Tables<'rfqs'>;
export type PurchaseOrderRow = Tables<'purchase_orders'>;
export type PaymentRow = Tables<'payments'>;

/** Shape of a Supabase RPC / PostgREST error (only the fields we surface). */
interface RpcErrorLike {
  message: string;
  code?: string;
}

/** Throws a ProcurementError preserving both message and Postgres code. */
function throwRpc(error: RpcErrorLike): never {
  throw new ProcurementError(error.message, error.code);
}

/**
 * Creates a purchase-request record via the security-definer RPC (AC-PR-004, FR-PR-017).
 * Mints a PR# server-side. org_id is NEVER sent; the RPC re-asserts authz + parent-org guard.
 */
export async function createPurchaseRequest(
  procurementId: string,
  referenceNumber: string | null,
  status: string | null,
  date: string | null,
  amount: number | null,
): Promise<PurchaseRequestRow> {
  const { data, error } = (await supabase.rpc('create_purchase_request', {
    p_procurement_id: procurementId,
    p_reference_number: referenceNumber,
    p_status: status,
    p_date: date,
    p_amount: amount,
  })) as unknown as { data: PurchaseRequestRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * Creates an RFQ record via the security-definer RPC (AC-PR-004, FR-PR-017).
 * Mints an RFQ# server-side. org_id is NEVER sent.
 */
export async function createRfq(
  procurementId: string,
  referenceNumber: string | null,
  status: string | null,
  date: string | null,
  amount: number | null,
): Promise<RfqRow> {
  const { data, error } = (await supabase.rpc('create_rfq', {
    p_procurement_id: procurementId,
    p_reference_number: referenceNumber,
    p_status: status,
    p_date: date,
    p_amount: amount,
  })) as unknown as { data: RfqRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * Creates a purchase-order record via the security-definer RPC (AC-PR-004, FR-PR-017).
 * Mints a PO# server-side. org_id is NEVER sent.
 */
export async function createPurchaseOrder(
  procurementId: string,
  referenceNumber: string | null,
  status: string | null,
  date: string | null,
  amount: number | null,
): Promise<PurchaseOrderRow> {
  const { data, error } = (await supabase.rpc('create_purchase_order', {
    p_procurement_id: procurementId,
    p_reference_number: referenceNumber,
    p_status: status,
    p_date: date,
    p_amount: amount,
  })) as unknown as { data: PurchaseOrderRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}

/**
 * Creates a payment record via the security-definer RPC (AC-PR-004, FR-PR-017).
 * Mints a PAY# server-side. The nullable `invoiceId` predecessor FK (FR-PR-004b)
 * is captured inline-optional (default null — the RPC accepts null). org_id is NEVER sent.
 */
export async function createPayment(
  procurementId: string,
  invoiceId: string | null,
  referenceNumber: string | null,
  status: string | null,
  date: string | null,
  amount: number | null,
): Promise<PaymentRow> {
  const { data, error } = (await supabase.rpc('create_payment', {
    p_procurement_id: procurementId,
    p_invoice_id: invoiceId,
    p_reference_number: referenceNumber,
    p_status: status,
    p_date: date,
    p_amount: amount,
  })) as unknown as { data: PaymentRow; error: RpcErrorLike | null };
  if (error) throwRpc(error);
  return data;
}
