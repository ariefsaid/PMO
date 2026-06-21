/**
 * useProcurementRecordMutations — mutation hook for the four new ERP-canonical record types
 * (purchase_requests / rfqs / purchase_orders / payments) + their file uploads.
 *
 * Mirrors the shape of `useProcurementMutations` (useProcurementDetail.ts):
 *   - each mutation calls the security-definer RPC via the DAL (procurementRecords.ts)
 *   - each invalidates ['procurement', orgId, id] on success so the detail page refetches
 *   - errors propagate as ProcurementError (code preserved) for classifyMutationError
 *
 * org_id is NEVER sent — the security-definer RPCs re-assert auth context. (ADR-0016/0017)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  createPurchaseRequest,
  createRfq,
  createPurchaseOrder,
  createPayment,
  type PurchaseRequestRow,
  type RfqRow,
  type PurchaseOrderRow,
  type PaymentRow,
} from '@/src/lib/db/procurementRecords';
import { ProcurementError } from '@/src/lib/db/procurementLifecycle';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useProcurementDetail shape)
// ---------------------------------------------------------------------------

const procurementDetailKey = (orgId: string | undefined, id: string) =>
  ['procurement', orgId, id] as const;

// ---------------------------------------------------------------------------
// Input shapes (mirrored to RecordCaptureForm for type safety)
// ---------------------------------------------------------------------------

export interface CreatePurchaseRequestInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreateRfqInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePurchaseOrderInput {
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePaymentInput {
  invoiceId: string | null;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Returns create-mutations for the four new record types, each invalidating the
 * detail query on success. File uploads reuse `useProcurementFiles` from the calling
 * component (ProcurementFilesSubsection already supports all ProcPhase values).
 */
export function useProcurementRecordMutations(procurementId: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidateDetail = () =>
    qc.invalidateQueries({ queryKey: procurementDetailKey(orgId, procurementId) });

  const createPurchaseRequestMut = useMutation<
    PurchaseRequestRow,
    ProcurementError,
    CreatePurchaseRequestInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount }) =>
      createPurchaseRequest(procurementId, referenceNumber, status, date, amount),
    onSuccess: invalidateDetail,
  });

  const createRfqMut = useMutation<RfqRow, ProcurementError, CreateRfqInput>({
    mutationFn: ({ referenceNumber, status, date, amount }) =>
      createRfq(procurementId, referenceNumber, status, date, amount),
    onSuccess: invalidateDetail,
  });

  const createPurchaseOrderMut = useMutation<
    PurchaseOrderRow,
    ProcurementError,
    CreatePurchaseOrderInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount }) =>
      createPurchaseOrder(procurementId, referenceNumber, status, date, amount),
    onSuccess: invalidateDetail,
  });

  const createPaymentMut = useMutation<PaymentRow, ProcurementError, CreatePaymentInput>({
    mutationFn: ({ invoiceId, referenceNumber, status, date, amount }) =>
      createPayment(procurementId, invoiceId, referenceNumber, status, date, amount),
    onSuccess: invalidateDetail,
  });

  return {
    createPurchaseRequest: createPurchaseRequestMut,
    createRfq: createRfqMut,
    createPurchaseOrder: createPurchaseOrderMut,
    createPayment: createPaymentMut,
  };
}
