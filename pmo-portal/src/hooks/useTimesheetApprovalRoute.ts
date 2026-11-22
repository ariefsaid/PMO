import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/auth/useAuth';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import type { TimesheetApprovalRoute } from '@/src/lib/db/timesheetApprovalRoute';
import { repositories } from '@/src/lib/repositories';

// Chrome-adjacent read: outside a query provider or a session, and until enabled, it is simply off.
const IDLE_CLIENT = new QueryClient();

// Assignment / role changes can happen in another session while the sheet stays open.
const ELIGIBILITY_REFRESH_MS = 60_000;

/** Cache key for ONE sheet's server-computed route (real org + user + sheet; never a client org argument). */
export const timesheetApprovalRouteKey = (
  orgId: string | undefined,
  userId: string | undefined,
  timesheetId: string | null | undefined,
) => ['timesheet-approval-route', orgId, userId, timesheetId ?? null] as const;

/** Prefix used by the existing timesheet transitions to invalidate every open route of this user. */
export const timesheetApprovalRouteScope = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheet-approval-route', orgId, userId] as const;

/**
 * fix-waiting item 3 (FR-WAIT-006) — the route of the ONE visible Submitted week the screen is showing.
 * Disabled for a null id (the page only passes a Submitted sheet), so a draft or absent week pays
 * nothing. The repository is the typed seam over `get_timesheet_approval_route`; no org id is ever sent.
 */
export function useTimesheetApprovalRoute(timesheetId: string | null | undefined) {
  const qc = useContext(QueryClientContext);
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  return useQuery<TimesheetApprovalRoute>({
    queryKey: timesheetApprovalRouteKey(orgId, userId, timesheetId),
    queryFn: () => repositories.timesheet.getApprovalRoute(timesheetId as string),
    // A query provider is required for the read; without one (some page suites) it stays off rather
    // than reaching the network. `timesheetId` alone decides the one-sheet scope.
    enabled: Boolean(qc && orgId && userId && timesheetId),
    refetchInterval: ELIGIBILITY_REFRESH_MS,
  }, qc ?? IDLE_CLIENT);
}

export interface TimesheetWaitingRoleLabels {
  /** The "line manager" role word (waitingList:waitingFor.roleManager). */
  lineManager: string;
  /** The reader's language word for a coarse user_role ("Admin", "Executive", …). */
  role: (role: string) => string;
}

/**
 * Words the route for the requester. A named manager is spoken with their actual name and the line-
 * manager role; Admin/Executive alternatives are spoken with their real role names, never a flat
 * mislabel. Loading/pending is the caller's concern; this only turns COMPLETE server facts into the
 * shared sentence. `unavailable` is not a route to show (the page is not on a Submitted sheet).
 *
 * A known configured route with no active candidate is NOT reported as done and no name is invented:
 * it says, in the reader's language, that nobody active holds the deciding role right now.
 */
export function timesheetWaitingForText(
  route: TimesheetApprovalRoute | null | undefined,
  t: TFunction,
  labels: TimesheetWaitingRoleLabels,
): string | null {
  if (!route || route.routeKind === 'unavailable') return null;
  if (route.approvers.length === 0) {
    return t('common:uxs32.holdersNone', 'Nobody active holds these roles right now.');
  }

  const manager = route.approvers.find((approver) => approver.role === 'line_manager') ?? null;
  const alternativeRoles: string[] = [];
  for (const approver of route.approvers) {
    if (approver.role === 'line_manager') continue;
    const label = labels.role(approver.role);
    if (label && !alternativeRoles.includes(label)) alternativeRoles.push(label);
  }

  return waitingForText({
    names: manager ? [manager.name] : [],
    role: manager ? labels.lineManager : null,
    alternativeRoles,
  }, t);
}
