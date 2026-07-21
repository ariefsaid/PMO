import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  listTimesheetsAwaitingApproval,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  reopenTimesheet,
  type TimesheetAwaitingApproval,
} from '@/src/lib/db/timesheetTransition';
import { repositories } from '@/src/lib/repositories';
import {
  listPushesNeedingAttention,
  listProposedEmployeeLinks,
  confirmEmployeeLink,
  type PushNeedingAttention,
  type ProposedEmployeeLink,
} from '@/src/lib/db/timesheetPush';

/**
 * P3b (FR-TSP-006, ADR-0059 §3.2): the ERP push is a CONSEQUENCE of approval, dispatched via the
 * repository seam (ADR-0017) in its OWN try/catch, AFTER `transition_timesheet` has already committed
 * — never a step inside it. Its failure NEVER fails/rolls back/retry-loops the approval: PMO is the
 * SoT for the approval decision and must not depend on ERP liveness. The durable failure state lives
 * server-side in `timesheet_erp_mirror.push_state='failed'` (surfaced to Admins) and the sweep
 * backstop re-drives it — an approval that "fails" because ERP happens to be down would be a
 * regression for every client that has flipped `timesheets` to ERPNext.
 */
async function pushAfterApprove(timesheetId: string): Promise<void> {
  try {
    await repositories.timesheet.pushApproved(timesheetId);
  } catch {
    // Swallowed deliberately — see the docstring above. Durable state is written server-side.
  }
}

// ---------------------------------------------------------------------------
// Query key factories — org+user-scoped (mirrors useTimesheets pattern)
// ---------------------------------------------------------------------------

/** Cache key for the signed-in user's own timesheet list (same key as useTimesheets). */
const ownTimesheetsKey = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheets', orgId, userId] as const;

/** Cache key for timesheets awaiting the signed-in user's approval. */
const awaitingApprovalKey = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheets-awaiting', orgId, userId] as const;

/** Cache key for the P3b Approvals "needs attention" ERP-push surface (FR-TSP-085). */
const pushesAttentionKey = (orgId: string | undefined) => ['timesheet-pushes-attention', orgId] as const;

/** Cache key for the P3b proposed Employee→PMO-user link queue (OQ-TSP-10(C)). */
const proposedLinksKey = (orgId: string | undefined) => ['erp-employee-links-proposed', orgId] as const;

// ---------------------------------------------------------------------------
// Read hook — timesheets awaiting approval (C1)
// ---------------------------------------------------------------------------

/**
 * Returns Submitted timesheets the signed-in user may approve (manager queue).
 * Cache key: ['timesheets-awaiting', orgId, userId] (AC-911 hook, FR-TS-011).
 * Disabled when orgId or userId are absent.
 */
export function useTimesheetsAwaitingApproval() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  return useQuery<TimesheetAwaitingApproval[]>({
    queryKey: awaitingApprovalKey(orgId, userId),
    queryFn: () => listTimesheetsAwaitingApproval(userId!),
    enabled: Boolean(orgId && userId),
  });
}

// ---------------------------------------------------------------------------
// Mutation hook — submit / approve / reject (C2)
// Invalidates both the own-sheets key and the awaiting-approval key on success.
// ---------------------------------------------------------------------------

/**
 * All timesheet transition mutations for the signed-in user.
 * Each mutation invalidates ['timesheets', orgId, userId] and
 * ['timesheets-awaiting', orgId, userId] on success (AC-911 hook).
 */
export function useTimesheetMutations() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  const invalidateBoth = () => {
    queryClient.invalidateQueries({ queryKey: ownTimesheetsKey(orgId, userId) });
    queryClient.invalidateQueries({ queryKey: awaitingApprovalKey(orgId, userId) });
  };

  const submit = useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => submitTimesheet(id),
    onSuccess: invalidateBoth,
  });

  const approve = useMutation<void, Error, { id: string; notes?: string }>({
    mutationFn: async ({ id, notes }) => {
      await approveTimesheet(id, notes);
      await pushAfterApprove(id);
    },
    onSuccess: invalidateBoth,
  });

  const reject = useMutation<void, Error, { id: string; notes?: string }>({
    mutationFn: ({ id, notes }) => rejectTimesheet(id, notes),
    onSuccess: invalidateBoth,
  });

  const reopen = useMutation<void, Error, { id: string }>({
    mutationFn: ({ id }) => reopenTimesheet(id),
    onSuccess: invalidateBoth,
  });

  return { submit, approve, reject, reopen };
}

// ---------------------------------------------------------------------------
// P3b — the Approvals operator surfaces (FR-TSP-085, OQ-TSP-10(C))
// ---------------------------------------------------------------------------

/**
 * The Approvals "needs attention" ERP-push queue (P3b, FR-TSP-085): every `failed`/`held` push
 * visible to the signed-in user. `timesheet_erp_mirror_select` RLS (migration 0136) is the ONLY
 * scoping authority — this hook adds none of its own, matching the RBAC-transparent posture every
 * other timesheet read hook in this file follows.
 */
export function usePushesNeedingAttention() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const queryClient = useQueryClient();

  const query = useQuery<PushNeedingAttention[]>({
    queryKey: pushesAttentionKey(orgId),
    queryFn: () => listPushesNeedingAttention(),
    enabled: Boolean(orgId),
  });

  // The Retry affordance (`can('push_timesheet', 'timesheet', ctx)` gates it at the call-site) — the
  // SAME repository seam the approve path uses (ADR-0017), never a bespoke second push mechanism.
  const retry = useMutation<void, Error, { timesheetId: string }>({
    mutationFn: ({ timesheetId }) => repositories.timesheet.pushApproved(timesheetId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: pushesAttentionKey(orgId) }),
  });

  return { ...query, retry };
}

/**
 * The Employee-adopt-link Admin queue + its confirm mutation (P3b, OQ-TSP-10(C) — the owner ruling:
 * adopt-then-CONFIRM, never auto-confirmed). `can('confirm_employee_link', 'employeeLink', ctx)` is
 * the UX gate at the call-site (ADR-0016); `confirm_erp_employee_link` is the enforcement authority.
 */
export function useEmployeeLinkConfirm() {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const links = useQuery<ProposedEmployeeLink[]>({
    queryKey: proposedLinksKey(orgId),
    queryFn: () => listProposedEmployeeLinks(),
    enabled: Boolean(orgId),
  });

  const confirm = useMutation<void, Error, { erpEmployeeId: string; profileId: string }>({
    mutationFn: ({ erpEmployeeId, profileId }) => confirmEmployeeLink(erpEmployeeId, profileId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: proposedLinksKey(orgId) });
      // A confirm may unblock an already-failed push (self-heal, FR-TSP-092) — refresh that queue too.
      queryClient.invalidateQueries({ queryKey: pushesAttentionKey(orgId) });
    },
  });

  return { links, confirm };
}
