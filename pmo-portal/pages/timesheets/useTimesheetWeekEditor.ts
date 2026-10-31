import React, { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns/format';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useToast, type TimesheetGridRow } from '@/src/components/ui';
import type { TimesheetWithEntries, TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { useTimesheetEntryMutations } from '@/src/hooks/useTimesheetEntries';
import type { useTimesheetMutations } from '@/src/hooks/useTimesheetApproval';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { type EditRow, computeTotals, diffEntries, gridIsValid, parseHourCell, saveToastForChangeCount } from '@/src/lib/timesheet-edit';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatFullDate, formatMonthDay } from '@/src/lib/format';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import { TimesheetStatus } from '../../types';

type Props = {
  currentTimesheet: TimesheetWithEntries | null;
  currentWeekEntries: TimesheetEntryWithProject[];
  gridRows: TimesheetGridRow[];
  weekDates: Date[];
  weekStartDate: Date;
  weekStartString: string;
  allProjects: ProjectWithRefs[] | undefined;
  signedInUserId: string | undefined;
  currentDate: Date;
  setCurrentDate: React.Dispatch<React.SetStateAction<Date>>;
  entryMutations: ReturnType<typeof useTimesheetEntryMutations>;
  submit: ReturnType<typeof useTimesheetMutations>['submit'];
};

export function useTimesheetWeekEditor({ currentTimesheet, currentWeekEntries, gridRows, weekDates, weekStartDate, weekStartString, allProjects, signedInUserId, currentDate, setCurrentDate, entryMutations, submit }: Props) {
  const { t } = useTranslation(['common', 'timesheets']);
  const { toast } = useToast();
  const { saveWeek, deleteRow, isReconciling, reconciledDelete } = entryMutations;
  const submittingRef = useRef(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const weekDateStrings = useMemo(() => weekDates.map((date) => format(date, 'yyyy-MM-dd')), [weekDates]);
  // AC-IFW-TASKS-02: consume ?project=<id> from the URL (set by MyTasks "Log time" link).
  // Declared before the seedRows/seedKey block so the reseed can re-include the prefilled
  // project when the seedKey transitions (e.g. sheets resolves AFTER projects — the common case
  // for an active engineer with a saved draft). `prefillApplied` tracks the last applied id
  // so we do not re-add the project on subsequent non-seedKey-changing renders.
  const [searchParams] = useSearchParams();
  const prefillProjectId = searchParams.get('project');
  const prefillApplied = React.useRef<string | null>(null);

  // Seed the in-memory edit state from the last-fetched server grid. Re-seed ONLY when the
  // week, sheet identity, or sheet editability changes — NOT when entry content changes.
  // Keying on entry content would let every post-mutation invalidation refetch (the async
  // onSuccess after Save/Delete) re-seed and clobber unsaved local edits (e.g. delete a row,
  // re-add a project + type hours, then have the delete's refetch wipe the re-added row).
  // Week navigation, the none→real draft-id transition on first Save, and Draft→Submitted all
  // change this key and still correctly re-seed; a same-week post-mutation refetch does not.
  const seedRows = useMemo<EditRow[]>(
    () =>
      gridRows.map((r) => {
        const note =
          currentWeekEntries.find((e) => e.project_id === r.id && (e.notes ?? '') !== '')?.notes ??
          '';
        return {
          project_id: r.id,
          project: r.project,
          code: r.code,
          hours: r.hours.map((h) => (h === 0 ? '' : String(h))),
          note,
        };
      }),
    [gridRows, currentWeekEntries]
  );
  const seedKey = useMemo(
    () =>
      `${currentTimesheet?.id ?? 'none'}|${currentTimesheet?.status ?? 'none'}|${weekStartString}`,
    [currentTimesheet?.id, currentTimesheet?.status, weekStartString]
  );
  const [editRows, setEditRows] = useState<EditRow[]>(seedRows);
  const lastSeedKey = useRef<string | null>(null);
  if (lastSeedKey.current !== seedKey) {
    lastSeedKey.current = seedKey;
    // AC-IFW-TASKS-02 reseed-survival: when the seedKey transitions (e.g. the saved draft
    // arrives from the server after the prefill effect already ran), the prefilled project
    // would be dropped from editRows because seedRows only reflects the server state.
    // Re-include the prefilled project in the reseed target if:
    //   (a) a prefill was already applied (prefillApplied.current === prefillProjectId),
    //   (b) the project is a valid Ongoing Project in allProjects, AND
    //   (c) the project is not already present in seedRows (not yet saved to the server).
    let nextRows = seedRows;
    if (
      prefillProjectId &&
      prefillApplied.current === prefillProjectId &&
      allProjects &&
      !seedRows.some((r) => r.project_id === prefillProjectId)
    ) {
      const proj = allProjects.find(
        (p) => p.id === prefillProjectId && p.status === 'Ongoing Project',
      );
      if (proj) {
        nextRows = [
          ...seedRows,
          {
            project_id: proj.id,
            project: projectDisplayName(proj),
            code: proj.code,
            hours: ['', '', '', '', '', '', ''],
            note: '',
          },
        ];
      }
    }
    if (editRows !== nextRows) setEditRows(nextRows);
  }

  // Server entries shaped for diffEntries (id/project/date/hours/notes per cell). `notes` lets the
  // diff detect a note-only edit (hours unchanged) and re-upsert it instead of silently dropping it.
  const serverEntriesForDiff = useMemo(
    () =>
      currentWeekEntries.map((e) => ({
        id: e.id,
        project_id: e.project_id,
        entry_date: e.entry_date,
        hours: e.hours,
        notes: e.notes ?? null,
      })),
    [currentWeekEntries]
  );

  // Picker options: Active org projects (Ongoing Project) minus those already a row.
  const presentProjectIds = useMemo(
    () => new Set(editRows.map((r) => r.project_id)),
    [editRows]
  );
  const pickerOptions = useMemo(
    () =>
      (allProjects ?? [])
        .filter((p) => p.status === 'Ongoing Project' && !presentProjectIds.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allProjects, presentProjectIds]
  );

  // Live invalid-cell set (color-not-only: drives border + inline alert + aria-invalid).
  const invalidCells = useMemo(() => {
    const set = new Set<string>();
    editRows.forEach((r) => {
      r.hours.forEach((cell, i) => {
        if (!parseHourCell(cell).valid) set.add(`${r.project_id}:${i}`);
      });
    });
    return set;
  }, [editRows]);
  const editValid = useMemo(() => gridIsValid(editRows), [editRows]);
  // The week's totals from edited (string) state — invalid cells gate to 0 — via the same pure
  // selector the grid footer uses, so the header weekly total and the footer grand total agree
  // (no inline raw double-reduce that would count an invalid "25" as 25). FR-TSE-013.
  const editTotals = useMemo(() => computeTotals(editRows), [editRows]);

  // Edited rows shaped for TimesheetGrid (numeric hours for display) + the note map.
  const editGridRows = useMemo<TimesheetGridRow[]>(
    () =>
      editRows.map((r) => ({
        id: r.project_id,
        project: r.project,
        projectLegalName: (allProjects ?? []).find((p) => p.id === r.project_id)?.name,
        code: r.code,
        hours: r.hours.map((c) => parseHourCell(c).value || 0),
      })),
    [editRows, allProjects]
  );
  const editNotes = useMemo(
    () => Object.fromEntries(editRows.map((r) => [r.project_id, r.note])),
    [editRows]
  );
  const editRawHours = useMemo(
    () => Object.fromEntries(editRows.map((r) => [r.project_id, r.hours])),
    [editRows]
  );

  const setCell = (rowId: string, dayIndex: number, raw: string) =>
    setEditRows((rows) =>
      rows.map((r) =>
        r.project_id === rowId
          ? { ...r, hours: r.hours.map((c, i) => (i === dayIndex ? raw : c)) }
          : r
      )
    );
  const setNote = (rowId: string, note: string) =>
    setEditRows((rows) => rows.map((r) => (r.project_id === rowId ? { ...r, note } : r)));
  const addProject = (projectId: string) => {
    const proj = (allProjects ?? []).find((p) => p.id === projectId);
    if (!proj || presentProjectIds.has(projectId)) return;
    setEditRows((rows) => [
      ...rows,
      {
        project_id: proj.id,
        project: projectDisplayName(proj),
        code: proj.code,
        hours: ['', '', '', '', '', '', ''],
        note: '',
      },
    ]);
  };

  // AC-IFW-TASKS-02 prefill effect: run once per param value after allProjects loads.
  // Guard: only Ongoing Project rows are valid timesheet projects (matches picker filter);
  // unknown / already-present / non-active ids are silently ignored by addProject.
  // The reseed-survival fix above handles the case where this effect fires BEFORE the
  // server draft arrives — the reseed block re-appends the prefilled row when seedKey changes.
  React.useEffect(() => {
    if (
      !prefillProjectId ||
      !allProjects ||
      allProjects.length === 0 ||
      prefillApplied.current === prefillProjectId
    ) {
      return;
    }
    prefillApplied.current = prefillProjectId;
    addProject(prefillProjectId);
  // addProject is stable (no deps that change); allProjects loading is the trigger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillProjectId, allProjects]);

  // Delete-row confirm (mandatory destructive ConfirmDialog — FR-TSE-008/009).
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const rowToDelete = editRows.find((r) => r.project_id === confirmDeleteRowId) ?? null;
  const pendingDeletedRow = useRef<{ sheetId: string; row: EditRow } | null>(null);
  React.useEffect(() => {
    const pending = pendingDeletedRow.current;
    if (!pending || !reconciledDelete || reconciledDelete.timesheetId !== pending.sheetId) return;
    pendingDeletedRow.current = null;
    if (reconciledDelete.entries.length === 0) return;
    setEditRows((rows) => rows.some((row) => row.project_id === pending.row.project_id)
      ? rows
      : [...rows, pending.row]);
  }, [reconciledDelete]);
  const confirmDeleteRow = () => {
    if (!confirmDeleteRowId || isReconciling || deleteRow.isPending) return;
    const rowIdToDelete = confirmDeleteRowId;
    const persistedEntryIds = currentWeekEntries
      .filter((e) => e.project_id === rowIdToDelete)
      .map((e) => e.id);
    setConfirmDeleteRowId(null);

    if (persistedEntryIds.length === 0) {
      // Unsaved row — remove from edit state only (no server write needed).
      setEditRows((rows) => rows.filter((r) => r.project_id !== rowIdToDelete));
      return;
    }

    // Capture the row before removal so we can restore it on failure.
    const removedRow = editRows.find((r) => r.project_id === rowIdToDelete);
    if (removedRow && currentTimesheet) pendingDeletedRow.current = { sheetId: currentTimesheet.id, row: removedRow };

    // Remove optimistically from edit state; restore on server error (resilience F5).
    setEditRows((rows) => rows.filter((r) => r.project_id !== rowIdToDelete));
    deleteRow.mutate(
      { timesheetId: currentTimesheet!.id, weekStartDate: weekStartString, entryIds: persistedEntryIds },
      {
        onSuccess: () => {
          pendingDeletedRow.current = null;
          toast(t('timesheets.toast.rowDeleted.headline', 'Row deleted'),
            t('timesheets.toast.rowDeleted.detail', 'Removed this project from the week'), 'success');
        },
        onError: (err) => {
          toast(t('timesheets.toast.deleteFailed', 'Delete failed'), err.message, 'warning');
        },
      }
    );
  };

  // Save (explicit commit — FR-TSE-011/012/016). Builds the diff, calls saveWeek.
  const commitSave = () => {
    const diff = diffEntries(
      editRows,
      weekDateStrings,
      serverEntriesForDiff,
      currentTimesheet?.id ?? ''
    );
    const changeCount = diff.upserts.length + diff.deletes.length;
    // Suppress the no-op: 0 changes never toasts a fake "0 changes saved" success — it reports an
    // honest info "Nothing to save", and we skip the write entirely (AC-IXD-TS-003, OD-UX-1).
    if (changeCount === 0) {
      toast(...saveToastForChangeCount(0));
      return;
    }
    saveWeek.mutate(
      { currentTimesheetId: currentTimesheet?.id ?? null, weekStartDate: weekStartString, diff },
      {
        // Quiet success toast; the user stays on the editable grid (no view/navigation change).
        onSuccess: () => toast(...saveToastForChangeCount(changeCount)),
        onError: (err: { message: string }) =>
          toast(t('timesheets.toast.saveFailed', 'Save failed'), err.message, 'warning'),
      }
    );
  };

  // UX-063: unsaved = the edit buffer differs from the server week (same diff Save commits).
  const dirty = useMemo(() => {
    const d = diffEntries(editRows, weekDateStrings, serverEntriesForDiff, currentTimesheet?.id ?? '');
    return d.upserts.length + d.deletes.length > 0;
  }, [editRows, weekDateStrings, serverEntriesForDiff, currentTimesheet?.id]);

  const weeklyTotal = useMemo(
    () => currentWeekEntries.reduce((sum, e) => sum + e.hours, 0),
    [currentWeekEntries]
  );

  const [pendingWeekDelta, setPendingWeekDelta] = useState<number | null>(null);
  const moveWeek = (delta: number) => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta * 7);
    setCurrentDate(next);
  };
  const stepWeek = (delta: number) => {
    if (deleteRow.isPending || isReconciling || saveWeek.isPending || submit.isPending) return;
    if (dirty || JSON.stringify(editRows) !== JSON.stringify(seedRows)) setPendingWeekDelta(delta);
    else moveWeek(delta);
  };

  const weekRangeLabel = `${formatMonthDay(weekStartDate)} – ${formatFullDate(weekDates[6])}`;

  // Submit affordance (FR-TS-004): only the owner of a Draft sheet for this week.
  const isOwner = currentTimesheet?.user_id === signedInUserId;
  const actions = currentTimesheet
    ? timesheetActions(currentTimesheet.status as TimesheetStatus, Boolean(isOwner), false)
    : { submit: false, approve: false, reject: false };

  // OD-W3-1 (AC-W3-O1): Submit is enabled when EITHER:
  //   (a) a Draft with at least one PERSISTED entry exists (legacy: clean/already-saved), OR
  //   (b) the edit buffer has valid hours (dirty week — Submit auto-saves first then submits).
  // This eliminates the 3-step Save→Submit→Confirm for a fresh/dirty week.
  // The buffer having hours is detected via editValid && editRows.some(r => r.hours.some(h => h !== ''))
  // (equivalent: editTotals.weekly > 0 since invalid cells count as 0 and empty cells count as 0).
  const editBufferHasHours = editValid && editTotals.weekly > 0;
  // canSubmit covers BOTH the already-saved path and the auto-save-first path — but is gated on
  // `editValid` (review minor): if the visible buffer is dirty-but-INVALID (e.g. a 25h cell), do
  // NOT offer Submit against the stale persisted data and silently discard the edits; force the
  // user to fix/clear the invalid cell first (the grid shows the validation, Save stays disabled).
  const canSubmit =
    editValid && ((actions.submit && currentWeekEntries.length > 0) || editBufferHasHours);

  // OD-W3-1 (AC-W3-O1): commit the week for approval.
  //
  // If the edit buffer has unsaved valid changes (dirty), run saveWeek.mutateAsync first to
  // persist them (and create the Draft if none exists). saveWeek returns the resolved sheet id
  // so we can submit immediately — no poll/setTimeout required.
  //
  // If the buffer is clean (no diff vs. server), skip the save and submit the already-persisted
  // sheet directly (no-op-save suppression preserved).
  //
  // The confirm dialog still gates the action (consequential write), the RPC contract
  // (submit_timesheet { id }) is preserved, and the seedKey re-seed-race guard is unchanged.
  const commitSubmit = async () => {
    // Re-entrancy guard (review fix): block a synchronous double-click on the confirm before the
    // first save/submit's `isPending` becomes observable. Cleared in EVERY terminal path below
    // (save-error, no-sheet, submit success, submit error) — NOT in a finally, because the trailing
    // `submit.mutate` is fire-and-forget, so the ref must stay held until that mutation settles.
    if (submittingRef.current) return;
    submittingRef.current = true;
    let sheetId = currentTimesheet?.id ?? null;

    // Compute the diff to detect dirty state (mirrors commitSave logic).
    const diff = diffEntries(
      editRows,
      weekDateStrings,
      serverEntriesForDiff,
      currentTimesheet?.id ?? '',
    );
    const changeCount = diff.upserts.length + diff.deletes.length;

    if (changeCount > 0 && editValid) {
      // Dirty + valid: auto-save first, get the resolved sheet id.
      try {
        sheetId = await saveWeek.mutateAsync({
          currentTimesheetId: currentTimesheet?.id ?? null,
          weekStartDate: weekStartString,
          diff,
        });
      } catch (err: unknown) {
        // Auto-save failed — don't attempt the submit; surface the error.
        submittingRef.current = false;
        setConfirmSubmit(false);
        toast(
          t('timesheets.toast.saveFailed', 'Save failed'),
          err instanceof Error ? err.message : undefined,
          'warning',
        );
        return;
      }
    }

    if (!sheetId) {
      // Shouldn't happen if canSubmit is guarded correctly, but defend gracefully.
      submittingRef.current = false;
      setConfirmSubmit(false);
      return;
    }

    submit.mutate(
      { id: sheetId },
      {
        onSuccess: () => {
          submittingRef.current = false;
          setConfirmSubmit(false);
          toast(
            t('timesheets.toast.submitted.headline', 'Timesheet submitted'),
            t('timesheets.toast.submitted.detail', 'Sent to your line manager for approval'),
            'success',
          );
        },
        onError: (err: unknown) => {
          submittingRef.current = false;
          setConfirmSubmit(false);
          const { headline, detail } = classifyMutationError(err);
          toast(headline, detail, 'warning');
        },
      },
    );
  };

  return {
    view: { pickerOptions, invalidCells, editValid, editTotals, editGridRows, editNotes,
      editRawHours, rowToDelete, dirty, weeklyTotal, pendingWeekDelta, weekRangeLabel,
      isOwner, editBufferHasHours, canSubmit, confirmSubmit },
    actions: { setCell, setNote, addProject, requestDelete: setConfirmDeleteRowId,
      cancelDelete: () => setConfirmDeleteRowId(null), confirmDeleteRow, commitSave,
      stepWeek, cancelWeekChange: () => setPendingWeekDelta(null),
      confirmWeekChange: () => { if (pendingWeekDelta !== null) moveWeek(pendingWeekDelta); setPendingWeekDelta(null); },
      requestSubmit: () => setConfirmSubmit(true), cancelSubmit: () => setConfirmSubmit(false), commitSubmit },
  };
}
