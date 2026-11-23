import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  DataTable, FilterBar, ListPage, ProgressBar, StatTiles, StatusPill, useUrlFilters,
  type Column, type FilterBarFilter, type StatTile,
} from '@/src/components/ui';
import { useTerms } from '@/src/lib/i18n/terms';
import { statusLabel } from '@/src/lib/status/statusMap';
import { formatDay, formatTableMoney, formatTileMoney } from '@/src/lib/format';
import { planVariance } from '@/src/lib/workOrderPlanVsActual';
import { COST_PROJECT_CAP, useWorkOrderDashboard } from '@/src/hooks/useWorkOrderDashboard';
import type { DashboardRow } from '@/src/lib/workOrderDashboard';
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';

const STATUSES: WorkOrderStatus[] = ['Draft', 'Issued', 'Closed', 'Cancelled'];
const FILTER_KEYS = ['q', 'status', 'project', 'discipline'] as const;

/**
 * The work-order dashboard (#2805): every work order the reader may see, or one project's on its Work orders tab, with
 * the figures its own page computes (progress, direct cost against budget, billed, open and late steps). A row opens the
 * work order. Money appears only where the work-order page shows it to the same role (invoice view right for billing,
 * plan view right for cost); the reads are a fixed set, never one per row.
 */
/** A table figure with its one muted second line, both ending on the column's right edge. */
const TwoLine: React.FC<{ value: React.ReactNode; sub: React.ReactNode; testId: string }> = ({ value, sub, testId }) => (
  <span className="block text-right" data-testid={testId}>
    <span className="block tabular-nums">{value}</span>
    {sub && <span className="block tabular-nums text-muted-foreground">{sub}</span>}
  </span>
);

export const WorkOrdersBoard: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { t } = useTranslation('workOrders');
  const { t: ts } = useTranslation();
  const terms = useTerms();
  const navigate = useNavigate();
  const { values, setFilters, clear } = useUrlFilters(FILTER_KEYS);

  // Cost reads follow the projects in view, so the project filter is applied before the reads are chosen.
  const all = useWorkOrderDashboard(projectId, values.project ? [values.project] : undefined);
  const { rows, canBilling, costState, disciplines } = all;

  const filtered = useMemo(() => {
    const q = values.q.trim().toLowerCase();
    return rows.filter((r) => (!q || [r.wo_number, r.title, r.project_name].some((v) => v?.toLowerCase().includes(q)))
      && (!values.status || (values.status === 'late' ? r.late > 0 : r.status === values.status))
      && (!values.project || r.project_id === values.project)
      && (!values.discipline || r.disciplineIds.includes(values.discipline)));
  }, [rows, values.q, values.status, values.project, values.discipline]);

  const projects = useMemo(() => [...new Map(rows.map((r) => [r.project_id, r.project_name ?? r.project_id])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1])), [rows]);
  const usedDisciplines = useMemo(() => {
    const used = new Set(rows.flatMap((r) => r.disciplineIds));
    return disciplines.filter((d) => used.has(d.id));
  }, [rows, disciplines]);

  const filters: FilterBarFilter[] = [
    { key: 'status', label: t('all.filter.status', 'Filter by status'), kind: 'segment', semantics: 'tabs',
      // Late sits first: what is off track leads (screen rules); it is not a status, so it has no pill colour.
      options: [{ value: 'late', label: t('all.filter.late', 'Late') }, ...STATUSES.map((s) => ({ value: s, label: statusLabel('workOrder', s, ts) }))] },
    ...(!projectId && projects.length > 1 ? [{ key: 'project', label: t('all.filter.project', 'Project'), kind: 'select' as const,
      options: projects.map(([value, label]) => ({ value, label })) }] : []),
    ...(usedDisciplines.length > 0 ? [{ key: 'discipline', label: t('all.filter.discipline', 'Discipline'), kind: 'select' as const,
      options: usedDisciplines.map((d) => ({ value: d.id, label: d.name })) }] : []),
  ];

  const pendingMark = all.figuresPending ? '…' : '—';
  const columns = useMemo<Column<DashboardRow>[]>(() => [
    { key: 'number', header: t('all.col.workOrder', 'Work order'), kind: 'primary', rowHeader: true,
      cell: (r) => r.wo_number ?? t('notNumbered', 'Not yet numbered'), secondaryCell: (r) => r.title, size: 240,
      primaryTitle: (r) => `${r.wo_number ?? ''} ${r.title}`.trim(), exportValue: (r) => r.wo_number ?? '' },
    ...(projectId ? [] : [{ key: 'project', header: t('project', 'Project'), size: 144, cell: (r: DashboardRow) => r.project_name ?? '—', exportValue: (r: DashboardRow) => r.project_name ?? '' }]),
    { key: 'status', header: t('common:projects.columns.status', 'Status'), kind: 'status', size: 132, cell: (r) => <StatusPill record="workOrder" state={r.status} />,
      exportValue: (r) => statusLabel('workOrder', r.status, ts) },
    { key: 'progress', header: t('all.col.progress', 'Progress'), kind: 'percent', size: 112, keepWhenBlank: true,
      cell: (r) => r.progress === null ? pendingMark : (
        <span className="flex items-center justify-end gap-2" data-testid={`wo-progress-${r.id}`}>
          <ProgressBar value={r.progress} tone="primary" compact widthless className="w-14" aria-label={t('all.col.progress', 'Progress')} />
          <span className="w-10 text-right tabular-nums">{Math.round(r.progress)}%</span>
        </span>
      ),
      exportValue: (r) => (r.progress === null ? '' : Math.round(r.progress)), exportType: 'number' },
    ...(costState === 'shown' ? [{ key: 'cost', header: t('all.col.cost', 'Direct cost'), kind: 'money' as const, size: 152, keepWhenBlank: true,
      cell: (r: DashboardRow) => {
        if (!r.cost || r.cost.direct === null) return pendingMark;
        const v = planVariance(r.cost.plan, r.cost.direct);
        return (
          <TwoLine testId={`wo-cost-${r.id}`} value={formatTableMoney(r.cost.direct, r.cost.currency)}
            sub={v.state === 'over'
              ? <span className="text-destructive-text">{t('all.costOver', 'Over budget by {{amount}}', { amount: formatTableMoney(v.by, r.cost.currency) })}</span>
              : r.cost.plan !== null ? t('all.costBudget', 'Budget {{amount}}', { amount: formatTableMoney(r.cost.plan, r.cost.currency) }) : null} />
        );
      },
      exportValue: (r: DashboardRow) => r.cost?.direct ?? '', exportType: 'number' as const }] : []),
    ...(canBilling ? [{ key: 'billed', header: t('all.col.billed', 'Billed'), kind: 'money' as const, size: 152, keepWhenBlank: true,
      cell: (r: DashboardRow) => (!r.billing ? pendingMark : !r.billing.complete ? t('all.cannotTotal', "Can't total")
        : <TwoLine testId={`wo-billed-${r.id}`} value={formatTableMoney(r.billing.invoiced, r.billing.currency)}
            sub={t('all.ofOrder', 'of {{amount}}', { amount: formatTableMoney(r.billing.orderNet, r.billing.currency) })} />),
      exportValue: (r: DashboardRow) => (r.billing?.complete ? r.billing.invoiced : ''), exportType: 'number' as const }] : []),
    { key: 'missing', header: t('all.col.missing', 'Missing'), align: 'num', size: 120,
      cell: (r) => (r.openSteps === 0 && r.late === 0 ? '—' : (
        <span className="block text-right tabular-nums" data-testid={`wo-missing-${r.id}`}>
          {r.openSteps > 0 && <span className="block whitespace-nowrap">{t('all.openSteps', '{{count}} open', { count: r.openSteps })}</span>}
          {r.late > 0 && <span className="block whitespace-nowrap font-medium text-warning-foreground">{t('all.late', '{{count}} late', { count: r.late })}</span>}
        </span>
      )) },
    { key: 'end', header: t('all.col.end', 'End'), kind: 'date', align: 'num', size: 112, cell: (r) => (r.end_date ? <span className="whitespace-nowrap">{formatDay(r.end_date)}</span> : '—'),
      exportValue: (r) => r.end_date ?? '', exportType: 'date' },
  ], [t, ts, projectId, costState, canBilling, pendingMark]);

  // The strip sums the rows in view, one currency only: a second currency would need a second line per figure. Not on the
  // project tab: the project header already carries the project's money facts.
  const tiles = useMemo<StatTile[] | null>(() => {
    const billed = filtered.map((r) => r.billing).filter((b): b is NonNullable<DashboardRow['billing']> => Boolean(b?.complete));
    const currency = billed[0]?.currency;
    if (!canBilling || !currency || billed.some((b) => b.currency !== currency)) return null;
    const sum = (f: (b: typeof billed[number]) => number) => billed.reduce((s, b) => s + f(b), 0);
    return [
      { label: t('all.tile.orderValue', 'Order value'), value: formatTileMoney(sum((b) => b.orderNet), currency) },
      { label: t('all.tile.billed', 'Billed'), value: formatTileMoney(sum((b) => b.invoiced), currency) },
      { label: t('all.tile.toBill', 'Left to bill'), value: formatTileMoney(sum((b) => Math.max(0, b.orderNet - b.invoiced)), currency) },
    ];
  }, [filtered, canBilling, t]);

  const lateCount = rows.filter((r) => r.late > 0).length;
  const finding = lateCount > 0 && values.status !== 'late' ? (
    <p className="text-control" data-testid="work-orders-finding">
      <button type="button" className="font-medium text-warning-foreground hover:underline" onClick={() => setFilters({ status: 'late' })}>
        {t('all.findingLate', '{{count}} work orders late', { count: lateCount })}
      </button>
    </p>
  ) : undefined;

  const state = all.isPending ? 'loading' : all.isError ? 'error' : filtered.length === 0 ? 'empty' : undefined;
  return (
    <ListPage
      title={terms.clientWorkOrder}
      hideHeader={Boolean(projectId)}
      headingLevel={projectId ? 2 : 1}
      count={all.isPending ? undefined : rows.length}
      banner={finding}
      filters={(
        <FilterBar
          searchKey="q"
          searchLabel={t('all.search', 'Search by number, title or project')}
          searchPlaceholder={t('all.searchShort', 'Search')}
          filters={filters}
          values={values}
          onChange={(key, value) => setFilters({ [key]: value })}
          onClear={clear}
          shown={filtered.length}
          total={filtered.length < rows.length ? rows.length : undefined}
          module="work-orders"
        />
      )}
    >
      <div className="flex flex-col gap-4">
      {/* The wrapper gives StatTiles' own container query an ancestor to measure (its @container sits on the grid itself).
          On a phone the list comes first and the summary follows it (screen rules, Phone). */}
      {tiles && !projectId && filtered.length > 0 && <div className="@container order-last md:order-none"><StatTiles tiles={tiles} columns={3} /></div>}
      <DataTable<DashboardRow>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        rowHref={(r) => `/work-orders/${r.id}`}
        onActivate={(r) => navigate(`/work-orders/${r.id}`)}
        rowLabel={(r) => t('all.openRow', 'Open {{label}}', { label: r.wo_number ?? r.title })}
        accessibleName={terms.clientWorkOrder}
        tableId={projectId ? 'project-work-orders' : 'work-orders'}
        compactRows
        cardBelow={900}
        state={state}
        onRetry={() => all.refetch()}
        errorTitle={t('all.error', "Couldn't load your work orders")}
        emptyTitle={rows.length > 0 ? t('all.noMatch', 'No work order matches your search') : t('all.empty', 'You have no work orders yet')}
        cardValuesEnd
        filteredEmpty={rows.length > 0 ? { message: t('all.noMatch', 'No work order matches your search'), clearFiltersLabel: ts('ui.filterBar.clear', 'Clear all'), onClearFilters: clear } : undefined}
      />
      </div>
      {costState === 'too-many' && !values.project && filtered.length > 0 && (
        <p className="mt-2 text-control text-muted-foreground" data-testid="work-orders-cost-note">
          {t('all.costTooMany', 'Direct cost shows for up to {{count}} projects. Choose a project.', { count: COST_PROJECT_CAP })}
        </p>
      )}
      {all.figuresError && (
        <p className="mt-2 text-control text-muted-foreground" role="status">
          {t('all.figuresError', "Some figures couldn't load.")}{' '}
          <button type="button" className="font-medium text-primary-text hover:underline" onClick={all.retryFigures}>{ts('ui.listState.retry', 'Retry')}</button>
        </p>
      )}
    </ListPage>
  );
};
