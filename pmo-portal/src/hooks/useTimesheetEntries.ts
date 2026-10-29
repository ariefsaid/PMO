import { useRef, useState } from 'react';
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  type TimesheetWriteError,
  type TimesheetEntryWithProject,
} from '@/src/lib/db/timesheets';
import { repositories } from '@/src/lib/repositories';
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
 * `deleteRow` commits its entries in one transaction and refreshes after either outcome. No org_id is ever sent — RLS/the
 * RPC's re-asserted guards are the authority. Errors surface as TimesheetWriteError preserving
 * error.code so the page can classify the toast; save failures retain edits for retry.
 */
export function useTimesheetEntryMutations(): {
  saveWeek: UseMutationResult<string, TimesheetWriteError, SaveWeekInput>;
  deleteRow: UseMutationResult<void, TimesheetWriteError, { timesheetId: string; weekStartDate: string; entryIds: string[] }>;
  isReconciling: boolean;
  retryDeleteRefresh: () => Promise<void>;
  reconciledDelete: { timesheetId: string; entries: TimesheetEntryWithProject[] } | null;
} {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconciledDelete, setReconciledDelete] = useState<{ timesheetId: string; entries: TimesheetEntryWithProject[] } | null>(null);
  const pendingSheet = useRef<{ id: string; week: string; entryIds: string[]; failed: boolean } | null>(null);
  const refreshInFlight = useRef(false);

  const retryDeleteRefresh = async () => {
    const origin = pendingSheet.current;
    if (!origin || !userId || refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      await queryClient.cancelQueries({ queryKey: ownTimesheetsKey(orgId, userId) });
      const sheets = await repositories.timesheet.list(userId);
      const sheet = sheets.find((item) => item.id === origin.id && item.week_start_date === origin.week);
      if (!sheet) throw new Error('Timesheet unavailable');
      if (origin.failed) {
        setReconciledDelete({ timesheetId: origin.id, entries: sheet.entries.filter((entry) => origin.entryIds.includes(entry.id)) });
      }
      queryClient.setQueryData(ownTimesheetsKey(orgId, userId), sheets);
      pendingSheet.current = null;
      setIsReconciling(false);
    } catch {
      // Retain the guard until a fresh server read succeeds.
    } finally {
      refreshInFlight.current = false;
    }
  };

  const invalidateOwn = () => {
    queryClient.invalidateQueries({ queryKey: ownTimesheetsKey(orgId, userId) });
  };

  const saveWeek = useMutation<string, TimesheetWriteError, SaveWeekInput>({
    mutationFn: async ({ currentTimesheetId, weekStartDate, diff }) =>
      // One atomic RPC: create-draft-if-absent + upsert changed cells + delete zeroed cells, all
      // in a single transaction (harden #1). The RPC re-targets the upserts at the resolved sheet
      // id server-side and returns that id so chained callers (auto-save-then-submit, AC-W3-O1)
      // can submit immediately without waiting for the invalidation refetch to settle.
      repositories.timesheet.saveWeek(currentTimesheetId, weekStartDate, diff.upserts, diff.deletes),
    onSuccess: invalidateOwn,
  });

  const deleteRow = useMutation<void, TimesheetWriteError, { timesheetId: string; weekStartDate: string; entryIds: string[] }>({
    mutationFn: async ({ timesheetId, weekStartDate, entryIds }) => {
      pendingSheet.current = { id: timesheetId, week: weekStartDate, entryIds, failed: false };
      setReconciledDelete(null);
      setIsReconciling(true);
      await repositories.timesheet.saveWeek(timesheetId, weekStartDate, [], entryIds);
    },
    onSettled: async (_data, error) => {
      if (pendingSheet.current) pendingSheet.current.failed = Boolean(error);
      await queryClient.invalidateQueries({ queryKey: ownTimesheetsKey(orgId, userId), refetchType: 'none' });
      await retryDeleteRefresh();
    },
  });

  return { saveWeek, deleteRow, isReconciling, retryDeleteRefresh, reconciledDelete };
}
