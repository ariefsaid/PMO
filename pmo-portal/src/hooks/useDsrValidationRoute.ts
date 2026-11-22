import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/auth/useAuth';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import type { DsrValidationRoute } from '@/src/lib/db/dsrValidationRoute';
import { repositories } from '@/src/lib/repositories';

// Chrome-adjacent read: outside a query provider or a session, and until enabled, it is simply off.
const IDLE_CLIENT = new QueryClient();

// Assignment / role changes can happen in another session while the report stays open.
const ELIGIBILITY_REFRESH_MS = 60_000;

/** Cache key for ONE report's server-computed route (real org + user + report; never a client org argument). */
export const dsrValidationRouteKey = (
  orgId: string | undefined,
  userId: string | undefined,
  reportId: string | null | undefined,
) => ['dsr-validation-route', orgId, userId, reportId ?? null] as const;

/**
 * fix-waiting item 3 (FR-WAIT-006) — the route of the ONE visible Submitted report the screen is
 * showing. Disabled for a null id (the page only passes a Submitted report), so a draft or returned
 * report pays nothing. The repository is the typed seam over `get_dsr_validation_route`; no org id is
 * ever sent.
 */
export function useDsrValidationRoute(reportId: string | null | undefined) {
  const qc = useContext(QueryClientContext);
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  return useQuery<DsrValidationRoute>({
    queryKey: dsrValidationRouteKey(orgId, userId, reportId),
    queryFn: () => repositories.dailySiteReport.validationRoute(reportId as string),
    // A query provider is required for the read; without one (some page suites) it stays off rather
    // than reaching the network. `reportId` alone decides the one-report scope.
    enabled: Boolean(qc && orgId && userId && reportId),
    refetchInterval: ELIGIBILITY_REFRESH_MS,
  }, qc ?? IDLE_CLIENT);
}

export interface DsrWaitingRoleLabels {
  /** The localized word for a coarse user_role ("Project Manager", "Finance", …), from the role-label seam. */
  role: (role: string) => string;
  /** The Admin/Finance alternative (waitingList:waitingFor.roleFinanceAdmin). */
  financeAdmin: string;
  /** The proven-empty route (siteReport:detail.nobodyCanValidate). */
  nobody: string;
  /** A failed route read (common:uxs32.routeUnavailable). */
  unavailable: string;
}

/**
 * Words the route for the requester. The named project manager is spoken with the database's own
 * role word ("Project Manager") through the existing role-label seam, never a generic relabel;
 * Admin/Finance are spoken as the true role-level alternatives. Loading/pending is the caller's
 * concern; this only turns COMPLETE server facts into the shared sentence. `unavailable` is not a
 * route to show (the page is not on a Submitted report).
 *
 * A known empty route says, in the reader's language, that nobody active can validate right now — it
 * never invents a project approver for a project with no (eligible) PM.
 */
export function dsrWaitingForText(
  route: DsrValidationRoute | null | undefined,
  t: TFunction,
  labels: DsrWaitingRoleLabels,
): string | null {
  if (!route || route.routeKind === 'unavailable') return null;
  if (route.routeKind === 'nobody') return labels.nobody;
  if (route.routeKind === 'finance_admin') {
    return waitingForText({ names: [], role: labels.financeAdmin }, t);
  }
  const pm = route.approvers[0] ?? null;
  // The server always names the PM on a project-manager route; a body without one is not a route to
  // show (showing "nobody" would be a claim it did not make).
  if (!pm) return null;
  // The real role word; a label missing from the seam falls back to the stored enum value.
  const roleWord = labels.role(pm.role)?.trim() || pm.role;
  return waitingForText({
    names: [pm.name],
    role: roleWord,
    alternativeRoles: [labels.financeAdmin],
  }, t);
}
