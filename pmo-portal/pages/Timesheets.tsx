import React, { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrBanner,
  Icon,
  ListState,
  StatusPill,
  TimesheetGrid,
  Toolbar,
  ViewToggle,
  AccessDenied,
  useToast,
  type StatusVariant,
  type TimesheetDay,
  type TimesheetGridRow,
} from '@/src/components/ui';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '@/src/auth/usePermission';
import { TimesheetStatus } from '../types';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import {
  useTimesheetMutations,
  useTimesheetsAwaitingApproval,
} from '@/src/hooks/useTimesheetApproval';
import { useTimesheetEntryMutations } from '@/src/hooks/useTimesheetEntries';
import { useTimesheetsView } from '@/src/hooks/useTimesheetsView';
import { useProjects } from '@/src/hooks/useProjects';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
import {
  type EditRow,
  computeTotals,
  diffEntries,
  gridIsValid,
  parseHourCell,
  saveToastForChangeCount,
} from '@/src/lib/timesheet-edit';
import { useAuth } from '@/src/auth/useAuth';
import { ApprovalsQueue } from './timesheets/ApprovalsQueue';

// ── Date helpers (preserved verbatim — week logic unchanged) ─────────────────
const getWeekStartDate = (date: Date): Date => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
};

const formatDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/** Map timesheet status → tinted StatusPill variant. */
const PILL: Record<string, StatusVariant> = {
  Draft: 'neutral',
  Submitted: 'open',
  Approved: 'won',
  Rejected: 'lost',
};

const TimesheetsPage: React.FC = () => {
  const { data: sheets, isPending, isError, refetch } = useTimesheets();
  const { submit } = useTimesheetMutations();
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const may = usePermission();
  // A-6 / OD-W2 (rbac-visibility §I): Finance has NO Workforce surface (Timesheets ○,
  // Approvals ○) and `timesheet.create` excludes Finance. When Finance reaches /timesheets by
  // URL they get a clean access-denied surface — no entry/save affordance. This is the FE
  // clarity gate ONLY this wave (ADR-0016: the FE may be stricter than RLS); the server-side
  // RLS tightening (Finance cannot insert timesheet_entries) is a SEPARATE pgTAP-owned security
  // follow-up, not built here.
  const canEnterTimesheet = may('create', 'timesheet');
  const signedInUserId = currentUser?.id;
  const [view, setView] = useTimesheetsView();
  // T1: the Submit button stages this confirm; nothing submits on a single click.
  const [confirmSubmit, setConfirmSubmit] = useState(false);

  // Pending-approval count for the queue toggle badge (shared cache; cheap).
  const { data: awaiting } = useTimesheetsAwaitingApproval();
  const pendingCount = awaiting?.length ?? 0;

  const [currentDate, setCurrentDate] = useState(new Date());

  const weekStartDate = getWeekStartDate(new Date(currentDate));
  const weekStartString = formatDate(weekStartDate);

  const weekDates = useMemo(
    () =>
      Array.from({ length: 7 }).map((_, i) => {
        const date = new Date(weekStartDate);
        date.setDate(date.getDate() + i);
        return date;
      }),
    [weekStartDate]
  );

  const currentTimesheet = useMemo(
    () => (sheets ?? []).find((t) => t.week_start_date === weekStartString) ?? null,
    [sheets, weekStartString]
  );

  const currentWeekEntries = useMemo(
    () => currentTimesheet?.entries ?? [],
    [currentTimesheet]
  );

  // Group entries into grid rows (one row per project), each with 7 daily hours.
  // Entries for the same project on the same day are summed regardless of note text.
  const gridRows = useMemo<TimesheetGridRow[]>(() => {
    const map = new Map<string, TimesheetGridRow>();
    const dateStrings = weekDates.map(formatDate);
    for (const e of currentWeekEntries) {
      const key = `${e.project_id}`;
      let row = map.get(key);
      if (!row) {
        row = {
          id: key,
          project: e.project?.name ?? 'Unknown Project',
          code: e.project?.code ?? null,
          hours: [0, 0, 0, 0, 0, 0, 0],
        };
        map.set(key, row);
      }
      const dayIdx = dateStrings.indexOf(e.entry_date);
      if (dayIdx >= 0) row.hours[dayIdx] += e.hours;
    }
    return Array.from(map.values()).sort((a, b) => a.project.localeCompare(b.project));
  }, [currentWeekEntries, weekDates]);

  const gridDays = useMemo<TimesheetDay[]>(
    () =>
      weekDates.map((d) => {
        const dow = d.getDay();
        return {
          label: d.toLocaleDateString(undefined, { weekday: 'short' }),
          dateNum: String(d.getDate()),
          weekend: dow === 0 || dow === 6,
        };
      }),
    [weekDates]
  );

  // ── timesheet-entry: editable-state machine (FR-TSE-001/002/003) ───────────
  // Editable iff the sheet is absent, or the signed-in user owns it AND it is Draft.
  const editable =
    currentTimesheet == null ||
    (currentTimesheet.user_id === signedInUserId && currentTimesheet.status === 'Draft');

  const { saveWeek, deleteRow } = useTimesheetEntryMutations();
  const { data: allProjects } = useProjects();

  const weekDateStrings = useMemo(() => weekDates.map(formatDate), [weekDates]);

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
    if (editRows !== seedRows) setEditRows(seedRows);
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
        code: r.code,
        hours: r.hours.map((c) => parseHourCell(c).value || 0),
      })),
    [editRows]
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
        project: proj.name,
        code: proj.code,
        hours: ['', '', '', '', '', '', ''],
        note: '',
      },
    ]);
  };

  // Delete-row confirm (mandatory destructive ConfirmDialog — FR-TSE-008/009).
  const [confirmDeleteRowId, setConfirmDeleteRowId] = useState<string | null>(null);
  const rowToDelete = editRows.find((r) => r.project_id === confirmDeleteRowId) ?? null;
  const confirmDeleteRow = () => {
    if (!confirmDeleteRowId) return;
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

    // Remove optimistically from edit state; restore on server error (resilience F5).
    setEditRows((rows) => rows.filter((r) => r.project_id !== rowIdToDelete));
    deleteRow.mutate(
      { entryIds: persistedEntryIds },
      {
        onSuccess: () => toast('Row deleted', 'Removed this project from the week', 'success'),
        onError: (err) => {
          // Restore the removed row so the user's data is not silently lost.
          if (removedRow) {
            setEditRows((rows) => [...rows, removedRow]);
          }
          toast('Delete failed', err.message, 'warning');
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
        onError: (err: { message: string }) => toast('Save failed', err.message, 'warning'),
      }
    );
  };

  const weeklyTotal = useMemo(
    () => currentWeekEntries.reduce((sum, e) => sum + e.hours, 0),
    [currentWeekEntries]
  );

  const stepWeek = (delta: number) => {
    const next = new Date(currentDate);
    next.setDate(next.getDate() + delta * 7);
    setCurrentDate(next);
  };

  const weekRangeLabel = `${weekStartDate.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })} – ${weekDates[6].toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })}`;

  // Submit affordance (FR-TS-004): only the owner of a Draft sheet for this week.
  const isOwner = currentTimesheet?.user_id === signedInUserId;
  const actions = currentTimesheet
    ? timesheetActions(currentTimesheet.status as TimesheetStatus, Boolean(isOwner), false)
    : { submit: false, approve: false, reject: false };

  // T14/AC-IXD-TS-001: Submit renders co-located in the footer FROM FIRST PAINT (even on a brand-new
  // no-draft week), but is DISABLED until a Draft sheet exists with at least one PERSISTED entry —
  // "Save your hours first". `actions.submit` requires a Draft owned by this user; the entry guard
  // requires the hours to be persisted (not merely typed locally), so you can't submit an empty week.
  const canSubmit = actions.submit && currentWeekEntries.length > 0;

  // T1: commit the week for approval, toast on resolve (§6.7). The RPC contract
  // (submit_timesheet { id }) is preserved; the confirm only gates the click.
  const commitSubmit = () => {
    if (!currentTimesheet) return;
    submit.mutate(
      { id: currentTimesheet.id },
      {
        onSuccess: () => {
          setConfirmSubmit(false);
          toast('Timesheet submitted', 'Sent to your line manager for approval', 'success');
        },
        onError: (err: unknown) => {
          setConfirmSubmit(false);
          toast('Submit failed', err instanceof Error ? err.message : undefined, 'warning');
        },
      },
    );
  };

  // T1 confirm dialog — shared across the grid-view renders below.
  const submitConfirm = confirmSubmit && currentTimesheet && (
    <ConfirmDialog
      open
      tone="default"
      title="Submit this week for approval?"
      description="This sends the whole week to your line manager. You can't edit it again until it's returned."
      confirmLabel="Submit timesheet"
      loading={submit.isPending}
      onCancel={() => setConfirmSubmit(false)}
      onConfirm={commitSubmit}
    />
  );

  // A-6 page view-gate (after all hooks — Rules of Hooks): a denied role (Finance) gets the
  // shared access-denied surface, not a savable grid or the approvals queue.
  if (!canEnterTimesheet) {
    return (
      <AccessDenied
        title="You don't have access to Timesheets"
        sub="Timesheets and approvals are part of the workforce surface. Finance work lives on your dashboard, projects, and procurement."
        onBack={() => navigate('/')}
      />
    );
  }

  // ── Page head + toolbar (shared by both views) ──────────────────────────────
  const head = (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-bold tracking-[-0.02em]">Timesheets</h1>
          <p className="mt-0.5 max-w-[72ch] text-sm text-muted-foreground">
            Week of {weekRangeLabel}. Enter hours per project per day, then submit the whole week for
            your line manager to approve.
          </p>
        </div>
      </div>

      <Toolbar standalone>
        <ViewToggle<'grid' | 'approvals'>
          options={[
            { value: 'grid', label: 'Weekly grid', icon: 'cal' },
            { value: 'approvals', label: 'Approvals queue', icon: 'check', count: pendingCount },
          ]}
          value={view}
          onChange={setView}
          ariaLabel="Timesheet view"
        />
        <span className="ml-auto inline-flex items-center gap-0.5">
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous week"
            onClick={() => stepWeek(-1)}
          >
            <Icon name="back" />
          </Button>
          <span className="px-2 text-[13px] font-medium tabular text-muted-foreground">
            Week of {weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
          <Button variant="outline" size="icon" aria-label="Next week" onClick={() => stepWeek(1)}>
            <Icon name="chev" />
          </Button>
        </span>
      </Toolbar>
    </>
  );

  // ── Approvals queue view ────────────────────────────────────────────────────
  if (view === 'approvals') {
    return (
      <div>
        {head}
        <ApprovalsQueue />
      </div>
    );
  }

  // ── Weekly grid view ────────────────────────────────────────────────────────
  if (isPending) {
    return (
      <div>
        {head}
        <div className="rounded-lg border border-border bg-card" data-testid="timesheets-loading">
          <ListState variant="loading" rows={5} />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        {head}
        <ListState
          variant="error"
          title="Couldn't load timesheets"
          sub="Something went wrong fetching your hours."
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const status = (currentTimesheet?.status as TimesheetStatus | undefined) ?? null;
  const returned = status === TimesheetStatus.Rejected;

  return (
    <div>
      {head}

      {/* Returned-for-changes is an expected, recoverable state (role=status). */}
      {returned && (
        <ErrBanner
          title="This week was returned for changes"
          sub="Your line manager sent it back. Review the flagged days, correct them, and resubmit."
        />
      )}

      <Card clip>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3.5 py-2.5">
          <StatusPill variant={status ? PILL[status] : 'neutral'}>
            {status === TimesheetStatus.Draft || !status ? 'Draft — not submitted' : status}
          </StatusPill>
          {editable && (
            <label
              htmlFor="ts-add-project"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
            >
              <Icon name="plus" aria-hidden />
              Add project
              <select
                id="ts-add-project"
                aria-label="Add a project"
                value=""
                onChange={(e) => {
                  if (e.target.value) addProject(e.target.value);
                }}
                disabled={pickerOptions.length === 0}
                className="touch-target h-8 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground disabled:opacity-45"
              >
                <option value="">
                  {pickerOptions.length === 0 ? 'No projects to add' : 'Select a project…'}
                </option>
                {pickerOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span
            data-testid="timesheets-weekly-total"
            className="ml-auto text-[13px] tabular text-muted-foreground"
          >
            {(editable ? editTotals.weekly : weeklyTotal).toFixed(1)}{' '}
            h this week
          </span>
        </div>

        {editable ? (
          editGridRows.length === 0 ? (
            <div data-testid="timesheets-empty" className="px-3.5 py-8 text-center">
              <p className="text-sm font-medium text-foreground">No hours logged this week</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Use “Add a project” above to start logging hours.
              </p>
            </div>
          ) : (
            <TimesheetGrid
              days={gridDays}
              rows={editGridRows}
              editable
              notes={editNotes}
              rawHours={editRawHours}
              invalidCells={invalidCells}
              onCellChange={setCell}
              onNoteChange={setNote}
              onDeleteRow={(id) => setConfirmDeleteRowId(id)}
            />
          )
        ) : gridRows.length === 0 ? (
          <div data-testid="timesheets-empty">
            <ListState
              variant="empty"
              icon="clock"
              title="No hours logged this week"
              sub="Add a project to start logging hours, or use the week controls to find another week."
            />
          </div>
        ) : (
          <TimesheetGrid days={gridDays} rows={gridRows} />
        )}

        {editable && (
          <div
            data-testid="timesheets-footer"
            className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-3.5 py-2.5"
          >
            {/* Helper text co-located with the disabled Submit (color-not-only; explains the gate). */}
            {!canSubmit && (
              <span className="mr-auto text-[13px] text-muted-foreground">
                Save your hours first
              </span>
            )}
            {/* Save = secondary (outline): a routine reversible write, single-click + quiet toast. */}
            <Button
              variant="outline"
              onClick={commitSave}
              disabled={!editValid || saveWeek.isPending}
              loading={saveWeek.isPending}
            >
              <Icon name="check" />
              Save
            </Button>
            {/* Submit = primary, co-located. Shown from first paint; disabled until a Draft with
                persisted hours exists (T14). Opens a confirm before the state-lock. */}
            <Button
              variant="primary"
              onClick={() => setConfirmSubmit(true)}
              disabled={!canSubmit || submit.isPending}
              loading={submit.isPending}
            >
              <Icon name="check" />
              Submit timesheet
            </Button>
          </div>
        )}
      </Card>

      {/* AC-IXD-TS-004: the per-project + recent-entries rollup panels are removed — the grid's own
          TOTAL column + daily-total row + header weekly total are the single source of truth; the
          rollups live on the Engineer dashboard only (plan task 16). */}

      {submitConfirm}

      {rowToDelete && (
        <ConfirmDialog
          open
          tone="destructive"
          title="Delete this project row?"
          description={
            <>
              This removes <strong>{rowToDelete.project}</strong> and all its hours from this week.
              You can add it back, but the entered hours won&rsquo;t be restored.
            </>
          }
          confirmLabel="Delete row"
          loading={deleteRow.isPending}
          onCancel={() => setConfirmDeleteRowId(null)}
          onConfirm={confirmDeleteRow}
        />
      )}
    </div>
  );
};

export default TimesheetsPage;
