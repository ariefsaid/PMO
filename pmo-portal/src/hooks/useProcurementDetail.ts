import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation as dalCreateQuotation,
  createReceipt as dalCreateReceipt,
  createInvoice as dalCreateInvoice,
  captureVendorInvoice as dalCaptureVendorInvoice,
  ProcurementError,
  type ProcurementDetail,
  type ProcurementStatus,
  type ProcurementReceiptRow,
  type ProcurementInvoiceRow,
} from '@/src/lib/db/procurementLifecycle';
import type { Tables } from '@/src/lib/supabase/database.types';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useBudget pattern, AC-816)
// ---------------------------------------------------------------------------

const procurementDetailKey = (orgId: string | undefined, id: string | undefined) =>
  ['procurement', orgId, id] as const;

// ---------------------------------------------------------------------------
// Read hook (C1)
// ---------------------------------------------------------------------------

/**
 * Fetches the full procurement detail (header + quotations + receipts + invoices).
 * Cache key is org-scoped: ['procurement', orgId, id] (AC-816).
 * Disabled when orgId or id are falsy.
 */
export function useProcurementDetail(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  return useQuery<ProcurementDetail>({
    queryKey: procurementDetailKey(orgId, id),
    queryFn: () => getProcurementDetail(id!),
    enabled: Boolean(orgId && id),
  });
}

// ---------------------------------------------------------------------------
// Mutation hook (C2) — transition + child-creation; each invalidates detail key
// ---------------------------------------------------------------------------

/**
 * All procurement lifecycle mutations for a single procurement.
 * Each mutation invalidates ['procurement', orgId, id] on success (AC-816).
 */
export function useProcurementMutations(id: string) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidateDetail = () => {
    queryClient.invalidateQueries({ queryKey: procurementDetailKey(orgId, id) });
  };

  // Error type is ProcurementError so consumers can read `.code` (P0001 /
  // 42501) type-safely and classify the toast (no code-dropping).
  const transition = useMutation<void, ProcurementError, { to: ProcurementStatus; notes?: string }>({
    mutationFn: ({ to, notes }) => transitionProcurement(id, to, notes),
    onSuccess: invalidateDetail,
  });

  const createQuotation = useMutation<
    Tables<'procurement_quotations'>,
    ProcurementError,
    { vendorId: string; totalAmount: number; receivedDate: string }
  >({
    mutationFn: ({ vendorId, totalAmount, receivedDate }) =>
      dalCreateQuotation(id, vendorId, totalAmount, receivedDate),
    onSuccess: invalidateDetail,
  });

  const createReceipt = useMutation<
    ProcurementReceiptRow,
    ProcurementError,
    { status: 'Partial' | 'Complete'; receiptDate: string; referenceNumber?: string | null }
  >({
    mutationFn: ({ status, receiptDate, referenceNumber }) =>
      dalCreateReceipt(id, status, receiptDate, referenceNumber),
    onSuccess: invalidateDetail,
  });

  const createInvoice = useMutation<
    ProcurementInvoiceRow,
    ProcurementError,
    { status: 'Received' | 'Scheduled' | 'Paid'; invoiceDate: string; referenceNumber?: string | null; amount?: number | null }
  >({
    mutationFn: ({ status, invoiceDate, referenceNumber, amount }) =>
      dalCreateInvoice(id, status, invoiceDate, referenceNumber, amount),
    onSuccess: invalidateDetail,
  });

  // harden #2: atomic VI capture — transition→Vendor Invoiced + invoice-create + status-event in ONE
  // RPC (SoD reused, not bypassed). Replaces the old two-write FE sequence that could advance the
  // case with no invoice on a partial failure.
  const captureVendorInvoice = useMutation<
    ProcurementInvoiceRow,
    ProcurementError,
    {
      status: 'Received' | 'Scheduled';
      invoiceDate: string;
      referenceNumber?: string | null;
      amount?: number | null;
      notes?: string | null;
    }
  >({
    mutationFn: ({ status, invoiceDate, referenceNumber, amount, notes }) =>
      dalCaptureVendorInvoice(id, status, invoiceDate, referenceNumber, amount, notes),
    onSuccess: invalidateDetail,
  });

  return { transition, createQuotation, createReceipt, createInvoice, captureVendorInvoice };
}
