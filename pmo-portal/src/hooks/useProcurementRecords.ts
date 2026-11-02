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
import {
  repositories,
  type ProcurementError,
  type PurchaseRequestRow,
  type RfqRow,
  type PurchaseOrderRow,
  type PaymentRow,
} from '@/src/lib/repositories';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';
import { cachedProcurementProjectId, invalidateProcurementCase, procurementDetailKey } from '@/src/hooks/procurementQueryKeys';
import type { CommandIntent } from '@/src/lib/repositories/types';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useProcurementDetail shape)
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Input shapes (mirrored to RecordCaptureForm for type safety)
// ---------------------------------------------------------------------------

export interface CreatePurchaseRequestInput {
  /** #769: optional parent-group number (`external_ref`). */
  externalRef?: string | null;
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
  /** #769: optional parent-group number (`external_ref`). */
  externalRef?: string | null;
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

  const invalidateDetail = () => {
    invalidateProcurementCase(qc, orgId, procurementId, [cachedProcurementProjectId(qc, orgId, procurementId)]);
    qc.invalidateQueries({ queryKey: ['procurement-item-eligibility', orgId, procurementId] });
  };

  // Shared pending-push state across the four record-creation kinds — only one capture form is
  // open at a time (LedgerCaptureRow, task FIX-1). Stays idle for PMO-owned orgs.
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  // FR-ECA-030: a payment on a purchase ordered before the ERP connection is recorded in PMO (the repository routes it
  // there), so it has no push state. The flag rides the loaded detail; the other kinds on that case are still sent.
  const isPreCutover = () =>
    qc.getQueriesData<{ pre_cutover?: boolean }>({ queryKey: procurementDetailKey(orgId, procurementId) }).some(([, d]) => d?.pre_cutover === true);
  const handlers = (payment: boolean) => {
    const isExternal = () => routeDomainWrite('procurement') === 'external' && !(payment && isPreCutover());
    return {
      onMutate: () => {
        if (isExternal()) {
          qc.setQueryData(['procurement-item-eligibility', orgId, procurementId], false);
          setPendingPush(beginPush(IDLE_PENDING_PUSH));
        }
      },
      onSuccess: () => {
        invalidateDetail();
        if (isExternal()) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
      },
      onError: (err: unknown) => {
        if (isExternal()) {
          qc.invalidateQueries({ queryKey: ['procurement-item-eligibility', orgId, procurementId] });
          setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
        }
      },
    };
  };

  const createPurchaseRequestMut = useMutation<
    PurchaseRequestRow,
    ProcurementError,
    CreatePurchaseRequestInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount, intent, externalRef }) =>
      externalRef
        ? repositories.procurement.createPurchaseRequest(procurementId, referenceNumber, status, date, amount, intent, externalRef)
        : repositories.procurement.createPurchaseRequest(procurementId, referenceNumber, status, date, amount, intent),
    ...handlers(false),
  });

  const createRfqMut = useMutation<RfqRow, ProcurementError, CreateRfqInput>({
    mutationFn: ({ referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createRfq(procurementId, referenceNumber, status, date, amount, intent),
    ...handlers(false),
  });

  const createPurchaseOrderMut = useMutation<
    PurchaseOrderRow,
    ProcurementError,
    CreatePurchaseOrderInput
  >({
    mutationFn: ({ referenceNumber, status, date, amount, intent, externalRef }) =>
      externalRef
        ? repositories.procurement.createPurchaseOrder(procurementId, referenceNumber, status, date, amount, intent, externalRef)
        : repositories.procurement.createPurchaseOrder(procurementId, referenceNumber, status, date, amount, intent),
    ...handlers(false),
  });

  const createPaymentMut = useMutation<PaymentRow, ProcurementError, CreatePaymentInput>({
    mutationFn: ({ invoiceId, referenceNumber, status, date, amount, intent }) =>
      repositories.procurement.createPayment(procurementId, invoiceId, referenceNumber, status, date, amount, intent),
    ...handlers(true),
  });

  return {
    createPurchaseRequest: createPurchaseRequestMut,
    createRfq: createRfqMut,
    createPurchaseOrder: createPurchaseOrderMut,
    createPayment: createPaymentMut,
    pendingPush,
  };
}
