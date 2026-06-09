import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill, type StatusVariant } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { HoursBar } from '@/src/components/ui/HoursBar';
import { EntryList } from '@/src/components/ui/EntryList';
import { entriesByProject, recentEntries } from '@/src/lib/timesheet-derive';
import { DashPageHead, DashGrid } from './layout';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const RECENT_ENTRIES_LIMIT = 8;

function timesheetVariant(status: string): StatusVariant {
  switch (status) {
    case 'Approved': return 'won';
    case 'Submitted': return 'open';
    case 'Rejected': return 'lost';
    default: return 'draft';
  }
}

/**
 * Engineer pane — the hours half is real off `useTimesheets` (own-user): the
 * latest sheet is "this week", its entries grouped by weekday give the hours
 * breakdown. The tasks half (active/completed/list) has NO query/RLS in the
 * codebase, so it is a single coming-soon placeholder — never the legacy mock
 * tasks (plan §4.3 / Open Q7).
 *
 * Phase 3 (T7-T10): densified with "This week by project" (real, grouped) and
 * "Recent entries" (top 8, newest first). No deferred-module slots added.
 */
export const EngineerDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: sheets, isPending, isError, refetch } = useTimesheets();

  // listTimesheets returns newest-first → the first sheet is the current week.
  const current = sheets?.[0];
  const hoursThisWeek = useMemo(
    () => (current?.entries ?? []).reduce((s, e) => s + (e.hours || 0), 0),
    [current],
  );

  // Hours per day for the existing day-bar card
  const byDay = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const e of current?.entries ?? []) {
      const d = new Date(`${e.entry_date}T00:00:00`).getDay();
      totals[d] += e.hours || 0;
    }
    return totals;
  }, [current]);
  const maxDay = Math.max(1, ...byDay);

  // T7/T8: Hours grouped by project for the "This week by project" card
  const byProject = useMemo(
    () => entriesByProject(current?.entries ?? []),
    [current],
  );

  // T9: Flatten all sheets + top 8 recent entries
  const flatRecent = useMemo(
    () => recentEntries(sheets ?? [], RECENT_ENTRIES_LIMIT),
    [sheets],
  );

  return (
    <div className="space-y-4">
      <DashPageHead title="My Dashboard" sub="Your hours this week and timesheet status." />

      <section aria-label="My KPIs" className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        {/* AC-IXD-DASH-W5-C2A: Hours this week → /timesheets (the one place an IC acts) */}
        <KPITile testId="kpi-hours-week" tone="blue" icon="clock" label="Hours this week"
          value={`${hoursThisWeek}`} loading={isPending}
          vs={current ? `week of ${current.week_start_date}` : undefined}
          to="/timesheets"
          linkLabel="Open your timesheets to log this week's hours"
          help="Total hours on your most recent timesheet." />
        {/* AC-IXD-DASH-W5-C2A: Timesheet status → /timesheets */}
        <KPITile testId="kpi-timesheet-status" tone="violet" icon="doc" label="Timesheet status"
          value={current
            ? <StatusPill variant={timesheetVariant(current.status)}>{current.status}</StatusPill>
            : <span className="text-muted-foreground">None this period</span>}
          loading={isPending}
          to="/timesheets"
          linkLabel="Open your timesheets to see your current status"
          help="The status of your most recent timesheet." />
      </section>

      {/* T8: Two-up DashGrid — Hours This Week (existing) + This week by project (new) */}
      <DashGrid>
        {/* Left: existing day-bar card */}
        <Card>
          <CardHead>Hours This Week</CardHead>
          <div className="px-4 pb-3.5">
            {isError ? (
              <ListState variant="error" title="Couldn't load your timesheets" onRetry={() => refetch()} />
            ) : isPending ? (
              <ListState variant="loading" />
            ) : !current || hoursThisWeek === 0 ? (
              <ListState variant="empty" icon="clock" title="No hours logged this week"
                sub="Log your hours to see your weekly breakdown."
                action={{ label: 'Log hours', onClick: () => navigate('/timesheets') }} />
            ) : (
              <div role="group" aria-label="Hours this week by day" className="flex flex-col gap-1">
                {byDay.map((h, i) =>
                  h > 0 ? (
                    <div key={i} className="flex items-center gap-2.5 py-[5px]">
                      <span className="w-10 shrink-0 text-[12px] text-muted-foreground">{DAY_LABELS[i]}</span>
                      <span
                        role="progressbar"
                        aria-label={`${DAY_LABELS[i]}: ${h} hours`}
                        aria-valuenow={h}
                        aria-valuemin={0}
                        aria-valuemax={maxDay}
                        className="h-[9px] flex-1 overflow-hidden rounded-full bg-secondary"
                      >
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${(h / maxDay) * 100}%` }} />
                      </span>
                      <span className="w-12 shrink-0 text-right text-xs font-semibold tabular">{h}h</span>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </Card>

        {/* Right: T7/T8 — This week by project */}
        <Card>
          <CardHead>This week by project</CardHead>
          <div className="px-4 pb-3.5">
            {isError ? (
              <ListState variant="error" title="Couldn't load your timesheets" onRetry={() => refetch()} />
            ) : isPending ? (
              <ListState variant="loading" />
            ) : byProject.length === 0 ? (
              <ListState variant="empty" icon="clock" title="No hours logged this week"
                sub="Log your hours to see a project breakdown." />
            ) : (
              <div role="group" aria-label="This week by project" className="flex flex-col">
                {byProject.map((row) => (
                  <HoursBar
                    key={row.projectId}
                    label={row.name}
                    code={row.code}
                    hours={row.hours}
                    maxHours={hoursThisWeek}
                  />
                ))}
              </div>
            )}
          </div>
        </Card>
      </DashGrid>

      {/* T9: Full-width — Recent entries (top 8, newest first) */}
      <Card>
        <CardHead>Recent entries</CardHead>
        {isPending ? (
          <ListState variant="loading" rows={4} />
        ) : isError ? (
          <ListState variant="error" title="Couldn't load recent entries" onRetry={() => refetch()} />
        ) : (
          <EntryList entries={flatRecent} />
        )}
      </Card>
    </div>
  );
};
