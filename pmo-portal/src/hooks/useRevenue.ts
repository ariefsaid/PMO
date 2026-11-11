import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { safeTrack, trackInvoiceIssued, trackPaymentRecorded } from '@/src/lib/analytics';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';
import {
  IDLE_PENDING_PUSH,
  beginPush,
  pendingPushAfterWrite,
  type PendingPushState,
} from '@/src/lib/adapterSeam/pendingPush';
import type { SalesInvoiceRow, IncomingPaymentRow, RevenueByProjectRow, OverdueInvoiceFact, PaidPaymentFact } from '@/src/lib/db/revenue';
import type { SalesInvoiceEvidence } from '@/src/lib/adapterSeam/erpnext/invoiceEvidence';
import { getSalesInvoiceEvidence } from '@/src/lib/repositories/invoiceEvidence';
import type { CommandIntent } from '@/src/lib/repositories/types';
import type { AssignInvoiceProjectInput } from '@/src/lib/projectFinances';
import type { BillingKind } from '@/src/lib/billingKind';
import { efakturRefusal } from '@/src/lib/efaktur';
import { nativeDraftInvoicesKey } from './approvalsQueryKeys';
import { MONEY_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

export { nativeDraftInvoicesKey } from './approvalsQueryKeys';

/**
 * Org-scoped sales invoices list over the repository seam (ADR-0017).
 * queryKey includes org_id so the cache is tenant-scoped (FR-QRY).
 * Optional `projectId` narrows to one project.
 */
/** `enabled: false` reads nothing — an absent projectId alone means the org-wide list. */
export function useSalesInvoices(projectId?: string, { enabled = true }: { enabled?: boolean } = {}) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow[]>({
    queryKey: ['salesInvoices', orgId, projectId ?? 'all'],
    queryFn: () => repositories.revenue.listInvoices(projectId ? { projectId } : undefined),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Dashboard: open client invoices, narrow columns. Same `salesInvoices` key prefix, so every revenue mutation refreshes it. */
export function useOverdueInvoiceFacts(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<OverdueInvoiceFact[]>({
    queryKey: ['salesInvoices', orgId, 'overdue-facts'],
    queryFn: () => repositories.revenue.listOverdueInvoiceFacts(),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Billed work facts for a bounded monthly chart. */
export function useMonthlyInvoiceFacts(from: string, toExclusive: string, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['salesInvoices', orgId, 'monthly-facts', from, toExclusive],
    queryFn: () => repositories.revenue.listMonthlyInvoiceFacts(from, toExclusive),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Dashboard: Paid receipts, narrow columns. Same `incomingPayments` key prefix as the full list. */
export function usePaidPaymentFacts(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<PaidPaymentFact[]>({
    queryKey: ['incomingPayments', orgId, 'paid-facts'],
    queryFn: () => repositories.revenue.listPaidPaymentFacts(),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Dashboard empty-state evidence (issue 1973): does the org hold ANY client invoice, any status?
 *  The open-status facts read cannot tell — a drafted-only org is not an inactive org. Same
 *  `salesInvoices` key prefix, so revenue mutations refresh it alongside the figures. */
export function useHasAnySalesInvoice(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<boolean>({
    queryKey: ['salesInvoices', orgId, 'exists'],
    queryFn: () => repositories.revenue.hasAnySalesInvoice(),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Dashboard empty-state evidence (issue 1973): does the org hold ANY incoming payment, any status?
 *  The Scheduled-only org is exactly the case the Paid-status facts read misses. */
export function useHasAnyIncomingPayment(enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<boolean>({
    queryKey: ['incomingPayments', orgId, 'exists'],
    queryFn: () => repositories.revenue.hasAnyIncomingPayment(),
    enabled: enabled && Boolean(orgId),
    ...MONEY_QUERY_OPTIONS,
  });
}

/** Lazy read-only ERP evidence for an invoice detail; never fetched for PMO-native invoices. */
export function useSalesInvoiceEvidence(id: string | undefined, enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceEvidence>({
    queryKey: ['salesInvoiceEvidence', orgId, id],
    queryFn: () => getSalesInvoiceEvidence(id!),
    enabled: Boolean(orgId && id && enabled),
    retry: false,
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
    queryKey: nativeDraftInvoicesKey(orgId),
    queryFn: () => repositories.revenue.listInvoices({ status: 'Draft', nativeOnly: true }),
    enabled: Boolean(orgId) && enabled,
  });
}

/** Drafts raised in Odoo's PMO approval flow. The enabled flag keeps other revenue owners out of this read. */
export function useDraftInvoices(enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<SalesInvoiceRow[]>({
    queryKey: ['salesInvoices', orgId, 'odoo-drafts'],
    queryFn: () => repositories.revenue.listInvoices({ status: 'Draft' }),
    enabled: Boolean(orgId) && enabled,
  });
}

/**
 * Org-scoped incoming payments list over the repository seam (ADR-0017).
 * Optional `customerId` narrows to one customer.
 */
export function useIncomingPayments(customerId?: string, enabled = true, salesInvoiceId?: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<IncomingPaymentRow[]>({
    queryKey: ['incomingPayments', orgId, customerId ?? 'all', salesInvoiceId ?? 'all-invoices'],
    queryFn: () => repositories.revenue.listPayments({
      ...(customerId ? { customerId } : {}),
      ...(salesInvoiceId ? { salesInvoiceId } : {}),
    }),
    enabled: Boolean(orgId && enabled),
    ...MONEY_QUERY_OPTIONS,
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
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const realRole = useOptionalRealRole();
  const [pendingPush, setPendingPush] = useState<PendingPushState>(IDLE_PENDING_PUSH);
  const isExternal = routeDomainWrite('revenue') === 'external';

  const invalidateVatEligibility = () => qc.invalidateQueries({ queryKey: ['project-vat-editability'] });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['salesInvoices'] });
    qc.invalidateQueries({ queryKey: ['salesInvoice'] });
    qc.invalidateQueries({ queryKey: ['incomingPayments'] });
    qc.invalidateQueries({ queryKey: ['incomingPayment'] });
    qc.invalidateQueries({ queryKey: ['revenueByProject'] });
    // The rail's overdue badge is a separate count query. `staleTime` schedules nothing and the
    // cabinet's focus refetch is off, so an invoice/payment write must invalidate it explicitly or a
    // mounted rail keeps the old badge for the rest of the session.
    qc.invalidateQueries({ queryKey: ['overdue-invoice-count', orgId] });
    // OD-BILL-1: an invoice moves its work order's billing and the dashboard's still-to-invoice.
    qc.invalidateQueries({ queryKey: ['work-order-billing'] });
    qc.invalidateQueries({ queryKey: ['unbilled-work-orders'] });
    qc.invalidateQueries({ queryKey: ['project-finances', orgId] });
  };

  const create = useMutation({
    mutationFn: ({ intent, ...input }: { customerId: string; projectId?: string | null; workOrderId?: string | null; billingKind?: BillingKind; items: Array<{ item_code: string; qty: number; rate: number; description?: string }>; intent?: CommandIntent }) =>
      repositories.revenue.createInvoice(input, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      invalidateVatEligibility();
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
      invalidateVatEligibility();
      safeTrack(() => trackInvoiceIssued(realRole ?? 'unknown'));
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
      invalidateVatEligibility();
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
    mutationFn: ({ intent, ...input }: { customerId: string; salesInvoiceId?: string | null; paidAmount: number; receivedAmount: number; withheldAmount?: number; withholdingSlipNumber?: string | null; journalId?: string; date: string; intent?: CommandIntent }) =>
      repositories.revenue.createPayment(input, intent),
    onMutate: () => {
      if (isExternal) setPendingPush(beginPush(IDLE_PENDING_PUSH));
    },
    onSuccess: () => {
      invalidate();
      safeTrack(() => trackPaymentRecorded(realRole ?? 'unknown'));
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

  // #1415: apply a PMO receipt across invoices / take one allocation back. Both move invoice balances, so they invalidate
  // exactly what a receipt cancel does.
  const applyReceipt = useMutation({
    mutationFn: (input: { receiptId: string; allocations: Array<{ invoiceId: string; amount: number }>; requestId: string }) =>
      repositories.revenue.applyReceipt(input),
    onSuccess: invalidate,
  });

  const unapplyAllocation = useMutation({
    mutationFn: ({ allocationId }: { allocationId: string }) => repositories.revenue.unapplyAllocation(allocationId),
    onSuccess: invalidate,
  });

  return { create, setReceivedDate, setEfaktur, createPayment, submitInvoice, cancelInvoice, cancelPayment, applyReceipt, unapplyAllocation, pendingPush };
}

export function useAssignInvoiceProject() {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useMutation({
    mutationFn: ({ siId, projectId, oldProjectId, billingKind }: AssignInvoiceProjectInput) => {
      // Same project + a kind: the narrow correction (works for native, authored and paid invoices too, FR-004).
      if (billingKind !== undefined && oldProjectId === projectId) return repositories.revenue.setBillingKind(siId, billingKind);
      return billingKind === undefined
        ? repositories.revenue.setProject(siId, projectId)
        : repositories.revenue.setProject(siId, projectId, billingKind);
    },
    onSuccess: (_data, { siId, projectId, oldProjectId }) => {
      const projectIds = [...new Set([oldProjectId, projectId].filter((id): id is string => Boolean(id)))];
      const keys: readonly (readonly unknown[])[] = [
        ['salesInvoices', orgId], ['salesInvoice', orgId, siId], ['incomingPayments', orgId],
        ['incomingPayment', orgId], ['revenueByProject', orgId], ['project-vat-editability'],
        ['overdue-invoice-count', orgId],
        ['record-history', orgId, 'sales_invoice', siId],
        ...projectIds.flatMap((id) => [
          ['project-finances', orgId, id], ['record-history', orgId, 'project', id],
        ]),
      ];
      // The attribution write is complete; let the modal close before background refetches finish.
      // invalidateQueries marks each key stale synchronously and refreshes active readers without
      // coupling the user-visible save latency to unrelated query/network work.
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey });
    },
  });
}
