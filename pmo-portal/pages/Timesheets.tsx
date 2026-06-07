import React, { useMemo, useRef, useState } from 'react';
import {
  Button,
  Card,
  CardHead,
  ConfirmDialog,
  ErrBanner,
  Icon,
  ListState,
  StatusPill,
  TimesheetGrid,
  Toolbar,
  ViewToggle,
  HoursBar,
  EntryList,
  useToast,
  type StatusVariant,
  type TimesheetDay,
  type TimesheetGridRow,
} from '@/src/components/ui';
import { entriesByProject, type FlatEntry } from '@/src/lib/timesheet-derive';
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
  diffEntries,
  gridIsValid,
  parseHourCell,
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

  // Seed the in-memory edit state from the last-fetched server grid. Re-seed when
  // the week, the sheet identity, or the server entries change (an identity key
  // keeps editing stable across unrelated re-renders — no write happens here).
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
      `${currentTimesheet?.id ?? 'none'}|${weekStartString}|${currentWeekEntries
        .map((e) => `${e.id}:${e.hours}`)
        .join(',')}`,
    [currentTimesheet, weekStartString, currentWeekEntries]
  );
  const [editRows, setEditRows] = useState<EditRow[]>(seedRows);
  const lastSeedKey = useRef<string | null>(null);
  if (lastSeedKey.current !== seedKey) {
    lastSeedKey.current = seedKey;
    if (editRows !== seedRows) setEditRows(seedRows);
  }

  // Server entries shaped for diffEntries (id/project/date/hours per cell).
  const serverEntriesForDiff = useMemo(
    () =>
      currentWeekEntries.map((e) => ({
        id: e.id,
        project_id: e.project_id,
        entry_date: e.entry_date,
        hours: e.hours,
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
    const persistedEntryIds = currentWeekEntries
      .filter((e) => e.project_id === confirmDeleteRowId)
      .map((e) => e.id);
    // Remove from edit state immediately; delete persisted entries if any exist.
    setEditRows((rows) => rows.filter((r) => r.project_id !== confirmDeleteRowId));
    if (persistedEntryIds.length > 0) {
      deleteRow.mutate(
        { entryIds: persistedEntryIds },
        {
          onSuccess: () => toast('Row deleted', 'Removed this project from the week', 'success'),
          onError: (err) => toast('Delete failed', err.message, 'warning'),
        }
      );
    }
    setConfirmDeleteRowId(null);
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
    saveWeek.mutate(
      { currentTimesheetId: currentTimesheet?.id ?? null, weekStartDate: weekStartString, diff },
      {
        onSuccess: () =>
          toast(
            'Timesheet saved',
            `${changeCount} ${changeCount === 1 ? 'change' : 'changes'} saved`,
            'success'
          ),
        onError: (err: { message: string }) => toast('Save failed', err.message, 'warning'),
      }
    );
  };

  const weeklyTotal = useMemo(
    () => currentWeekEntries.reduce((sum, e) => sum + e.hours, 0),
    [currentWeekEntries]
  );

  // T11/T12: By-project summary from gridRows (already memoized above)
  const byProject = useMemo(
    () => entriesByProject(currentWeekEntries),
    [currentWeekEntries]
  );

  // T13: Recent entries this week, sorted newest-first (re-wrap as FlatEntry shape)
  const recentWeekEntries = useMemo<FlatEntry[]>(
    () =>
      [...currentWeekEntries]
        .sort((a, b) => b.entry_date.localeCompare(a.entry_date))
        .map((e) => ({ ...e, sheetId: currentTimesheet?.id ?? '' })),
    [currentWeekEntries, currentTimesheet]
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
        {view === 'grid' && actions.submit && (
          <Button
            variant="primary"
            onClick={() => setConfirmSubmit(true)}
            loading={submit.isPending}
          >
            <Icon name="check" />
            Submit timesheet
          </Button>
        )}
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
                className="h-8 rounded-md border border-input bg-background px-2.5 text-[13px] text-foreground disabled:opacity-45"
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
            {(editable ? editGridRows.reduce((s, r) => s + r.hours.reduce((a, b) => a + b, 0), 0) : weeklyTotal).toFixed(1)}{' '}
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
          <div className="flex justify-end gap-2 border-t border-border px-3.5 py-2.5">
            <Button
              variant="primary"
              onClick={commitSave}
              disabled={!editValid || saveWeek.isPending}
              loading={saveWeek.isPending}
            >
              <Icon name="check" />
              Save
            </Button>
          </div>
        )}
      </Card>

      {/* T11-T13: Two-up surround panels — only when the week has hours */}
      {gridRows.length > 0 && (
        <div className="grid grid-cols-1 gap-4 min-[920px]:grid-cols-2">
          {/* T11/T12 — By project this week */}
          <Card>
            <CardHead>By project this week</CardHead>
            <div className="px-4 pb-3.5">
              <div role="group" aria-label="By project this week" className="flex flex-col">
                {byProject.map((row) => (
                  <HoursBar
                    key={row.projectId}
                    label={row.name}
                    code={row.code}
                    hours={row.hours}
                    maxHours={weeklyTotal}
                  />
                ))}
              </div>
            </div>
          </Card>

          {/* T13 — Recent entries this week */}
          <Card>
            <CardHead>Recent entries this week</CardHead>
            <EntryList entries={recentWeekEntries} />
          </Card>
        </div>
      )}

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
