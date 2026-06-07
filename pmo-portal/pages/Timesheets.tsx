import React, { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardHead,
  ErrBanner,
  Icon,
  ListState,
  StatusPill,
  TimesheetGrid,
  Toolbar,
  ViewToggle,
  HoursBar,
  EntryList,
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
import { useTimesheetsView } from '@/src/hooks/useTimesheetsView';
import { timesheetActions } from '@/src/lib/db/timesheetTransition';
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
  const signedInUserId = currentUser?.id;
  const [view, setView] = useTimesheetsView();

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
            onClick={() => submit.mutate({ id: currentTimesheet!.id })}
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
          <span
            data-testid="timesheets-weekly-total"
            className="ml-auto text-[13px] tabular text-muted-foreground"
          >
            {weeklyTotal.toFixed(1)} h this week
          </span>
        </div>

        {gridRows.length === 0 ? (
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
    </div>
  );
};

export default TimesheetsPage;
