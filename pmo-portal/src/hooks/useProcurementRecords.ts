/**
 * useProcurementRecordMutations — mutation hook for the four new ERP-canonical record types
 * (purchase_requests / rfqs / purchase_orders / payments) + their file uploads.
 *
 * Mirrors the shape of `useProcurementMutations` (useProcurementDetail.ts):
 *   - each mutation calls the `repositories.procurement.*` seam (task FIX-1, Discover CRITICAL 1 —
 *     was calling the DAL directly, which bypassed Slice 1's `routeDomainWrite('procurement')`
 *     guard and local-wrote with a false success on a flipped org)
 *   - each invalidates ['procurement', orgId, id] on success so the detail page refetches
 *   - errors propagate as ProcurementError (code preserved) for classifyMutationError
 *   - a shared `pendingPush` state surfaces pushing/pushed/push-failed for the capture UI
 *     (TaskPushBadge, the P1 idiom) — stays idle for PMO-owned orgs
 *
 * BLOCK 2 (MONEY-CRITICAL, ADR-0058): each create takes the caller's `intent` — the command
 * identity minted ONCE per capture-form session and passed VERBATIM on every attempt, so a retry
 * after a lost response reconciles the already-committed ERP doc instead of POSTing a second money
 * document. The hook never mints it: only the UI knows where one user intent ends.
 *
 * org_id is NEVER sent — the security-definer RPCs re-assert auth context. (ADR-0016/0017)
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { repositories } from '@/src/lib/repositories';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';
import type {
  PurchaseRequestRow,
  RfqRow,
  PurchaseOrderRow,
  PaymentRow,
} from '@/src/lib/db/procurementRecords';
import { ProcurementError } from '@/src/lib/db/procurementLifecycle';
import type { CommandIntent } from '@/src/lib/repositories/types';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useProcurementDetail shape)
// ---------------------------------------------------------------------------

const procurementDetailKey = (orgId: string | undefined, id: string) =>
  ['procurement', orgId, id] as const;

// ---------------------------------------------------------------------------
// Input shapes (mirrored to RecordCaptureForm for type safety)
// ---------------------------------------------------------------------------

export interface CreatePurchaseRequestInput {
  /** BLOCK 2: the per-INTENT command identity — the SAME value on every retry (see CommandIntent). */
  intent?: CommandIntent;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreateRfqInput {
  /** BLOCK 2: the per-INTENT command identity — the SAME value on every retry (see CommandIntent). */
  intent?: CommandIntent;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePurchaseOrderInput {
  /** BLOCK 2: the per-INTENT command identity — the SAME value on every retry (see CommandIntent). */
  intent?: CommandIntent;
  referenceNumber: string | null;
  status: string | null;
  date: string | null;
  amount: number | null;
}

export interface CreatePaymentInput {
  /** BLOCK 2: the per-INTENT command identity — the SAME value on every retry (see CommandIntent). */
  intent?: CommandIntent;
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

  // Shared pending-push state across the four record-creation kinds — only one capture form is
  // open at a time (LedgerCaptureRow, task FIX-1). Stays idle for PMO-owned orgs.
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  const isExternal = () => routeDomainWrite('procurement') === 'external';
  const onMutate = () => {
    if (isExternal()) setPendingPush(beginPush(IDLE_PENDING_PUSH));
  };
  const onSettledOk = () => {
    invalidateDetail();
    if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
  };
  const onSettledErr = (err: unknown) => {
    if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
  };

  const createPurchaseRequestMut = useMutation<
    PurchaseRequestRow,
    ProcurementError,
    CreatePurchaseRequestInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createPurchaseRequest(procurementId, referenceNumber, status, date, amount, intent),
    onMutate,
    onSuccess: onSettledOk,
    onError: onSettledErr,
  });

  const createRfqMut = useMutation<RfqRow, ProcurementError, CreateRfqInput>({
    mutationFn: ({ referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createRfq(procurementId, referenceNumber, status, date, amount, intent),
    onMutate,
    onSuccess: onSettledOk,
    onError: onSettledErr,
  });

  const createPurchaseOrderMut = useMutation<
    PurchaseOrderRow,
    ProcurementError,
    CreatePurchaseOrderInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createPurchaseOrder(procurementId, referenceNumber, status, date, amount, intent),
    onMutate,
    onSuccess: onSettledOk,
    onError: onSettledErr,
  });

  const createPaymentMut = useMutation<PaymentRow, ProcurementError, CreatePaymentInput>({
    mutationFn: ({ invoiceId, referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createPayment(procurementId, invoiceId, referenceNumber, status, date, amount, intent),
    onMutate,
    onSuccess: onSettledOk,
    onError: onSettledErr,
  });

  return {
    createPurchaseRequest: createPurchaseRequestMut,
    createRfq: createRfqMut,
    createPurchaseOrder: createPurchaseOrderMut,
    createPayment: createPaymentMut,
    pendingPush,
  };
}
