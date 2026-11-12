import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useHomeLayout } from '@/src/hooks/useHomeLayout';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { recentEntries } from '@/src/lib/timesheet-derive';
import { formatDay, formatNumberExact } from '@/src/lib/format';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { useNeedsYou } from './restructure/useNeedsYou';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { FigureHiddenLine, FigureScope } from '@/src/components/ui/FigureScope';
import { BarList, ChartCard, type BarRow } from './charts';
import {
  EngineerRecentEntriesPanel,
  EngineerReturnedCard,
  EngineerTasksCard,
  EngineerTimesheetCard,
} from './hub/engineer/EngineerAreaPanels';
import { DashboardWaitsOnYou, type WaitRow } from './DashParts';

const RECENT_ENTRIES_LIMIT = 5;

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, amount: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const result = new Date(year, month - 1, date);
  result.setDate(result.getDate() + amount);
  return isoDay(result);
}

function mondayOf(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const result = new Date(year, month - 1, date);
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return isoDay(result);
}

function activeTask(status: string): boolean {
  return !['Done', 'Complete', 'Completed', 'Cancelled'].includes(status);
}

export const EngineerDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const { currentUser } = useAuth();
  const overview = useHomeLayout().homeLayout === 'overview';
  const timesheets = useTimesheets();
  const tasks = useMyTasks();
  const claims = useExpenseClaims({ kind: 'claim' });
  const organizationDay = useFxOrgDay(true);
  const needs = useNeedsYou('Engineer');

  const weekStart = organizationDay.day ? mondayOf(organizationDay.day) : null;
  const weekEnd = weekStart ? addDays(weekStart, 6) : null;
  const weekDates = useMemo(
    () => (weekStart ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)) : []),
    [weekStart],
  );
  const currentSheet = useMemo(
    () => (weekStart ? (timesheets.data ?? []).find((sheet) => sheet.week_start_date === weekStart) ?? null : null),
    [timesheets.data, weekStart],
  );
  const currentEntries = useMemo(
    () => (currentSheet?.entries ?? []).filter((entry) => weekStart != null && weekEnd != null && entry.entry_date >= weekStart && entry.entry_date <= weekEnd),
    [currentSheet, weekEnd, weekStart],
  );
  const hoursThisWeek = useMemo(
    () => currentEntries.reduce((sum, entry) => sum + (entry.hours || 0), 0),
    [currentEntries],
  );

  const dayLabels = useMemo(() => [
    t('hub.engineer.days.mon', 'Mon'), t('hub.engineer.days.tue', 'Tue'),
    t('hub.engineer.days.wed', 'Wed'), t('hub.engineer.days.thu', 'Thu'),
    t('hub.engineer.days.fri', 'Fri'), t('hub.engineer.days.sat', 'Sat'),
    t('hub.engineer.days.sun', 'Sun'),
  ], [t]);
  const hoursByDay = useMemo(() => weekDates.map((date, index) => ({
    date,
    label: dayLabels[index],
    hours: currentEntries.reduce((sum, entry) => sum + (entry.entry_date === date ? entry.hours || 0 : 0), 0),
  })), [currentEntries, dayLabels, weekDates]);

  const dueTasks = useMemo(() => (tasks.data ?? []).filter((task) => (
    activeTask(task.status) && task.end_date != null && organizationDay.day != null && weekEnd != null
    && task.end_date >= organizationDay.day && task.end_date <= weekEnd
  )), [organizationDay.day, tasks.data, weekEnd]);
  const overdueTasks = useMemo(() => (tasks.data ?? []).filter((task) => (
    activeTask(task.status) && task.end_date != null && organizationDay.day != null
    && task.end_date < organizationDay.day
  )), [organizationDay.day, tasks.data]);

  const returnedClaims = useMemo(() => (claims.data?.rows ?? []).filter((claim) => (
    claim.kind === 'claim' && claim.claimant_id === currentUser?.id && claim.status === 'Rejected'
  )), [claims.data?.rows, currentUser?.id]);
  const recent = useMemo(
    () => organizationDay.day
      ? recentEntries(
        (timesheets.data ?? []).map((sheet) => ({
          ...sheet,
          entries: sheet.entries.filter((entry) => entry.entry_date <= organizationDay.day!),
        })),
        RECENT_ENTRIES_LIMIT,
      )
      : [],
    [organizationDay.day, timesheets.data],
  );
  const statusBySheet = useMemo(
    () => new Map((timesheets.data ?? []).map((sheet) => [sheet.id, sheet.status])),
    [timesheets.data],
  );

  const refresh = () => {
    void timesheets.refetch();
    void tasks.refetch();
    void claims.refetch();
    organizationDay.retry();
    void needs.refetch();
  };
  const timeLoading = timesheets.isPending || organizationDay.isPending;
  const timeError = timesheets.isError || organizationDay.isError
    || (timesheets.data === undefined && !timesheets.isPending);
  const taskLoading = tasks.isPending || organizationDay.isPending;
  const taskError = tasks.isError || organizationDay.isError
    || (tasks.data === undefined && !tasks.isPending);
  const taskReadError = tasks.isError || (tasks.data === undefined && !tasks.isPending);
  const claimsError = claims.isError || !currentUser?.id
    || (claims.data === undefined && !claims.isPending);
  const taskDataError = taskError || (!organizationDay.day && !organizationDay.isPending);
  const recentError = timeError || (!organizationDay.day && !organizationDay.isPending);
  const currentStatus = currentSheet?.status ?? null;

  // Hours by project this week: every project, with its code; an entry whose project cannot be read is named so.
  const projectRows = useMemo<BarRow[]>(() => {
    const unavailable = t('hub.engineer.projectUnavailable', 'project unavailable');
    const byProject = new Map<string, BarRow & { value: number }>();
    for (const entry of currentEntries) {
      const key = entry.project ? entry.project_id ?? entry.project.name : '__unavailable';
      const name = entry.project ? [entry.project.code, entry.project.name].filter(Boolean).join(' · ') : unavailable;
      const row = byProject.get(key) ?? { id: key, name, value: 0 };
      row.value += entry.hours || 0;
      byProject.set(key, row);
    }
    return [...byProject.values()].filter((row) => row.value > 0).sort((x, y) => y.value - x.value)
      .map((row) => ({ ...row, label: `${formatNumberExact(row.value)} ${t('hub.engineer.hourUnit', 'h')}` }));
  }, [currentEntries, t]);

  // Waits on you: the timesheet and returned claims from the needs read; own task rows come from the waits card itself.
  const waitRows: WaitRow[] = needs.items
    .filter((item) => ['timesheet-not-submitted', 'timesheet-returned', 'returned-expenses'].includes(item.id))
    .map((item) => ({ id: item.id, count: item.countLabel ?? item.count, label: item.label, href: item.href, tone: item.tone }));
  const timesheetClear = !needs.isPending && !needs.isError
    && !needs.items.some((item) => item.id === 'timesheet-not-submitted' || item.id === 'timesheet-returned');

  const weekKnown = timesheets.data !== undefined && weekStart != null;
  const hourUnit = t('hub.engineer.hourUnit', 'h');
  const band = (
    <KPIRow aria-label={t('hub.engineer.kpiBand', 'Your week')} className="grid-cols-2 min-[1280px]:grid-cols-4">
      <KPITile
        testId="kpi-hours-week" tone="blue" icon="clock"
        label={t('hub.engineer.hoursThisWeek', 'Hours this week')}
        value={weekKnown ? `${formatNumberExact(hoursThisWeek)} ${hourUnit}` : null}
        loading={timeLoading} error={timeError}
        caption={weekStart ? t('hub.engineer.expectedWeek', 'Week of {{date}}', { date: formatDay(weekStart) }) : undefined}
        to="/timesheets" linkLabel={t('hub.engineer.openHours', 'Open timesheets for this week')}
      />
      <KPITile
        testId="kpi-timesheet-status" tone="violet" icon="doc"
        label={t('hub.engineer.timesheetStatus', 'Timesheet status')}
        value={!weekKnown ? null : currentStatus ? <StatusPill record="timesheet" state={currentStatus} /> : t('hub.engineer.notStarted', 'Not started')}
        loading={timeLoading} error={timeError}
        caption={weekStart ? t('hub.engineer.dueDay', 'Due {{day}} · {{date}}', { day: dayLabels[4], date: formatDay(addDays(weekStart, 4)) }) : undefined}
        to="/timesheets" linkLabel={t('hub.engineer.openStatus', 'Open timesheet status')}
        help={t('hub.engineer.statusHelp', 'Status comes from this week’s timesheet. If none exists yet, it is marked Not started. Timesheets are due Friday.')}
      />
      <KPITile
        testId="kpi-tasks-due" tone="amber" icon="tasks"
        label={t('hub.engineer.tasksOverdueOrDue', 'Overdue or due this week')}
        value={taskDataError || taskLoading ? null : String(overdueTasks.length + dueTasks.length)}
        loading={taskLoading} error={taskDataError}
        caption={taskDataError || taskLoading ? undefined : t('hub.engineer.tasksSummary', '{{overdue}} overdue · {{due}} due this week', { overdue: overdueTasks.length, due: dueTasks.length })}
        to="/my-tasks?due=week" linkLabel={t('hub.engineer.openTasks', 'Open tasks due this week')}
      />
      <KPITile
        testId="kpi-expenses-returned" tone="red" icon="expenses"
        label={t('hub.engineer.expensesReturned', 'Expense claims returned')}
        value={claimsError || claims.isPending ? null : String(returnedClaims.length)}
        loading={claims.isPending} error={claimsError}
        to="/expenses?status=Rejected" linkLabel={t('hub.engineer.openReturnedClaims', 'Open returned expense claims')}
      />
    </KPIRow>
  );
  const hoursTitle = t('hub.engineer.byProject', 'This week by project');
  const projectHours = (
    <ChartCard title={hoursTitle} known={projectRows.length > 0} hiddenReason={t('home.eng.reasonNoHours', 'no time is logged this week')} pending={timeLoading} error={timeError ? { title: t('hub.engineer.timesheetsError', "Couldn't load your timesheets"), retry: refresh } : undefined} testId="chart-hours-by-project">
      <BarList ariaLabel={hoursTitle} rows={projectRows} />
    </ChartCard>
  );

  const header = (
    <PageHeader
      className="mb-0"
      title={t('hub.engineer.title', 'My dashboard')}
      action={<Button variant="outline" size="sm" onClick={refresh} aria-label={t('hub.engineer.refresh', 'Refresh')}><Icon name="refresh" /><span className="hidden sm:inline">{t('hub.engineer.refresh', 'Refresh')}</span></Button>}
    />
  );
  const waitsEl = <DashboardWaitsOnYou plain className="min-w-0 min-[900px]:col-span-4" rows={waitRows} pending={needs.isPending} error={needs.isError || (taskReadError && waitRows.length === 0)} onRetry={refresh} />;
  const recentEl = (
    <EngineerRecentEntriesPanel
      entries={recent}
      statusBySheet={statusBySheet}
      loading={timeLoading}
      error={recentError}
      onRetry={refresh}
    />
  );

  const timesheetCard = (chart: boolean) => (
    <EngineerTimesheetCard loading={timeLoading} error={timeError} onRetry={refresh} status={currentStatus} days={hoursByDay} hours={hoursThisWeek} clear={timesheetClear} chart={chart} />
  );
  const tasksCard = <EngineerTasksCard overdue={overdueTasks} dueThisWeek={dueTasks} today={organizationDay.day} loading={taskLoading} error={taskDataError || tasks.isError} onRetry={refresh} />;
  const returnedEl = !claimsError && <EngineerReturnedCard claims={returnedClaims} />;
  const twoUp = 'grid gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2 min-[900px]:items-start';

  return (
    <FigureScope>
      <div className="space-y-[var(--space-panel-gap)]" data-home-layout={overview ? 'overview' : 'focused'}>
        <div>{header}<FigureHiddenLine compact /></div>
        {band}
        {/* Own work first: what waits (a third) beside my tasks, then the week, then what was returned. */}
        <div className="grid gap-[var(--space-panel-gap)] min-[900px]:grid-cols-12 min-[900px]:items-start">
          {waitsEl}
          <div className="min-w-0 min-[900px]:col-span-8">{tasksCard}</div>
        </div>
        <div className={twoUp}>
          {timesheetCard(overview)}
          {projectHours}
        </div>
        <div className="grid gap-[var(--space-panel-gap)] min-[900px]:grid-cols-12 min-[900px]:items-start">
          {returnedEl && <div className="min-w-0 min-[900px]:col-span-4">{returnedEl}</div>}
          <div className={returnedEl ? 'min-w-0 min-[900px]:col-span-8' : 'min-w-0 min-[900px]:col-span-12'}>{recentEl}</div>
        </div>
      </div>
    </FigureScope>
  );
};
