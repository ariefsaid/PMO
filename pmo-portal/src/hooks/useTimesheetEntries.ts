import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  saveTimesheetWeek,
  deleteTimesheetEntry,
  TimesheetWriteError,
} from '@/src/lib/db/timesheets';
import type { EntryDiff } from '@/src/lib/timesheet-edit';

/** Cache key for the signed-in user's own timesheet list (same key as useTimesheets). */
const ownTimesheetsKey = (orgId: string | undefined, userId: string | undefined) =>
  ['timesheets', orgId, userId] as const;

/** Input for the Save action: create-if-null, then commit the diff against the (created) sheet. */
export interface SaveWeekInput {
  currentTimesheetId: string | null; // null ⇒ create a Draft first
  weekStartDate: string; // Monday ISO
  diff: EntryDiff; // from diffEntries()
}

/**
 * Entry-write mutations for the signed-in engineer's own week (FR-TSE-011/012/016/017).
 *
 * `saveWeek` commits the whole week in ONE atomic transaction via the save_timesheet_week RPC
 * (harden #1): create-the-Draft-if-absent + upsert the changed cells + delete the zeroed cells are
 * all-or-nothing, so a mid-op failure can never leave a partial commit. It returns the RPC's
 * resolved sheet id (for chained submit) and invalidates ['timesheets', orgId, userId] on success.
 * `deleteRow` deletes a persisted row's entries then invalidates. No org_id is ever sent — RLS/the
 * RPC's re-asserted guards are the authority. Errors surface as TimesheetWriteError preserving
 * error.code so the page can classify the toast; on failure the query is NOT invalidated (edits are
 * kept for retry).
 */
export function useTimesheetEntryMutations(): {
  saveWeek: UseMutationResult<string, TimesheetWriteError, SaveWeekInput>;
  deleteRow: UseMutationResult<void, TimesheetWriteError, { entryIds: string[] }>;
} {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  const invalidateOwn = () => {
    queryClient.invalidateQueries({ queryKey: ownTimesheetsKey(orgId, userId) });
  };

  const saveWeek = useMutation<string, TimesheetWriteError, SaveWeekInput>({
    mutationFn: async ({ currentTimesheetId, weekStartDate, diff }) =>
      // One atomic RPC: create-draft-if-absent + upsert changed cells + delete zeroed cells, all
      // in a single transaction (harden #1). The RPC re-targets the upserts at the resolved sheet
      // id server-side and returns that id so chained callers (auto-save-then-submit, AC-W3-O1)
      // can submit immediately without waiting for the invalidation refetch to settle.
      saveTimesheetWeek(currentTimesheetId, weekStartDate, diff.upserts, diff.deletes),
    onSuccess: invalidateOwn,
  });

  const deleteRow = useMutation<void, TimesheetWriteError, { entryIds: string[] }>({
    mutationFn: async ({ entryIds }) => {
      for (const id of entryIds) {
        await deleteTimesheetEntry(id);
      }
    },
    onSuccess: invalidateOwn,
  });

  return { saveWeek, deleteRow };
}
