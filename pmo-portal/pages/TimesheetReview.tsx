import React, { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import {
  AccessDenied,
  Button,
  Card,
  DataTable,
  DateField,
  Drawer,
  ListPage,
  ListState,
  SelectField,
  StatusPill,
  TimesheetGrid,
  parsePageParam,
  useClampPage,
  useUrlFilters,
  type Column,
} from '@/src/components/ui';
import { buttonClasses } from '@/src/components/ui/buttonClasses';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useTimesheetsForReview } from '@/src/hooks/useTimesheets';
import type { TimesheetForReview } from '@/src/lib/db/timesheets';
import { formatDay, formatNumberMax2 } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { datesInWeek, entriesToGridRows, gridDaysForWeek } from './timesheets/timesheetWeekModel';

const REVIEW_PAGE_SIZE = 25;

function shiftIsoDays(iso: string, delta: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function localDayFromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * `/timesheets/review` (1124d-rolescreens, FR-HTR-001..005): read-only organisation timesheet review list
 * for the HR Officer job role (and Admin). Filters by period (`from`/`to`), project, and person.
 * Deliberately renders NO approve, return, reject, or reopen controls (`transition_timesheet` refuses HR Officer).
 */
const TimesheetReviewPage: React.FC = () => {
  const { t } = useTranslation(['common', 'timesheets']);
  const navigate = useNavigate();
  const may = usePermission();
  const canReview = may('review', 'timesheet');

  const { values, setFilters, clear: clearFilters } = useUrlFilters(['from', 'to', 'project', 'person', 'page']);
  const from = values.from;
  const to = values.to;
  const projectId = values.project;
  const personId = values.person;
  const hasActiveFilters = Boolean(from || to || projectId || personId);

  const page = parsePageParam(values.page);
  const setPage = useCallback(
    (next: number, options?: { replace?: boolean }) =>
      setFilters({ page: next > 1 ? String(next) : '' }, options),
    [setFilters],
  );

  const query = useTimesheetsForReview(undefined, canReview);
  const projectsQuery = useProjectPickerOptions();
  const [openId, setOpenId] = useState<string | null>(null);

  const allSheets = useMemo(() => query.data ?? [], [query.data]);

  const personOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const s of allSheets) {
      const label = s.owner?.full_name ?? s.user_id;
      if (!byId.has(s.user_id)) byId.set(s.user_id, label);
    }
    const sorted = [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    return [
      { value: '', label: t('timesheets:review.allPeople', 'All people') },
      ...sorted.map(([value, label]) => ({ value, label })),
    ];
  }, [allSheets, t]);

  const projectOptions = useMemo(() => {
    const projects = projectsQuery.data ?? [];
    return [
      { value: '', label: t('timesheets:review.allProjects', 'All projects') },
      ...projects.map((p) => ({ value: p.id, label: projectDisplayName(p) })),
    ];
  }, [projectsQuery.data, t]);

  const filtered = useMemo(() => {
    return allSheets.filter((sheet) => {
      if (personId && sheet.user_id !== personId) return false;
      const weekEnd = shiftIsoDays(sheet.week_start_date, 6);
      if (from && weekEnd < from) return false;
      if (to && sheet.week_start_date > to) return false;
      if (projectId && !sheet.entries.some((e) => e.project_id === projectId)) return false;
      return true;
    });
  }, [allSheets, personId, from, to, projectId]);

  useClampPage(page, filtered.length, REVIEW_PAGE_SIZE, setPage);

  const startIndex = (page - 1) * REVIEW_PAGE_SIZE;
  const pagedRows = useMemo(
    () => filtered.slice(startIndex, startIndex + REVIEW_PAGE_SIZE),
    [filtered, startIndex],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / REVIEW_PAGE_SIZE));

  if (!canReview) {
    return (
      <AccessDenied
        title={t('timesheets:review.deniedTitle', "You don't have access to timesheet review")}
        sub={t('timesheets:review.deniedSub', 'Timesheet review is available to the HR Officer and Admin.')}
        onBack={() => navigate('/timesheets')}
      />
    );
  }

  return (
    <ListPage
      title={t('timesheets:review.title', 'Timesheet review')}
      count={query.isPending ? undefined : filtered.length}
      total={hasActiveFilters && !query.isPending ? allSheets.length : undefined}
      primaryAction={
        <Link to="/timesheets" className={buttonClasses('outline')}>
          {t('uxs28.nav.myTime', 'My time')}
        </Link>
      }
      filters={
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <DateField
            id="ts-review-from"
            compact
            label={t('timesheets:review.from', 'From')}
            value={from}
            max={to || undefined}
            onChange={(next) => setFilters({ from: next, page: '' })}
            className="w-full sm:w-40"
          />
          <DateField
            id="ts-review-to"
            compact
            label={t('timesheets:review.to', 'To')}
            value={to}
            min={from || undefined}
            onChange={(next) => setFilters({ to: next, page: '' })}
            className="w-full sm:w-40"
          />
          <SelectField
            id="ts-review-project"
            compact
            label={t('timesheets:review.project', 'Project')}
            value={projectId}
            onChange={(next) => setFilters({ project: next, page: '' })}
            options={projectOptions}
            wrapperClassName="w-full sm:w-48"
            fullWidth
          />
          <SelectField
            id="ts-review-person"
            compact
            label={t('timesheets:review.person', 'Person')}
            value={personId}
            onChange={(next) => setFilters({ person: next, page: '' })}
            options={personOptions}
            wrapperClassName="w-full sm:w-48"
            fullWidth
          />
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              {t('timesheets:review.clearFilters', 'Clear filters')}
            </Button>
          )}
        </div>
      }
    >
      {query.isPending ? (
        <ListState variant="loading" shape="table" columns={5} rows={5} />
      ) : query.isError ? (
        <ListState
          variant="error"
          title={t('timesheets:review.errorTitle', "Couldn't load timesheets")}
          sub={t('timesheets:review.errorSub', 'Check your connection and try again.')}
          onRetry={() => void query.refetch()}
        />
      ) : filtered.length === 0 ? (
        <Card clip>
          <ListState
            variant="empty"
            icon="clock"
            title={
              hasActiveFilters
                ? t('timesheets:review.filteredEmpty', 'No timesheets match these filters')
                : t('timesheets:review.empty', 'No timesheets recorded yet')
            }
            sub={
              hasActiveFilters ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary-text underline underline-offset-2"
                  onClick={clearFilters}
                >
                  {t('timesheets:review.clearFilters', 'Clear filters')}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <div className="space-y-3">
          <Card clip data-testid="timesheet-review-list">
            <ReviewTable rows={pagedRows} projectFilterId={projectId} openId={openId} onOpen={setOpenId} />
          </Card>
          {pageCount > 1 && (
            <nav
              className="flex flex-wrap items-center justify-between gap-2 text-control text-muted-foreground"
              aria-label={t('timesheets:review.pagination', 'Timesheet pages')}
            >
              <span>
                {t('timesheets:review.showingRange', 'Showing {{from}}–{{to}} of {{total}}', {
                  from: startIndex + 1,
                  to: Math.min(startIndex + REVIEW_PAGE_SIZE, filtered.length),
                  total: filtered.length,
                })}
              </span>
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                  {t('timesheets:review.previous', 'Previous')}
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
                  {t('timesheets:review.next', 'Next')}
                </Button>
              </span>
            </nav>
          )}
        </div>
      )}
    </ListPage>
  );
};

/** One sheet's figures for the current project filter: the hours and project names it shows. */
function sheetView(sheet: TimesheetForReview, projectFilterId: string) {
  const entries = projectFilterId ? sheet.entries.filter((e) => e.project_id === projectFilterId) : sheet.entries;
  const names = new Set<string>();
  for (const e of entries) if (e.project) names.add(projectDisplayName(e.project));
  return { entries, hours: entries.reduce((sum, e) => sum + e.hours, 0), projects: [...names] };
}

/**
 * The review list as one table: a row scans person, week, projects, hours and status; the row opens the week's
 * entries in the side drawer (the list stays behind).
 */
const ReviewTable: React.FC<{
  rows: TimesheetForReview[];
  projectFilterId: string;
  openId: string | null;
  onOpen: (id: string | null) => void;
}> = ({ rows, projectFilterId, openId, onOpen }) => {
  const { t } = useTranslation(['common', 'timesheets']);
  const personName = (sheet: TimesheetForReview) => sheet.owner?.full_name ?? t('timesheets:review.unknownPerson', 'Team member');
  const week = (sheet: TimesheetForReview) => `${formatDay(sheet.week_start_date)} – ${formatDay(shiftIsoDays(sheet.week_start_date, 6))}`;
  const columns: Column<TimesheetForReview>[] = [
    { key: 'person', header: t('timesheets:review.person', 'Person'), kind: 'primary', rowHeader: true, cell: personName },
    { key: 'week', header: t('timesheets:review.week', 'Week'), kind: 'date', size: 168, cell: week },
    { key: 'projects', header: t('timesheets:review.projects', 'Projects'), kind: 'meta', cell: (s) => sheetView(s, projectFilterId).projects.join(', ') },
    { key: 'hours', header: t('timesheets:review.hours', 'Hours'), kind: 'number', size: 104, cell: (s) => formatNumberMax2(sheetView(s, projectFilterId).hours) },
    { key: 'status', header: t('timesheets:review.status', 'Status'), kind: 'status', size: 128, cell: (s) => <StatusPill record="timesheet" state={s.status} /> },
  ];
  const open = rows.find((s) => s.id === openId) ?? null;
  return (
    <>
      <DataTable<TimesheetForReview> embedded rows={rows} columns={columns} rowKey={(s) => s.id} tableId="timesheet-review-table"
        onActivate={(s) => onOpen(s.id)} selectedKey={open?.id}
        rowLabel={(s) => t('timesheets:review.showEntriesFor', 'Show entries for {{name}}', { name: personName(s) })} />
      {open && <ReviewDrawer sheet={open} projectFilterId={projectFilterId} title={`${personName(open)} · ${week(open)}`} onClose={() => onOpen(null)} />}
    </>
  );
};

const ReviewDrawer: React.FC<{ sheet: TimesheetForReview; projectFilterId: string; title: string; onClose: () => void }> = ({
  sheet, projectFilterId, title, onClose,
}) => {
  const { t } = useTranslation(['common', 'timesheets']);
  const view = useMemo(() => sheetView(sheet, projectFilterId), [sheet, projectFilterId]);
  const weekDates = useMemo(() => datesInWeek(localDayFromIso(sheet.week_start_date)), [sheet.week_start_date]);
  const gridDays = useMemo(() => gridDaysForWeek(weekDates), [weekDates]);
  const gridRows = useMemo(
    () => entriesToGridRows(view.entries, weekDates, t('timesheets:approvalQueue.unknownProject', 'Unknown Project'), { groupByWorkOrder: true }),
    [view.entries, weekDates, t],
  );
  return (
    <Drawer open onClose={onClose} width="lg" title={title} status={<StatusPill record="timesheet" state={sheet.status} />}
      subtitle={t('timesheets:review.hoursTotal', '{{hours}} h', { hours: formatNumberMax2(view.hours) })}>
      {gridRows.length === 0
        ? <p className="text-control text-muted-foreground">{t('timesheets:approvalQueue.noHours', 'No hours recorded for this week.')}</p>
        : <TimesheetGrid days={gridDays} rows={gridRows} stacked />}
    </Drawer>
  );
};

export default TimesheetReviewPage;
