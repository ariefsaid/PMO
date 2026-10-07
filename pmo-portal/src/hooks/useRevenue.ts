import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';
import type { SalesInvoiceRow, IncomingPaymentRow, RevenueByProjectRow } from '@/src/lib/db/revenue';
import type { CommandIntent } from '@/src/lib/repositories/types';
import { efakturRefusal } from '@/src/lib/efaktur';

/**
 * Org-scoped sales invoices list over the repository seam (ADR-0017).
 * queryKey includes org_id so the cache is tenant-scoped (FR-QRY).
 * Optional `projectId` narrows to one project.
 */
export function useSalesInvoices(projectId?: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow[]>({
    queryKey: ['salesInvoices', orgId, projectId ?? 'all'],
    queryFn: () => repositories.revenue.listInvoices(projectId ? { projectId } : undefined),
    enabled: Boolean(orgId),
  });
}

/**
 * A single sales invoice by id over the repository seam (ADR-0017).
 * queryKey includes org_id so the cache is tenant-scoped; disabled until both
 * an org and an id are present. Returns `null` when the record is absent or
 * RLS-scoped out (the page renders a calm not-found).
 */
export function useSalesInvoice(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow | null>({
    queryKey: ['salesInvoice', orgId, id],
    queryFn: () => repositories.revenue.getInvoice(id!),
    enabled: Boolean(orgId && id),
  });
}

/**
 * #784 (DD-NAR-12): the PMO drafts the approvals queue offers — PMO-native Drafts only (partial index
 * sales_invoices_native_draft_idx). `enabled` lets the queue skip the read for a viewer who cannot approve.
 * Shares the 'salesInvoices' key prefix, so every revenue mutation's invalidation refreshes it.
 */
export function useNativeDraftInvoices(enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow[]>({
    queryKey: ['salesInvoices', orgId, 'native-drafts'],
    queryFn: () => repositories.revenue.listInvoices({ status: 'Draft', nativeOnly: true }),
    enabled: Boolean(orgId) && enabled,
  });
}

/**
 * Org-scoped incoming payments list over the repository seam (ADR-0017).
 * Optional `customerId` narrows to one customer.
 */
export function useIncomingPayments(customerId?: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncomingPaymentRow[]>({
    queryKey: ['incomingPayments', orgId, customerId ?? 'all'],
    queryFn: () => repositories.revenue.listPayments(customerId ? { customerId } : undefined),
    enabled: Boolean(orgId),
  });
}

/**
 * A single incoming payment by id over the repository seam (ADR-0017).
 */
export function useIncomingPayment(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncomingPaymentRow | null>({
    queryKey: ['incomingPayment', orgId, id],
    queryFn: () => repositories.revenue.getPayment(id!),
    enabled: Boolean(orgId && id),
  });
}

/**
 * Revenue per project rollup — SUM(amount) grouped by project_id, with an
 * 'Unassigned' bucket for null project_id (when require_project_on_si is OFF).
 * Consumes the read-model DAL directly via repository; never threads org_id.
 */
export function useRevenuePerProject() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<RevenueByProjectRow[]>({
    queryKey: ['revenueByProject', orgId],
    queryFn: () => repositories.revenue.getRevenueByProject?.() ?? Promise.resolve([]),
    enabled: Boolean(orgId),
  });
}

/**
 * Revenue create / submit / cancel mutations over the repository seam.
 * Each invalidates the relevant query families on success.
 *
 * BLOCK 2 (MONEY-CRITICAL, ADR-0058): every mutation takes the caller's `intent` — the command
 * identity minted ONCE per form / confirm session (`useCommandIntent` / `useCommandIntentMap`) and
 * passed VERBATIM on every attempt. The hook deliberately does NOT mint it: only the UI knows when
 * one user intent ends and the next begins, and a hook-owned identity would let a retry after a lost
 * response POST a SECOND submitted money document. It stays optional so non-retrying call sites
 * (and the existing tests) keep the legacy per-attempt minting inside the repository.
 */
export function useRevenueMutations() {
  const qc = useQueryClient();
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  const isExternal = routeDomainWrite('revenue') === 'external';

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['salesInvoices'] });
    qc.invalidateQueries({ queryKey: ['salesInvoice'] });
    qc.invalidateQueries({ queryKey: ['incomingPayments'] });
    qc.invalidateQueries({ queryKey: ['incomingPayment'] });
    qc.invalidateQueries({ queryKey: ['revenueByProject'] });
    // OD-BILL-1: an invoice moves its work order's billing and the dashboard's still-to-invoice.
    qc.invalidateQueries({ queryKey: ['work-order-billing'] });
    qc.invalidateQueries({ queryKey: ['unbilled-work-orders'] });
  };

  const create = useMutation({
    mutationFn: ({ intent, ...input }: { customerId: string; projectId?: string | null; workOrderId?: string | null; items: Array<{ item_code: string; qty: number; rate: number; description?: string }>; intent?: CommandIntent }) =>
      repositories.revenue.createInvoice(input, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const submitInvoice = useMutation({
    mutationFn: ({ siId, intent }: { siId: string; intent?: CommandIntent }) =>
      repositories.revenue.submitInvoice(siId, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const cancelInvoice = useMutation({
    mutationFn: ({ siId, intent }: { siId: string; intent?: CommandIntent }) =>
      repositories.revenue.cancelInvoice(siId, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const setReceivedDate = useMutation({
    mutationFn: ({ siId, receivedDate }: { siId: string; receivedDate: string | null }) =>
      repositories.revenue.setReceivedDate(siId, receivedDate),
    onSuccess: invalidate,
  });

  // DD-EFK-1: these PMO-owned facts are written directly even when revenue is ERP-owned.
  const setEfaktur = useMutation({
    mutationFn: ({ siId, efakturNumber, efakturDate }: {
      siId: string; efakturNumber: string | null; efakturDate: string | null;
    }) => repositories.revenue.setEfaktur(siId, { efakturNumber, efakturDate }),
    onSuccess: invalidate,
    // A known refusal (e.g. the invoice was cancelled meanwhile) means this row is stale: refetch it.
    onError: (err) => {
      if (efakturRefusal(err)) invalidate();
    },
  });


  const createPayment = useMutation({
    mutationFn: ({ intent, ...input }: { customerId: string; salesInvoiceId?: string | null; paidAmount: number; receivedAmount: number; withheldAmount?: number; withholdingSlipNumber?: string | null; date: string; intent?: CommandIntent }) =>
      repositories.revenue.createPayment(input, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  const cancelPayment = useMutation({
    mutationFn: ({ ipId, intent }: { ipId: string; intent?: CommandIntent }) =>
      repositories.revenue.cancelPayment(ipId, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: true }));
    },
    onError: (err) => {
      if (isExternal) setPendingPush(pendingPushAfterWrite('external', { ok: false, err }));
    },
  });

  return { create, setReceivedDate, setEfaktur, createPayment, submitInvoice, cancelInvoice, cancelPayment, pendingPush };
}
