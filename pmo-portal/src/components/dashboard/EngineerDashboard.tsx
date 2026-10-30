import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { entriesByProject, recentEntries } from '@/src/lib/timesheet-derive';
import { formatDateOnly, formatNumberExact } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { KPIRow, KPITile } from '@/src/components/ui/KPITile';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { HubGrid } from './hub/HubGrid';
import { useNeedsYou } from './restructure/useNeedsYou';
import { DashPageHead } from './layout';
import {
  EngineerExpensesPanel,
  EngineerProjectHoursPanel,
  EngineerRecentEntriesPanel,
  EngineerTasksPanel,
  EngineerTimePanel,
} from './hub/engineer/EngineerAreaPanels';

const RECENT_ENTRIES_LIMIT = 8;

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
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const timesheets = useTimesheets();
  const tasks = useMyTasks();
  const claims = useExpenseClaims({ kind: 'claim' });
  const organizationDay = useFxOrgDay(true);
  const needsYou = useNeedsYou('Engineer');

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
  const dayScale = Math.max(1, ...hoursByDay.map((day) => day.hours));

  const dueTasks = useMemo(() => (tasks.data ?? []).filter((task) => (
    activeTask(task.status) && task.end_date != null && organizationDay.day != null && weekEnd != null
    && task.end_date >= organizationDay.day && task.end_date <= weekEnd
  )), [organizationDay.day, tasks.data, weekEnd]);
  const overdueTasks = useMemo(() => (tasks.data ?? []).filter((task) => (
    activeTask(task.status) && task.end_date != null && organizationDay.day != null
    && task.end_date < organizationDay.day
  )), [organizationDay.day, tasks.data]);
  const taskCount = overdueTasks.length + dueTasks.length;

  const returnedClaims = useMemo(() => (claims.data?.rows ?? []).filter((claim) => (
    claim.kind === 'claim' && claim.claimant_id === currentUser?.id && claim.status === 'Rejected'
  )), [claims.data?.rows, currentUser?.id]);
  const byProject = useMemo(() => entriesByProject(currentEntries), [currentEntries]);
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
    void needsYou.refetch();
  };
  const timeLoading = timesheets.isPending || organizationDay.isPending;
  const timeError = timesheets.isError || organizationDay.isError
    || (timesheets.data === undefined && !timesheets.isPending);
  const taskLoading = tasks.isPending || organizationDay.isPending;
  const taskError = tasks.isError || organizationDay.isError
    || (tasks.data === undefined && !tasks.isPending);
  const claimsError = claims.isError || !currentUser?.id
    || (claims.data === undefined && !claims.isPending);
  const taskDataError = taskError || (!organizationDay.day && !organizationDay.isPending);
  const recentError = timeError || (!organizationDay.day && !organizationDay.isPending);
  const currentStatus = currentSheet?.status ?? null;
  const noCurrentSheet = timesheets.data !== undefined && currentSheet === null;
  const statusLabel = currentStatus === 'Rejected'
    ? t('hub.engineer.status.returned', 'Returned')
    : currentStatus === 'Draft'
      ? t('hub.engineer.status.draft', 'Draft')
      : currentStatus === 'Submitted'
        ? t('hub.engineer.status.submitted', 'Submitted')
        : currentStatus === 'Approved'
          ? t('hub.engineer.status.approved', 'Approved')
          : noCurrentSheet
            ? t('hub.engineer.notStarted', 'Not started')
            : null;
  const expectedWeekLabel = weekStart ? t('hub.engineer.expectedWeek', 'Week of {{date}}', {
    date: formatDateOnly(weekStart),
  }) : undefined;
  const timesheetDueLabel = weekStart ? t('hub.engineer.dueDay', 'Due {{day}} · {{date}}', {
    day: dayLabels[4],
    date: formatDateOnly(addDays(weekStart, 4)),
  }) : undefined;
  const weekAttention = needsYou.items.filter((item) => item.id === 'timesheet-not-submitted' || item.id === 'timesheet-returned');
  const expenseAttention = needsYou.items.filter((item) => item.id === 'returned-expenses');

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('hub.engineer.title', 'My dashboard')}
        sub={t('hub.engineer.subtitle', 'Your week and what needs you')}
        actions={(
          <Button variant="outline" onClick={refresh}>
            <Icon name="refresh" className="mr-1.5 size-4" />
            {t('hub.engineer.refresh', 'Refresh')}
          </Button>
        )}
      />

      <KPIRow
        aria-label={t('hub.engineer.kpiBand', 'Your week')}
        className="grid-cols-2 min-[1180px]:grid-cols-4"
      >
        <KPITile
          testId="kpi-hours-week"
          tone="blue"
          icon="clock"
          label={t('hub.engineer.hoursThisWeek', 'Hours this week')}
          value={timesheets.data !== undefined && weekStart
            ? `${formatNumberExact(hoursThisWeek)} ${t('hub.engineer.hourUnit', 'h')}`
            : '—'}
          loading={timeLoading}
          error={timesheets.isError || organizationDay.isError}
          vs={expectedWeekLabel}
          to="/timesheets"
          linkLabel={t('hub.engineer.openHours', 'Open timesheets for this week')}
          help={t('hub.engineer.hoursHelp', 'Hours are the sum of your current week’s timesheet entries. Expected weekly hours are not provided by the timesheet data. If timesheet data is unavailable, the value is shown as —.')}
        />
        <KPITile
          testId="kpi-timesheet-status"
          tone="violet"
          icon="doc"
          label={t('hub.engineer.timesheetStatus', 'Timesheet status')}
          value={timesheets.data === undefined || !weekStart
            ? '—'
            : statusLabel
              ? <StatusPill variant={currentStatus ? workflowVariant(currentStatus) : 'neutral'}>{statusLabel}</StatusPill>
              : '—'}
          loading={timeLoading}
          error={timesheets.isError || organizationDay.isError}
          vs={timesheetDueLabel}
          to="/timesheets"
          linkLabel={t('hub.engineer.openStatus', 'Open timesheet status')}
          help={t('hub.engineer.statusHelp', 'Status comes from this week’s timesheet. If no timesheet exists for this week, status is unavailable. A due date is not available in the timesheet data.')}
        />
        <KPITile
          testId="kpi-tasks-due"
          tone="amber"
          icon="tasks"
          label={t('hub.engineer.tasksDue', 'Tasks due')}
          value={tasks.data !== undefined && organizationDay.day ? taskCount : '—'}
          loading={taskLoading}
          error={tasks.isError || organizationDay.isError}
          vs={tasks.data !== undefined && !taskDataError
            ? t('hub.engineer.tasksSummary', '{{overdue}} overdue · {{due}} due this week', {
              overdue: overdueTasks.length,
              due: dueTasks.length,
            })
            : undefined}
          to="/my-tasks"
          linkLabel={t('hub.engineer.openTasks', 'Open tasks due this week')}
          help={t('hub.engineer.tasksHelp', 'Counts your open assigned tasks due before today or between today and Sunday of this week. If task data is unavailable, the value is shown as —.')}
        />
        <KPITile
          testId="kpi-expenses-returned"
          tone="red"
          icon="expenses"
          label={t('hub.engineer.expensesReturned', 'Expense claims returned')}
          value={claims.data !== undefined && currentUser?.id ? returnedClaims.length : '—'}
          loading={claims.isPending}
          error={claims.isError}
          to="/expenses"
          linkLabel={t('hub.engineer.openReturnedClaims', 'Open returned expense claims')}
          help={t('hub.engineer.expensesHelp', 'Counts your own expense claims with Rejected status, shown as returned. If claim data is unavailable, the value is shown as —.')}
        />
      </KPIRow>

      <HubGrid>
        <EngineerTimePanel
          attention={weekAttention}
          loading={timeLoading}
          error={timeError}
          onRetry={refresh}
          days={hoursByDay}
          maxDay={dayScale}
          hasHours={hoursThisWeek > 0}
        />
        <EngineerTasksPanel
          overdue={overdueTasks}
          dueThisWeek={dueTasks}
          today={organizationDay.day}
          loading={taskLoading}
          error={taskDataError || tasks.isError}
          onRetry={refresh}
        />
        <EngineerExpensesPanel
          attention={expenseAttention}
          claims={returnedClaims}
          loading={claims.isPending}
          error={claimsError}
          onRetry={refresh}
        />
        <EngineerProjectHoursPanel
          projects={byProject}
          loading={timeLoading}
          error={timeError}
          onRetry={refresh}
          totalHours={hoursThisWeek}
        />
      </HubGrid>

      <EngineerRecentEntriesPanel
        entries={recent}
        statusBySheet={statusBySheet}
        loading={timeLoading}
        error={recentError}
        onRetry={refresh}
        onOpenTimesheets={() => navigate('/timesheets')}
      />
    </div>
  );
};
