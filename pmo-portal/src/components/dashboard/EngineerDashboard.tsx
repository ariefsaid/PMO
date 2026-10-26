import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useTimesheets } from '@/src/hooks/useTimesheets';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { HoursBar } from '@/src/components/ui/HoursBar';
import { entriesByProject, recentEntries } from '@/src/lib/timesheet-derive';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { formatFullDate, formatNumberExact } from '@/src/lib/format';
import { DashPageHead } from './layout';

const RECENT_ENTRIES_LIMIT = 8;

function getWeekStartDate(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const EngineerDashboard: React.FC = () => {
  const { t } = useTranslation();
  const { data: sheets, isPending, isError, refetch } = useTimesheets();
  const weekStartDate = getWeekStartDate(new Date());
  const weekStart = formatDateKey(weekStartDate);
  const weekDates = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStartDate);
    date.setDate(date.getDate() + index);
    return date;
  });
  const weekScope = t('dashboard:engineer.calendarWeek', 'Calendar week of {{date}}', {
    date: formatFullDate(weekStartDate),
  });
  const dayLabels = [
    t('dashboard:engineer.day.mon', 'Mon'), t('dashboard:engineer.day.tue', 'Tue'),
    t('dashboard:engineer.day.wed', 'Wed'), t('dashboard:engineer.day.thu', 'Thu'),
    t('dashboard:engineer.day.fri', 'Fri'), t('dashboard:engineer.day.sat', 'Sat'),
    t('dashboard:engineer.day.sun', 'Sun'),
  ];
  const statusLabels: Record<string, string> = {
    Draft: t('timesheets.status.Draft', 'Draft'),
    Submitted: t('timesheets.status.Submitted', 'Submitted'),
    Approved: t('timesheets.status.Approved', 'Approved'),
    Rejected: t('timesheets.status.Rejected', 'Rejected'),
  };

  // Only an exact calendar-week match is current. A newest historical sheet is never relabeled.
  const current = useMemo(
    () => (sheets ?? []).find((sheet) => sheet.week_start_date === weekStart),
    [sheets, weekStart],
  );
  const hoursThisWeek = useMemo(
    () => (current?.entries ?? []).reduce((sum, entry) => sum + (entry.hours || 0), 0),
    [current],
  );
  const byDay = useMemo(() => {
    const totals = new Array(7).fill(0) as number[];
    for (const entry of current?.entries ?? []) {
      const day = new Date(`${entry.entry_date}T00:00:00`).getDay();
      const mondayIndex = (day + 6) % 7;
      totals[mondayIndex] += entry.hours || 0;
    }
    return totals;
  }, [current]);
  const maxDay = Math.max(1, ...byDay);
  const byProject = useMemo(
    () => entriesByProject(current?.entries ?? []),
    [current],
  );
  const flatRecent = useMemo(
    () => recentEntries(sheets ?? [], RECENT_ENTRIES_LIMIT),
    [sheets],
  );
  const hasCurrentWeekEntries = (current?.entries.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('dashboard:engineer.title', 'My Dashboard')}
        sub={t('dashboard:engineer.scope', 'Review and log your hours.')}
      />

      <Card aria-labelledby="engineer-week-summary-title" data-testid="engineer-week-summary" aria-busy={isPending}>
        <CardHead className="text-xl font-bold">
          <span id="engineer-week-summary-title">
            {t('dashboard:engineer.weekSummaryCompact', 'This week · {{hours}} hours', {
              hours: isPending || isError ? '—' : formatNumberExact(hoursThisWeek),
            })}
          </span>
        </CardHead>
        <div className="grid min-w-0 gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1.25fr)_minmax(8rem,0.75fr)]">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">{t('dashboard:engineer.calendarWeekLabel', 'Calendar week')}</p>
            <p data-testid="engineer-week-scope" data-week-start={weekStart} className="mt-1 break-words text-sm">{weekScope}</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">{t('dashboard:engineer.timesheetStatus', 'Timesheet status')}</p>
            <div data-testid="engineer-timesheet-status" className="mt-1 min-h-7">
              {isPending || isError ? (
                <span role="img" aria-label={isError ? t('dashboard:engineer.statusUnavailable', 'Timesheet status unavailable') : t('dashboard:loading', 'Loading')} className="text-muted-foreground">—</span>
              ) : current ? (
                <StatusPill variant={workflowVariant(current.status)}>{statusLabels[current.status] ?? current.status}</StatusPill>
              ) : (
                <span className="text-sm text-muted-foreground">{t('dashboard:engineer.noTimesheetThisWeek', 'No timesheet this week')}</span>
              )}
            </div>
          </div>
          <span data-testid="engineer-hours-total" role="img" className="sr-only" aria-label={isError ? t('dashboard:engineer.hoursUnavailable', 'Hours unavailable') : t('dashboard:engineer.weekHoursAria', 'This week: {{hours}} hours', { hours: formatNumberExact(hoursThisWeek) })}>
            {isPending || isError ? '—' : formatNumberExact(hoursThisWeek)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border/70 px-4 py-3">
          <Link
            to="/timesheets"
            data-testid="engineer-log-hours"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t('dashboard:engineer.logHours', "Log this week's hours")}
          </Link>
          {!isPending && !isError && (current?.entries.length ?? 0) === 0 && (
            <p data-testid="engineer-empty-week-note" className="text-sm text-muted-foreground">
              {t('dashboard:engineer.emptyWeekNote', 'No hours are recorded for this calendar week yet.')}
            </p>
          )}
          {isError && (
            <div role="alert" className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">{t('dashboard:engineer.loadError', "Couldn't load your timesheets")}</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-xs font-semibold hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t('dashboard:retry', 'Retry')}
              </button>
            </div>
          )}
          {isPending && <ListState variant="loading" />}
        </div>
      </Card>

      {!isError && (isPending || hasCurrentWeekEntries) && <Card>
        <CardHead className="text-xl font-bold">{t('dashboard:engineer.weeklyHoursCardTitle', 'Hours this week by day')}</CardHead>
        {isPending ? (
          <div className="px-4 pb-4"><ListState variant="loading" rows={4} /></div>
        ) : isError ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t('dashboard:engineer.hoursUnavailable', 'Hours unavailable')}</p>
        ) : (
          <div role="group" aria-label={t('dashboard:engineer.hoursByDay', 'Hours this week by day')} className="flex flex-col px-4 pb-4">
            {byDay.map((hours, index) => {
              const value = formatNumberExact(hours);
              return (
                <div key={formatDateKey(weekDates[index]!)} className="grid min-h-11 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem] items-center gap-3 border-t border-border/70 first:border-t-0">
                  <span className="text-xs font-semibold text-muted-foreground">{dayLabels[index]}</span>
                  <span
                    role="progressbar"
                    aria-label={t('dashboard:engineer.dayHours', '{{day}}: {{hours}} hours', { day: dayLabels[index], hours: value })}
                    aria-valuenow={hours}
                    aria-valuemin={0}
                    aria-valuemax={maxDay}
                    className="h-2 min-w-0 overflow-hidden rounded-full bg-secondary"
                  >
                    <span aria-hidden="true" className="block h-full rounded-full bg-muted-foreground" style={{ width: `${Math.min(100, (hours / maxDay) * 100)}%` }} />
                  </span>
                  <span className="text-right text-sm tabular">{value}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>}

      {!isError && (isPending || hasCurrentWeekEntries) && <Card>
        <CardHead className="text-xl font-bold">{t('dashboard:engineer.byProject', "This week's hours by project")}</CardHead>
        {isPending ? (
          <div className="px-4 pb-4"><ListState variant="loading" rows={3} /></div>
        ) : isError ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t('dashboard:engineer.hoursUnavailable', 'Hours unavailable')}</p>
        ) : byProject.length > 0 ? (
          <div role="group" aria-label={t('dashboard:engineer.byProject', 'This week by project')} className="flex flex-col px-4 pb-4">
            {byProject.map((row) => (
              <HoursBar key={row.projectId} label={row.name} code={row.code} hours={row.hours} maxHours={hoursThisWeek} showUnitSuffix={false} />
            ))}
          </div>
        ) : null}
      </Card>}

      {!isError && <Card>
        <CardHead className="text-xl font-bold">{t('dashboard:engineer.recentEntriesHead', 'Recent entries · hours')}</CardHead>
        {isPending ? (
          <div className="px-4 pb-4"><ListState variant="loading" rows={4} /></div>
        ) : flatRecent.length === 0 ? (
          <p className="sr-only">{t('dashboard:engineer.noRecentEntries', 'No recent entries')}</p>
        ) : (
          <ul aria-label={t('dashboard:engineer.recentEntries', 'Recent entries')} className="divide-y divide-border/70">
            {flatRecent.map((entry) => (
              <li key={entry.id} data-testid={`engineer-recent-row-${entry.id}`} className="grid min-h-16 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="break-words text-sm">{entry.project?.name ?? t('dashboard:engineer.unknownProject', 'Unknown')}</span>
                    {entry.project?.code && <span className="font-mono text-[0.6875rem] font-semibold text-muted-foreground">{entry.project.code}</span>}
                    <span className="text-[0.6875rem] font-semibold text-muted-foreground">{formatFullDate(new Date(`${entry.entry_date}T00:00:00`))}</span>
                  </div>
                  <p className="break-words text-sm text-muted-foreground">{entry.notes?.trim() || t('dashboard:engineer.noNote', 'No note')}</p>
                </div>
                <span className="text-right text-sm tabular">{formatNumberExact(entry.hours)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>}
    </div>
  );
};
