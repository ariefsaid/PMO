import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/auth/useAuth';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import type { InvoiceApprovalRoute } from '@/src/lib/db/invoiceApprovalRoute';
import { invoiceApprovalRouteRepository } from '@/src/lib/repositories/invoiceApprovalRoute';

// Chrome-adjacent read: outside a query provider or a session, and until enabled, it is simply off.
const IDLE_CLIENT = new QueryClient();

// Role / membership changes can happen in another session while the invoice stays open.
const ELIGIBILITY_REFRESH_MS = 60_000;

/** Cache key for ONE invoice's server-computed route (real org + user + invoice; never a client org argument). */
export const invoiceApprovalRouteKey = (
  orgId: string | undefined,
  userId: string | undefined,
  invoiceId: string | null | undefined,
) => ['invoice-approval-route', orgId, userId, invoiceId ?? null] as const;

/**
 * fix-waiting item 3 (FR-WAIT-006) — the route of the ONE visible PMO-native Draft invoice the screen is
 * showing. Disabled for a null id (the page only passes a native Draft), so any other invoice pays nothing.
 * The standalone repository is the typed seam over `get_invoice_approval_route`; no org id is ever sent.
 *
 * `retry: false` because a refusal is a fact: the screen offers its own retry instead of silently hammering
 * the database, and an error never reads as an empty route.
 */
export function useInvoiceApprovalRoute(invoiceId: string | null | undefined) {
  const qc = useContext(QueryClientContext);
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  return useQuery<InvoiceApprovalRoute>({
    queryKey: invoiceApprovalRouteKey(orgId, userId, invoiceId),
    queryFn: () => invoiceApprovalRouteRepository.get(invoiceId as string),
    // A query provider is required for the read; without one (some page suites) it stays off rather
    // than reaching the network. `invoiceId` alone decides the one-invoice scope.
    enabled: Boolean(qc && orgId && userId && invoiceId),
    refetchInterval: ELIGIBILITY_REFRESH_MS,
    retry: false,
  }, qc ?? IDLE_CLIENT);
}

export interface InvoiceWaitingRoleLabels {
  /** The reader's language word for a coarse user_role ("Finance", "Admin"), from the role-label seam. */
  role: (role: string) => string;
}

/**
 * Words the route for the requester. Every name and role is a fact the database returned: the eligible
 * Finance/Admin people the transition would let approve the invoice, already minus the primary author and
 * every co-author. Nothing here invents a person or falls back to a static role sentence.
 *
 * `nobody` and `missing_author` are distinct server facts and are spoken as such; `unavailable` is not a
 * route to show (the page is not on a visible PMO-native Draft). Pending and error are the caller's concern.
 */
export function invoiceWaitingForText(
  route: InvoiceApprovalRoute | null | undefined,
  t: TFunction,
  labels: InvoiceWaitingRoleLabels,
): string | null {
  if (!route || route.routeKind === 'unavailable') return null;
  if (route.routeKind === 'missing_author') {
    return t('finance:invoice.waiting.missingAuthor', 'This invoice has no recorded author, so it cannot be approved yet.');
  }
  if (route.routeKind === 'nobody') {
    return t('finance:invoice.waiting.nobody', 'No other Finance or Admin can approve this invoice right now.');
  }

  // A named route: each person is spoken as "<name>, <role>"; a blank server name falls back to the role word.
  const people: string[] = [];
  for (const approver of route.approvers) {
    const role = labels.role(approver.role)?.trim() || approver.role;
    const name = approver.name.trim();
    const who = name ? (role ? `${name}, ${role}` : name) : role;
    if (who && !people.includes(who)) people.push(who);
  }
  // The server always names at least one person on a named route; a body without one is not a route to
  // show (showing "nobody" would be a claim it did not make).
  if (people.length === 0) return null;
  return waitingForText({ names: people }, t);
}
