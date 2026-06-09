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

// ---------------------------------------------------------------------------
// Query key factories — org+user-scoped (mirrors useTimesheets pattern)
// ---------------------------------------------------------------------------

/** Cache key for the signed-in user's own timesheet list (same key as useTimesheets). */
const ownTimesheetsKey = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheets', orgId, userId] as const;

/** Cache key for timesheets awaiting the signed-in user's approval. */
const awaitingApprovalKey = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheets-awaiting', orgId, userId] as const;

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
    mutationFn: ({ id, notes }) => approveTimesheet(id, notes),
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
