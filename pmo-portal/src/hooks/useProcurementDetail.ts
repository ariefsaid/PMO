import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  getProcurementDetail,
  transitionProcurement,
  createQuotation as dalCreateQuotation,
  createReceipt as dalCreateReceipt,
  createInvoice as dalCreateInvoice,
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

  const transition = useMutation<void, Error, { to: ProcurementStatus; notes?: string }>({
    mutationFn: ({ to, notes }) => transitionProcurement(id, to, notes),
    onSuccess: invalidateDetail,
  });

  const createQuotation = useMutation<
    Tables<'procurement_quotations'>,
    Error,
    { vendorId: string; totalAmount: number; receivedDate: string }
  >({
    mutationFn: ({ vendorId, totalAmount, receivedDate }) =>
      dalCreateQuotation(id, vendorId, totalAmount, receivedDate),
    onSuccess: invalidateDetail,
  });

  const createReceipt = useMutation<
    ProcurementReceiptRow,
    Error,
    { status: 'Partial' | 'Complete'; receiptDate: string }
  >({
    mutationFn: ({ status, receiptDate }) => dalCreateReceipt(id, status, receiptDate),
    onSuccess: invalidateDetail,
  });

  const createInvoice = useMutation<
    ProcurementInvoiceRow,
    Error,
    { status: 'Received' | 'Scheduled' | 'Paid'; invoiceDate: string }
  >({
    mutationFn: ({ status, invoiceDate }) => dalCreateInvoice(id, status, invoiceDate),
    onSuccess: invalidateDetail,
  });

  return { transition, createQuotation, createReceipt, createInvoice };
}
