import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { formatDateOnly, formatNumberExact } from '@/src/lib/format';
import { overdueAgeDays } from '@/src/lib/repositories/revenueDisplay';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import type { MyTask } from '@/src/hooks/useMyTasks';
import type { ExpenseClaimWithRefs } from '@/src/lib/db/expenseClaims';
import type { FlatEntry, ProjectHoursSummary } from '@/src/lib/timesheet-derive';
import { AttentionList, type AttentionItem } from '@/src/components/dashboard/hub/AttentionList';
import { AreaPanel } from '@/src/components/dashboard/hub/AreaPanel';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { HoursBar } from '@/src/components/ui/HoursBar';
import { Icon } from '@/src/components/ui/icons';
import { ListState } from '@/src/components/ui/ListState';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { Tooltip } from '@/src/components/ui/Tooltip';
import type { NeedsItem } from '../../restructure/useNeedsYou';

interface PanelState {
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

function FigureHelp({ label, content }: { label: string; content: string }) {
  const { t } = useTranslation('dashboard');
  return (
    <Tooltip title={label} content={content}>
      <button
        type="button"
        aria-label={t('hub.engineer.explain', 'Explain {{label}}', { label })}
        className="touch-target grid size-5 place-items-center text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Icon name="help" className="size-4" />
      </button>
    </Tooltip>
  );
}

function attentionItems(items: NeedsItem[], detail: string): AttentionItem[] {
  return items.map((item) => ({
    id: item.id,
    tone: item.tone,
    count: item.count,
    label: item.label,
    href: item.href,
    tooltip: detail,
  }));
}

/** N18: with no hours this week the Time panel is one line with its doorway, not an empty chart. */
function NoHoursLine() {
  const { t } = useTranslation('dashboard');
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      <span>{t('hub.engineer.noHoursWeek', 'No hours this week')}</span>
      <span aria-hidden="true">·</span>
      <Link to="/timesheets" className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {t('hub.engineer.logHoursShort', 'Log hours')}
      </Link>
    </p>
  );
}

export function EngineerTimePanel({
  attention,
  loading,
  error,
  onRetry,
  days,
  maxDay,
  hasHours,
}: PanelState & {
  attention: NeedsItem[];
  days: Array<{ date: string; label: string; hours: number }>;
  maxDay: number;
  hasHours: boolean;
}) {
  const { t } = useTranslation('dashboard');
  const items = useMemo(
    () => attentionItems(attention, t('hub.engineer.timeAttentionHelp', 'This item comes from your current week’s timesheet status.')),
    [attention, t],
  );

  return (
    <AreaPanel
      title={t('hub.engineer.time', 'Time')}
      openHref="/timesheets"
      openLabel={t('hub.engineer.openTimesheets', 'Open Timesheets')}
    >
      {loading ? (
        <ListState variant="loading" rows={3} />
      ) : error ? (
        <ListState
          variant="error"
          title={t('hub.engineer.timesheetsError', "Couldn't load your timesheets")}
          onRetry={onRetry}
        />
      ) : (
        <>
          {items.length > 0 ? (
            <AttentionList items={items} compact />
          ) : (
            <p className="text-sm text-muted-foreground">{t('hub.engineer.noTimeAttention', 'No timesheet needs your attention.')}</p>
          )}
          {hasHours ? (
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{t('hub.engineer.hoursByDay', 'Hours by day this week')}</h3>
                <FigureHelp
                  label={t('hub.engineer.hoursByDay', 'Hours by day this week')}
                  content={t('hub.engineer.hoursByDayHelp', 'Each bar sums your current week’s timesheet entries for that day.')}
                />
              </div>
              <div role="group" aria-label={t('hub.engineer.hoursByDay', 'Hours by day this week')} className="grid gap-0.5">
                {days.map((day) => (
                  <HoursBar
                    key={day.date}
                    label={day.label}
                    code={null}
                    hours={day.hours}
                    maxHours={maxDay}
                    formatValue={(hours) => `${formatNumberExact(hours)} ${t('hub.engineer.hourUnit', 'h')}`}
                  />
                ))}
              </div>
            </div>
          ) : <NoHoursLine />}
        </>
      )}
      {(loading || error || hasHours) && (
        <Link to="/timesheets" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {t('hub.engineer.logHours', 'Log hours in Timesheets')}
          <Icon name="chev" className="size-4" />
        </Link>
      )}
    </AreaPanel>
  );
}

/** A task opens in its project's task drawer; a task with no project falls back to My Tasks. */
const taskHref = (task: MyTask) => task.project_id ? `/projects/${task.project_id}/tasks?open=${encodeURIComponent(task.id)}` : '/my-tasks';

function TaskRows({ rows, today }: { rows: MyTask[]; today: string | null }) {
  const { t } = useTranslation('dashboard');
  return (
    <ul className="min-w-0 divide-y divide-border">
      {rows.slice(0, 5).map((task) => {
        // N15: an overdue task says how late it is, in red; a task due this week says its date.
        const late = today && task.end_date && task.end_date < today ? overdueAgeDays(task.end_date, today) : null;
        return (
          <li key={task.id} className="min-w-0">
            <Link
              to={taskHref(task)}
              className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2 text-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{task.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {task.project_name ?? t('hub.engineer.noProject', 'No project')}
                  {late === null && <> · {t('hub.engineer.dueDate', 'Due {{date}}', { date: formatDateOnly(task.end_date) })}</>}
                </span>
              </span>
              {late !== null && (
                <span className="shrink-0 whitespace-nowrap text-xs font-medium text-destructive-text">
                  {t('hub.engineer.daysLate', { count: late, defaultValue: '{{count}} days late', defaultValue_one: '{{count}} day late' })}
                </span>
              )}
              <Icon name="chev" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function EngineerTasksPanel({
  overdue,
  dueThisWeek,
  today,
  loading,
  error,
  onRetry,
}: PanelState & { overdue: MyTask[]; dueThisWeek: MyTask[]; today: string | null }) {
  const { t } = useTranslation('dashboard');

  // L6: the "Tasks due" tile carries the overdue / due-this-week count; this panel lists the rows without restating it.
  return (
    <AreaPanel
      title={t('hub.engineer.tasks', 'Tasks')}
      openHref="/my-tasks"
      openLabel={t('hub.engineer.openMyTasks', 'Open My Tasks')}
    >
      {loading ? (
        <ListState variant="loading" rows={3} />
      ) : error ? (
        <ListState variant="error" title={t('hub.engineer.tasksError', "Couldn't load your tasks")} onRetry={onRetry} />
      ) : (
        <div className="grid min-w-0 gap-3">
          {overdue.length > 0 && (
            <section aria-label={t('hub.engineer.overdue', 'Overdue')} className="min-w-0">
              <h3 className="mb-1 text-sm font-semibold">{t('hub.engineer.overdue', 'Overdue')}</h3>
              <TaskRows rows={overdue} today={today} />
            </section>
          )}
          {dueThisWeek.length > 0 && (
            <section aria-label={t('hub.engineer.dueThisWeek', 'Due this week')} className="min-w-0">
              <h3 className="mb-1 text-sm font-semibold">{t('hub.engineer.dueThisWeek', 'Due this week')}</h3>
              <TaskRows rows={dueThisWeek} today={today} />
            </section>
          )}
          {overdue.length === 0 && dueThisWeek.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('hub.engineer.noTasksDue', 'No overdue tasks or tasks due this week.')}</p>
          )}
        </div>
      )}
    </AreaPanel>
  );
}

function ReturnedClaimRows({ claims }: { claims: ExpenseClaimWithRefs[] }) {
  const { t } = useTranslation('dashboard');
  return (
    <ul className="divide-y divide-border">
      {claims.slice(0, 5).map((claim) => (
        <li key={claim.id}>
          <Link
            to="/expenses"
            className="flex min-h-11 items-center justify-between gap-3 py-2 text-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{claim.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {claim.project?.short_name ?? claim.project?.name ?? t('hub.engineer.noProject', 'No project')}
              </span>
            </span>
            <StatusPill variant="lost">{t('hub.engineer.status.returned', 'Returned')}</StatusPill>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function EngineerExpensesPanel({
  attention,
  claims,
  loading,
  error,
  onRetry,
}: PanelState & { attention: NeedsItem[]; claims: ExpenseClaimWithRefs[] }) {
  const { t } = useTranslation('dashboard');
  const items = useMemo(
    () => attentionItems(attention, t('hub.engineer.expenseAttentionHelp', 'Your own expense claims that were returned for revision.')),
    [attention, t],
  );

  return (
    <AreaPanel
      title={t('hub.engineer.expenses', 'Expenses')}
      openHref="/expenses"
      openLabel={t('hub.engineer.openExpenses', 'Open Expenses')}
    >
      {loading ? (
        <ListState variant="loading" rows={3} />
      ) : error ? (
        <ListState variant="error" title={t('hub.engineer.expensesError', "Couldn't load your expense claims")} onRetry={onRetry} />
      ) : (
        <div className="grid gap-3">
          {items.length > 0 && <AttentionList items={items} compact />}
          {claims.length > 0 ? (
            <ReturnedClaimRows claims={claims} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('hub.engineer.noReturnedClaims', 'No expense claims have been returned to you.')}</p>
          )}
        </div>
      )}
    </AreaPanel>
  );
}

export function EngineerProjectHoursPanel({
  projects,
  loading,
  error,
  onRetry,
  totalHours,
}: PanelState & { projects: ProjectHoursSummary[]; totalHours: number }) {
  const { t } = useTranslation('dashboard');

  return (
    <AreaPanel
      title={t('hub.engineer.byProject', 'This week by project')}
      openHref="/timesheets"
      openLabel={t('hub.engineer.openTimesheets', 'Open Timesheets')}
    >
      {loading ? (
        <ListState variant="loading" rows={3} />
      ) : error ? (
        <ListState variant="error" title={t('hub.engineer.timesheetsError', "Couldn't load your timesheets")} onRetry={onRetry} />
      ) : (
        <>
          {projects.length > 0 && <h3 className="flex items-center gap-2 text-sm font-semibold">
            {t('hub.engineer.projectHours', 'Hours by project')}
            <FigureHelp
              label={t('hub.engineer.projectHours', 'Hours by project')}
              content={t('hub.engineer.projectHoursHelp', 'Each bar sums your current week’s timesheet entries for that project.')}
            />
          </h3>}
          {projects.length > 0 ? (
            <div role="group" aria-label={t('hub.engineer.byProject', 'This week by project')} className="grid gap-0.5">
              {projects.map((project) => {
                const projectUnavailable = project.name === 'Unknown';
                const bar = (
                  <HoursBar
                    label={projectUnavailable ? '—' : project.name}
                    code={project.code}
                    hours={project.hours}
                    maxHours={Math.max(totalHours, 1)}
                    formatValue={(hours) => `${formatNumberExact(hours)} ${t('hub.engineer.hourUnit', 'h')}`}
                  />
                );
                return projectUnavailable ? (
                  <Tooltip
                    key={project.projectId}
                    title={t('hub.engineer.projectUnavailable', 'Project unavailable')}
                    content={t('hub.engineer.projectUnavailableReason', 'The timesheet entry does not include its project name.')}
                  >
                    <span>{bar}</span>
                  </Tooltip>
                ) : <React.Fragment key={project.projectId}>{bar}</React.Fragment>;
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('hub.engineer.noHoursByProject', 'No hours to show by project this week.')}</p>
          )}
        </>
      )}
    </AreaPanel>
  );
}

function statusLabel(status: string | undefined, t: (key: string, defaultValue: string) => string): string {
  switch (status) {
    case 'Draft': return t('hub.engineer.status.draft', 'Draft');
    case 'Submitted': return t('hub.engineer.status.submitted', 'Submitted');
    case 'Approved': return t('hub.engineer.status.approved', 'Approved');
    case 'Rejected': return t('hub.engineer.status.returned', 'Returned');
    default: return '—';
  }
}

export function EngineerRecentEntriesPanel({
  entries,
  statusBySheet,
  loading,
  error,
  onRetry,
  onOpenTimesheets,
}: PanelState & {
  entries: FlatEntry[];
  statusBySheet: Map<string, string>;
  onOpenTimesheets: () => void;
}) {
  const { t } = useTranslation('dashboard');
  const columns: Column<FlatEntry>[] = [
    {
      key: 'day',
      header: t('hub.engineer.day', 'Day'),
      kind: 'date',
      cell: (entry) => formatDateOnly(entry.entry_date),
    },
    {
      key: 'project',
      header: t('hub.engineer.projectAndDescription', 'Project and description'),
      cell: (entry) => (
        <span className="block min-w-0">
          <span
            className="block truncate font-medium"
            title={entry.project?.name ? undefined : t('hub.engineer.projectUnavailableReason', 'The timesheet entry does not include its project name.')}
          >
            {entry.project?.name ?? '—'}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{entry.notes || '—'}</span>
        </span>
      ),
    },
    {
      key: 'hours',
      header: t('hub.engineer.hours', 'Hours'),
      kind: 'number',
      align: 'num',
      cell: (entry) => `${formatNumberExact(entry.hours)} ${t('hub.engineer.hourUnit', 'h')}`,
    },
    {
      key: 'status',
      header: t('hub.engineer.statusLabel', 'Status'),
      kind: 'status',
      cell: (entry) => {
        const status = statusBySheet.get(entry.sheetId);
        return status
          ? <StatusPill variant={workflowVariant(status)}>{statusLabel(status, t)}</StatusPill>
          : <span className="text-muted-foreground" title={t('hub.engineer.statusUnavailableReason', 'The timesheet status is unavailable.')}>—</span>;
      },
    },
  ];
  const tableState: 'loading' | 'error' | 'empty' | undefined = loading ? 'loading' : error ? 'error' : entries.length === 0 ? 'empty' : undefined;

  return (
    <AreaPanel
      title={t('hub.engineer.recentEntries', 'Recent entries')}
      openHref="/timesheets"
      openLabel={t('hub.engineer.openTimesheets', 'Open Timesheets')}
    >
      <DataTable
        rows={entries}
        columns={columns}
        rowKey={(entry) => entry.id}
        onActivate={onOpenTimesheets}
        rowLabel={(entry) => t('hub.engineer.openEntry', 'Open timesheet entry for {{project}}: {{description}}', {
          project: entry.project?.name ?? t('hub.engineer.projectUnavailable', 'project unavailable'),
          description: entry.notes?.trim() || formatDateOnly(entry.entry_date),
        })}
        accessibleName={t('hub.engineer.recentEntries', 'Recent entries')}
        embedded
        state={tableState}
        emptyTitle={t('hub.engineer.noRecentEntries', 'No recent time entries')}
        emptySub={t('hub.engineer.noRecentEntriesSub', 'Recorded hours will appear here.')}
        errorTitle={t('hub.engineer.timesheetsError', "Couldn't load your timesheets")}
        errorSub={t('hub.engineer.retrySub', 'Retry to check your latest time entries.')}
        onRetry={onRetry}
        tableId="components-dashboard-engineer-recent-entries"
      />
    </AreaPanel>
  );
}
