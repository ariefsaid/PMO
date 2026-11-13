import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDay, formatNumberExact } from '@/src/lib/format';
import { overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import type { MyTask } from '@/src/hooks/useMyTasks';
import type { ExpenseClaimWithRefs } from '@/src/lib/db/expenseClaims';
import type { TimesheetEntryWithProject } from '@/src/lib/db/timesheets';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { Card, CardHead, CardPad } from '@/src/components/ui/Card';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { LateText } from '@/src/components/ui/LateText';
import { isMostUrgentLateRow } from '@/src/components/ui/lateTextRows';
import { MonthColumns } from '@/src/components/dashboard/charts';

interface PanelState {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

const linkClass = 'inline-flex items-center gap-1 text-control font-medium text-primary-text hover:underline pointer-coarse:min-h-11 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const CardLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className={linkClass}><span>{children}</span><Icon name="chev" className="size-4" /></Link>
);

/**
 * This week's timesheet: its state, the hours so far, the week as one strip (Mon–Sun) and the ONE filled action
 * ("Log time", or "Submit week" once there are hours to submit).
 */
export function EngineerTimesheetCard({
  loading,
  error,
  onRetry,
  status,
  days,
  hours,
  chart = false,
}: PanelState & {
  /** The stored timesheet status of this week; null when no sheet exists yet. */
  status: string | null;
  days: Array<{ date: string; label: string; hours: number }>;
  hours: number;
  /** Overview: the week as a column chart instead of the strip. */
  chart?: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const open = status === 'Submitted' || status === 'Approved';
  const action = open ? null : hours > 0 ? t('home.eng.submitWeek', 'Submit week') : t('home.eng.logTime', 'Log time');
  return (
    <Card data-testid="engineer-timesheet">
      <CardHead level={2} actions={status ? <StatusPill record="timesheet" state={status} /> : undefined}>{t('home.eng.thisWeek', 'This week’s timesheet')}</CardHead>
      <CardPad className="grid gap-4">
        {loading ? <ListState variant="loading" rows={3} />
          : error ? <ListState variant="error" title={t('hub.engineer.timesheetsError', "Couldn't load your timesheets")} onRetry={onRetry} />
            : (
              <>
                <div className="text-[23px] font-bold leading-none tabular">{formatNumberExact(hours)} {t('hub.engineer.hourUnit', 'h')}</div>
                {status === 'Rejected' && <p className="text-control text-destructive-text">{t('home.eng.returnedLine', 'Sent back for correction.')}</p>}
                {chart
                  ? <MonthColumns labelAll height={150} ariaLabel={t('home.eng.weekStrip', 'Hours by day this week')} points={days.map((day) => ({ key: day.date, tick: day.label, a: day.hours, labelA: day.hours > 0 ? formatNumberExact(day.hours) : undefined }))} />
                  : (
                  <ol aria-label={t('home.eng.weekStrip', 'Hours by day this week')} className="grid grid-cols-7 gap-1 text-center text-control">
                    {days.map((day) => (
                      <li key={day.date} className="min-w-0 rounded-md bg-secondary px-1 py-1.5">
                        <span className="block text-muted-foreground">{day.label}</span>
                        <span className={day.hours > 0 ? 'block font-semibold tabular' : 'block text-muted-foreground tabular'}>{day.hours > 0 ? formatNumberExact(day.hours) : '—'}</span>
                      </li>
                    ))}
                  </ol>
                  )}
              </>
            )}
        {/* The way into the timesheet stays whatever state the data is in. */}
        {action
          ? <Link to="/timesheets" className={buttonClasses('primary', 'default', 'w-full sm:w-fit pointer-coarse:min-h-11')}>{action}</Link>
          : <CardLink to="/timesheets">{t('home.eng.openTimesheet', 'Open timesheet')}</CardLink>}
      </CardPad>
    </Card>
  );
}

/** A task opens in its project's task drawer; a task with no project falls back to My Tasks. */
const taskHref = (task: MyTask) => task.project_id ? `/projects/${task.project_id}/tasks?open=${encodeURIComponent(task.id)}` : '/my-tasks';

/** My tasks: the most overdue first, at most five, each with how late it is (or when it is due). */
export function EngineerTasksCard({
  overdue,
  dueThisWeek,
  today,
  loading,
  error,
  onRetry,
}: PanelState & { overdue: MyTask[]; dueThisWeek: MyTask[]; today: string | null }) {
  const { t } = useTranslation('dashboard');
  const oldestFirst = [...overdue].sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
  const rows = [...oldestFirst, ...dueThisWeek].slice(0, 5);
  return (
    <Card data-testid="engineer-tasks">
      <CardHead level={2} actions={<CardLink to="/my-tasks">{t('home.eng.allTasks', 'All tasks')}</CardLink>}>{t('home.eng.myTasks', 'My tasks')}</CardHead>
      <div className="px-[var(--panel-inset)] pb-2">
        {loading ? <ListState variant="loading" rows={3} />
          : error ? <ListState variant="error" title={t('hub.engineer.tasksError', "Couldn't load your tasks")} onRetry={onRetry} />
            : rows.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{t('hub.engineer.noTasksDue', 'No overdue tasks or tasks due this week.')}</p>
              : (
                <ul className="min-w-0 divide-y divide-border">
                  {rows.map((task) => {
                    const late = today && task.end_date && task.end_date < today ? overdueAgeDays(task.end_date, today) : null;
                    const isUrgent = late !== null && isMostUrgentLateRow(oldestFirst, task);
                    return (
                      <li key={task.id} className="min-w-0">
                        <Link to={taskHref(task)} className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-control font-normal">{task.name}</span>
                            <span className="block truncate text-control text-muted-foreground">{task.project_name ?? t('hub.engineer.noProject', 'No project')}</span>
                          </span>
                          {late !== null
                            ? <LateText className="shrink-0 whitespace-nowrap" emphasis={isUrgent}>{t('hub.engineer.daysLate', { count: late, defaultValue_one: '{{count}} day overdue', defaultValue_other: '{{count}} days overdue' })}</LateText>
                            : <span className="shrink-0 whitespace-nowrap text-control text-muted-foreground">{t('hub.engineer.dueDate', 'Due {{date}}', { date: formatDay(task.end_date) })}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
      </div>
    </Card>
  );
}

/** Returned to me: expense claims sent back. Drawn only when there are some. */
export function EngineerReturnedCard({ claims }: { claims: ExpenseClaimWithRefs[] }) {
  const { t } = useTranslation('dashboard');
  if (claims.length === 0) return null;
  return (
    <Card data-testid="engineer-returned">
      <CardHead level={2} actions={<CardLink to="/expenses?status=Rejected">{t('home.eng.allReturned', 'All returned')}</CardLink>}>{t('home.eng.returnedToMe', 'Returned to me')}</CardHead>
      <ul className="divide-y divide-border px-[var(--panel-inset)] pb-2">
        {claims.slice(0, 5).map((claim) => (
          <li key={claim.id}>
            <Link to="/expenses?status=Rejected" className="flex min-h-11 items-center justify-between gap-3 py-2 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <span className="min-w-0">
                <span className="block truncate text-control font-medium">{claim.title}</span>
                <span className="block truncate text-control text-muted-foreground">{claim.project?.short_name ?? claim.project?.name ?? t('hub.engineer.noProject', 'No project')}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function EngineerRecentEntriesPanel({
  entries,
  statusBySheet,
  loading,
  error,
  onRetry,
}: PanelState & {
  entries: TimesheetEntryWithProject[];
  statusBySheet: Map<string, string>;
}) {
  const { t } = useTranslation('dashboard');
  const title = t('hub.engineer.recentEntries', 'Recent entries');
  return (
    <Card aria-label={title} data-testid="engineer-recent">
      <CardHead level={2} actions={<CardLink to="/timesheets">{t('home.eng.allTimesheets', 'All timesheets')}</CardLink>}>{title}</CardHead>
      <div className="px-[var(--panel-inset)] pb-2">
        {loading ? <ListState variant="loading" rows={3} />
          : error ? <ListState variant="error" title={t('hub.engineer.timesheetsError', "Couldn't load your timesheets")} onRetry={onRetry} />
            : entries.length === 0 ? <p className="pb-2 text-control text-muted-foreground">{t('hub.engineer.noRecentEntries', 'No recent time entries')}</p>
              : (
                <ul className="divide-y divide-border">
                  {entries.map((entry) => {
                    const status = statusBySheet.get(entry.timesheet_id);
                    const project = entry.project?.name ?? t('hub.engineer.projectUnavailable', 'project unavailable');
                    return (
                      <li key={entry.id}>
                        <Link
                          to="/timesheets"
                          aria-label={t('hub.engineer.openEntry', 'Open timesheet entry for {{project}}: {{description}}', { project, description: entry.notes?.trim() || formatDay(entry.entry_date) })}
                          className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 text-foreground hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          <span className="min-w-0">
                            <span className="block text-control font-medium tabular">{formatDay(entry.entry_date)} · {formatNumberExact(entry.hours)} {t('hub.engineer.hourUnit', 'h')}</span>
                            <span className="block truncate text-control text-muted-foreground">{project}{entry.notes ? ` · ${entry.notes}` : ''}</span>
                          </span>
                          {status && <span className="shrink-0"><StatusPill record="timesheet" state={status} /></span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
      </div>
    </Card>
  );
}
