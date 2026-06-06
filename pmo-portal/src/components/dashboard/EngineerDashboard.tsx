import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { KPITile } from '@/src/components/ui/KPITile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill, type StatusVariant } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { DashPageHead, DashGrid } from './layout';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
  const byDay = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const e of current?.entries ?? []) {
      const d = new Date(`${e.entry_date}T00:00:00`).getDay();
      totals[d] += e.hours || 0;
    }
    return totals;
  }, [current]);
  const maxDay = Math.max(1, ...byDay);

  return (
    <div className="space-y-4">
      <DashPageHead title="My Dashboard" sub="Your hours this week and timesheet status." />

      <section aria-label="My KPIs" className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1180px]:grid-cols-3">
        <KPITile testId="kpi-hours-week" tone="blue" icon="clock" label="Hours this week"
          value={`${hoursThisWeek}`} loading={isPending}
          vs={current ? `week of ${current.week_start_date}` : undefined}
          help="Total hours on your most recent timesheet." />
        <KPITile testId="kpi-timesheet-status" tone="violet" icon="doc" label="Timesheet status"
          value={current ? <StatusPill variant={timesheetVariant(current.status)}>{current.status}</StatusPill> : '—'}
          loading={isPending}
          help="The status of your most recent timesheet." />
        <KPITile testId="kpi-tasks" tone="cyan" icon="check" label="My tasks"
          value="—" vs="task tracking coming soon"
          help="Task tracking is a deferred follow-up — no tasks query exists yet." />
      </section>

      <DashGrid>
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

        <Card>
          <CardHead>My Tasks</CardHead>
          <ListState
            variant="empty"
            icon="check"
            title="Task tracking is coming soon"
            sub="Per-engineer task assignments need a new backend slice; tracked as a follow-up."
          />
        </Card>
      </DashGrid>
    </div>
  );
};
