import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  createDraftTimesheet,
  upsertTimesheetEntries,
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
 * `saveWeek` orchestrates, in one user action: create-the-Draft-if-absent → upsert the changed
 * cells (re-targeted at the resolved sheet id) → delete the zeroed cells → invalidate
 * ['timesheets', orgId, userId] on success (refetch reflects server state). `deleteRow` deletes a
 * persisted row's entries then invalidates. No org_id is ever sent — RLS is the authority. Errors
 * surface as TimesheetWriteError preserving error.code so the page can classify the toast; on
 * failure the query is NOT invalidated (edits are kept for retry).
 */
export function useTimesheetEntryMutations(): {
  saveWeek: UseMutationResult<void, TimesheetWriteError, SaveWeekInput>;
  deleteRow: UseMutationResult<void, TimesheetWriteError, { entryIds: string[] }>;
} {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;

  const invalidateOwn = () => {
    queryClient.invalidateQueries({ queryKey: ownTimesheetsKey(orgId, userId) });
  };

  const saveWeek = useMutation<void, TimesheetWriteError, SaveWeekInput>({
    mutationFn: async ({ currentTimesheetId, weekStartDate, diff }) => {
      // 1. Create the Draft sheet if this week has none; reuse its id as the upsert target.
      let sheetId = currentTimesheetId;
      if (sheetId === null) {
        const sheet = await createDraftTimesheet(weekStartDate, userId as string);
        sheetId = sheet.id;
      }
      // 2. Upsert the changed/new cells, re-targeted at the resolved sheet id (the diff may carry a
      //    placeholder timesheet_id when the sheet did not yet exist).
      const upserts = diff.upserts.map(u => ({ ...u, timesheet_id: sheetId as string }));
      await upsertTimesheetEntries(upserts);
      // 3. Delete the zeroed cells' persisted entries.
      for (const id of diff.deletes) {
        await deleteTimesheetEntry(id);
      }
    },
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
