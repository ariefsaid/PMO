import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseClaims } from '@/src/hooks/useExpenseClaims';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { useMyTasks } from '@/src/hooks/useMyTasks';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { recentEntries } from '@/src/lib/timesheet-derive';
import { Button } from '@/src/components/ui/Button';
import { Icon } from '@/src/components/ui/icons';
import { PageHeader } from '@/src/components/ui/PageHeader';
import {
  EngineerRecentEntriesPanel,
  EngineerReturnedCard,
  EngineerTasksCard,
  EngineerTimesheetCard,
} from './hub/engineer/EngineerAreaPanels';

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
  const timesheets = useTimesheets();
  const tasks = useMyTasks();
  const claims = useExpenseClaims({ kind: 'claim' });
  const organizationDay = useFxOrgDay(true);

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

  return (
    <div className="space-y-[var(--space-panel-gap)]">
      <PageHeader
        className="mb-0"
        title={t('hub.engineer.title', 'My dashboard')}
        action={<Button variant="outline" size="sm" onClick={refresh} aria-label={t('hub.engineer.refresh', 'Refresh')}><Icon name="refresh" /><span className="hidden sm:inline">{t('hub.engineer.refresh', 'Refresh')}</span></Button>}
      />
      <div className="grid gap-[var(--space-panel-gap)] min-[900px]:grid-cols-2 min-[900px]:items-start">
        <EngineerTimesheetCard loading={timeLoading} error={timeError} onRetry={refresh} status={currentStatus} days={hoursByDay} hours={hoursThisWeek} />
        <EngineerTasksCard overdue={overdueTasks} dueThisWeek={dueTasks} today={organizationDay.day} loading={taskLoading} error={taskDataError || tasks.isError} onRetry={refresh} />
      </div>
      {!claimsError && <EngineerReturnedCard claims={returnedClaims} />}
      <EngineerRecentEntriesPanel
        entries={recent}
        statusBySheet={statusBySheet}
        loading={timeLoading}
        error={recentError}
        onRetry={refresh}
      />
    </div>
  );
};
