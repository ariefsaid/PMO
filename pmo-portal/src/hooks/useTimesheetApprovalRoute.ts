import { useContext } from 'react';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useAuth } from '@/src/auth/useAuth';
import { waitingForText } from '@/src/lib/approvals/waitingFor';
import type { TimesheetApprovalRoute, TimesheetApprovalRouteApprover } from '@/src/lib/db/timesheetApprovalRoute';
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
 * The route token the server uses for the RAW assigned line manager. It is NOT a `profiles.user_role`
 * value — those are the coarse words ("Admin", "Executive", …) — it is display metadata describing
 * which bank of the route an approver came from. Authorization stays with the RPC + RLS (ADR-0016);
 * this classification never grants, never feeds `can()`, and no permission is invented from it.
 */
const LINE_MANAGER_ROUTE_TOKEN = 'line_manager';

/** Display classification only: is this approver the route's assigned manager? (not an authorization check) */
function isAssignedManager(approver: TimesheetApprovalRouteApprover): boolean {
  return approver.role === LINE_MANAGER_ROUTE_TOKEN;
}

/**
 * Words the route for the requester. A named manager is spoken with their actual name and the line-
 * manager role; Admin/Executive alternatives are spoken with their real role names, never a flat
 * mislabel. When NO manager is assigned, the signed root ruling requires the actual people the DB
 * returned to be named — so each Admin/Executive is spoken as "<name>, <role>" (a blank server name
 * falls back to the role word alone; no name is invented and no profile read is added here).
 *
 * Loading/pending is the caller's concern; this only turns COMPLETE server facts into the shared
 * sentence. `unavailable` is not a route to show (the page is not on a Submitted sheet). A known
 * configured route with no active candidate is NOT reported as done: it says, in the reader's
 * language, that nobody active holds the deciding role right now.
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

  const manager = route.approvers.find(isAssignedManager) ?? null;
  const others = route.approvers.filter((approver) => !isAssignedManager(approver));

  if (manager) {
    // Named manager + the real role words of the OTHER eligible people. The manager is never repeated
    // as an Admin alternative; the server already deduped the same id.
    const alternativeRoles: string[] = [];
    for (const approver of others) {
      const label = labels.role(approver.role);
      if (label && !alternativeRoles.includes(label)) alternativeRoles.push(label);
    }
    const name = manager.name.trim();
    return waitingForText({
      names: name ? [name] : [],
      role: labels.lineManager,
      alternativeRoles,
    }, t);
  }

  // Null manager: name the actual returned Admin/Executive people with their current coarse role.
  // The existing formatter joins these with its localized "or"; a blank server `full_name` is a valid
  // value, so it falls back to the role word instead of fabricating a name or erroring the route.
  const people: string[] = [];
  for (const approver of others) {
    const role = labels.role(approver.role);
    const name = approver.name.trim();
    const who = name ? (role ? `${name}, ${role}` : name) : role;
    if (who && !people.includes(who)) people.push(who);
  }
  if (people.length === 0) {
    return t('common:uxs32.holdersNone', 'Nobody active holds these roles right now.');
  }
  return waitingForText({ names: people }, t);
}
