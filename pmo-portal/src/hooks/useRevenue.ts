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
import type { SalesInvoiceRow, IncomingPaymentRow } from '@/src/lib/db/revenue';

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
  return useQuery<
    Array<{ project_id: string | null; project_name: string | null; total_amount: number; open_ar: number; invoice_count: number }>
  >({
    queryKey: ['revenueByProject', orgId],
    queryFn: () => repositories.revenue.getRevenueByProject?.() ?? Promise.resolve([]),
    enabled: Boolean(orgId),
  });
}

/**
 * Revenue create / submit / cancel mutations over the repository seam.
 * Each invalidates the relevant query families on success.
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
  };

  const create = useMutation({
    mutationFn: (input: { customerId: string; projectId?: string | null; items: Array<{ item_code: string; qty: number; rate: number }> }) =>
      repositories.revenue.createInvoice(input),
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
    mutationFn: (siId: string) => repositories.revenue.submitInvoice(siId),
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
    mutationFn: (siId: string) => repositories.revenue.cancelInvoice(siId),
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
    mutationFn: (ipId: string) => repositories.revenue.cancelPayment(ipId),
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

  return { create, submitInvoice, cancelInvoice, cancelPayment, pendingPush };
}