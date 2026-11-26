import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { usePermission } from '@/src/auth/usePermission';
import { useFeature } from '@/src/auth/useFeature';
import { useTranslation } from 'react-i18next';
import {
  Button, buttonClasses, cn, DataTable, Icon, FilterBar, ListPage, ProgressBar, StatTiles, StatusPill, useUrlFilters,
  type Column, type FilterBarFilter, type StatTile,
} from '@/src/components/ui';
import { ExportButton } from '@/src/components/export/ExportButton';
import { useTerms } from '@/src/lib/i18n/terms';
import { statusLabel } from '@/src/lib/status/statusMap';
import { formatDay, formatTableMoney, formatTileMoney } from '@/src/lib/format';
import { planVariance } from '@/src/lib/workOrderPlanVsActual';
import { COST_PROJECT_CAP, useWorkOrderDashboard } from '@/src/hooks/useWorkOrderDashboard';
import type { DashboardRow } from '@/src/lib/workOrderDashboard';
import type { WorkOrderStatus } from '@/src/lib/db/workOrders';
import { WorkOrderProjectPanels } from './WorkOrderProjectPanels';
import { NewWorkOrderModal } from './NewWorkOrderModal';
import { useWorkOrderProjectChoices } from '@/src/hooks/useWorkOrderProjectChoices';

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
    {sub && <span className="block whitespace-nowrap tabular-nums text-muted-foreground">{sub}</span>}
  </span>
);

/** Direct cost above its planned budget: the work-order page's own variance rule. */
const isOver = (r: DashboardRow) => Boolean(r.cost) && planVariance(r.cost!.plan, r.cost!.direct).state === 'over';

export const WorkOrdersBoard: React.FC<{ projectId?: string }> = ({ projectId }) => {
  const { t } = useTranslation('workOrders');
  const { t: ts } = useTranslation();
  const terms = useTerms();
  const navigate = useNavigate();
  const { values, setFilters, clear } = useUrlFilters(FILTER_KEYS);
  // Walk M8: work in hand (the company's order book in months) is reached from the work orders, for the roles its route admits.
  const may = usePermission();
  const revenueOn = useFeature('revenue');
  const workInHand = !projectId && revenueOn && may('view', 'workInHand')
    ? <Link to="/finance/work-in-hand" className={buttonClasses('outline')} data-testid="work-orders-work-in-hand">{t('all.workInHand', 'Work in hand')}</Link>
    : undefined;

  // Create (the Work orders page and one project's tab share it): the form opens here, the project is chosen in it or, from a project's tab, preset.
  const canCreate = may('create', 'workOrder');
  const [creating, setCreating] = useState(false);
  const projectChoices = useWorkOrderProjectChoices(canCreate);
  const newButton = canCreate ? (
    <Button id="new-work-order" variant="primary" size={projectId ? 'sm' : undefined} onClick={() => setCreating(true)} disabled={!projectChoices.isSuccess}>
      <Icon name="plus" />
      {t('new.action', 'New work order')}
    </Button>
  ) : undefined;

  // Cost reads follow the projects in view, so the project filter is applied before the reads are chosen.
  const all = useWorkOrderDashboard(projectId, values.project ? [values.project] : undefined);
  const { rows, canBilling, costState, disciplines } = all;

  const filtered = useMemo(() => {
    const q = values.q.trim().toLowerCase();
    return rows.filter((r) => (!q || [r.wo_number, r.title, r.project_name].some((v) => v?.toLowerCase().includes(q)))
      && (!values.status || (values.status === 'late' ? r.late > 0 : values.status === 'over' ? isOver(r) : r.status === values.status))
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
      options: [{ value: 'late', label: t('all.filter.late', 'Late') },
        ...(costState === 'shown' ? [{ value: 'over', label: t('all.filter.over', 'Over budget') }] : []), ...STATUSES.map((s) => ({ value: s, label: statusLabel('workOrder', s, ts) }))] },
    ...(!projectId && projects.length > 1 ? [{ key: 'project', label: t('all.filter.project', 'Project'), kind: 'select' as const,
      options: projects.map(([value, label]) => ({ value, label })) }] : []),
    ...(usedDisciplines.length > 0 ? [{ key: 'discipline', label: t('all.filter.discipline', 'Discipline'), kind: 'select' as const,
      options: usedDisciplines.map((d) => ({ value: d.id, label: d.name })) }] : []),
  ];

  const pendingMark = all.figuresPending ? '…' : '—';
  const columns = useMemo<Column<DashboardRow>[]>(() => [
    { key: 'number', header: t('all.col.workOrder', 'Work order'), kind: 'primary', rowHeader: true,
      // A work order with no number leads with its title, so unnumbered rows do not all read the same.
      cell: (r) => r.wo_number ?? <span className="line-clamp-2" title={r.title}>{r.title}</span>,
      secondaryCell: (r) => (r.wo_number ? <span className="line-clamp-2" title={r.title}>{r.title}</span> : null), size: 240,
      primaryTitle: (r) => `${r.wo_number ?? ''} ${r.title}`.trim(), exportValue: (r) => r.wo_number ?? '' },
    ...(projectId ? [] : [{ key: 'project', header: t('project', 'Project'), size: 96, cell: (r: DashboardRow) => r.project_name ?? '—', exportValue: (r: DashboardRow) => r.project_name ?? '' }]),
    { key: 'status', header: t('common:projects.columns.status', 'Status'), kind: 'status', size: 122, cell: (r) => <StatusPill record="workOrder" state={r.status} />,
      exportValue: (r) => statusLabel('workOrder', r.status, ts) },
    { key: 'progress', header: t('all.col.progress', 'Progress'), kind: 'percent', size: 96, keepWhenBlank: true,
      cell: (r) => r.progress === null ? pendingMark : (
        <span className="flex items-center justify-end gap-2" data-testid={`wo-progress-${r.id}`}>
          <ProgressBar value={r.progress} tone="primary" compact widthless className="w-14" aria-label={t('all.col.progress', 'Progress')} />
          <span className="w-10 text-right tabular-nums">{Math.round(r.progress)}%</span>
        </span>
      ),
      exportValue: (r) => (r.progress === null ? '' : Math.round(r.progress)), exportType: 'number' },
    ...(costState === 'shown' ? [{ key: 'cost', header: t('all.col.cost', 'Direct cost'), kind: 'money' as const, size: 208, keepWhenBlank: true,
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
    ...(canBilling ? [{ key: 'billed', header: t('all.col.billed', 'Billed'), kind: 'money' as const, size: 176, keepWhenBlank: true,
      cell: (r: DashboardRow) => (!r.billing ? pendingMark : !r.billing.complete ? t('all.cannotTotal', "Can't total")
        : <TwoLine testId={`wo-billed-${r.id}`} value={formatTableMoney(r.billing.invoiced, r.billing.currency)}
            sub={t('all.ofOrder', 'of {{amount}}', { amount: formatTableMoney(r.billing.orderNet, r.billing.currency) })} />),
      exportValue: (r: DashboardRow) => (r.billing?.complete ? r.billing.invoiced : ''), exportType: 'number' as const }] : []),
    { key: 'missing', header: t('missing.title', 'Still missing'), align: 'num', size: 118,
      cell: (r) => (r.openSteps === 0 && r.late === 0 ? '—' : (
        <span className="block text-right tabular-nums" data-testid={`wo-missing-${r.id}`}>
          {r.openSteps > 0 && <span className="block whitespace-nowrap">{t('all.openSteps', '{{count}} open', { count: r.openSteps })}</span>}
          {r.late > 0 && <span className="block whitespace-nowrap font-medium text-warning-foreground">{t('all.late', '{{count}} late', { count: r.late })}</span>}
        </span>
      )) },
    { key: 'end', header: t('all.col.end', 'End'), kind: 'date', align: 'num', size: 108, cell: (r) => (r.end_date ? <span className="whitespace-nowrap">{formatDay(r.end_date)}</span> : '—'),
      exportValue: (r) => r.end_date ?? '', exportType: 'date' },
  ], [t, ts, projectId, costState, canBilling, pendingMark]);

  // The dashboard's head: money for the work orders in scope (one currency only; a second would need a second line per
  // figure), then the two exceptions as counts that filter the table. Scope = the project (tab or filter), not the search.
  const scoped = useMemo(() => (values.project ? rows.filter((r) => r.project_id === values.project) : rows), [rows, values.project]);
  const tiles = useMemo<StatTile[]>(() => {
    const billed = scoped.map((r) => r.billing).filter((b): b is NonNullable<DashboardRow['billing']> => Boolean(b?.complete));
    const currency = billed[0]?.currency;
    const sum = (f: (b: typeof billed[number]) => number) => billed.reduce((s, b) => s + f(b), 0);
    const money: StatTile[] = canBilling && currency && !billed.some((b) => b.currency !== currency) ? [
      { label: t('all.tile.orderValue', 'Order value'), value: formatTileMoney(sum((b) => b.orderNet), currency) },
      { label: t('all.tile.billed', 'Billed'), value: formatTileMoney(sum((b) => b.invoiced), currency) },
      { label: t('all.tile.toBill', 'Left to bill'), value: formatTileMoney(sum((b) => Math.max(0, b.orderNet - b.invoiced)), currency) },
    ] : [];
    const count = (key: 'late' | 'over', n: number, label: string) => ({
      label,
      value: (
        <button type="button" data-testid={`work-orders-tile-${key}`} aria-pressed={values.status === key}
          aria-label={t(`all.tile.${key}Show`, key === 'late' ? 'Show late work orders ({{count}})' : 'Show work orders over budget ({{count}})', { count: n })}
          onClick={() => setFilters({ status: values.status === key ? '' : key })}
          className={`-my-0.5 rounded-sm text-left leading-10 tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-ring ${n > 0 ? 'text-warning-foreground' : ''}`}>
          {n}
        </button>
      ),
    });
    return [
      ...money,
      count('late', scoped.filter((r) => r.late > 0).length, t('all.tile.late', 'Late')),
      ...(costState === 'shown' ? [count('over', scoped.filter(isOver).length, t('all.tile.over', 'Over budget'))] : []),
    ];
  }, [scoped, canBilling, costState, values.status, setFilters, t]);

  const state = all.isPending ? 'loading' : all.isError ? 'error' : filtered.length === 0 ? 'empty' : undefined;
  return (
    <ListPage
      title={terms.clientWorkOrder}
      hideHeader={Boolean(projectId)}
      primaryAction={newButton || workInHand ? <div className="flex flex-wrap items-center gap-2">{workInHand}{newButton}</div> : undefined}
      headingLevel={projectId ? 2 : 1}
      count={all.isPending ? undefined : rows.length}
      exportAction={<>{projectId && newButton}<ExportButton rows={filtered} columns={columns} entity="WorkOrders" /></>}
      banner={rows.length > 0 ? <StatTiles tiles={tiles} columns={tiles.length} frameClassName={cn('mb-4', projectId && '[--space-content-inset:var(--panel-inset)]')} /> : undefined}
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
      <DataTable<DashboardRow>
        rows={filtered}
        columns={columns}
        rowKey={(r) => r.id}
        rowHref={(r) => `/work-orders/${r.id}`}
        onActivate={(r) => navigate(`/work-orders/${r.id}`)}
        rowLabel={(r) => t('all.openRow', 'Open {{label}}', { label: [r.wo_number, r.title].filter(Boolean).join(' · ') })}
        accessibleName={terms.clientWorkOrder}
        tableId={projectId ? 'project-work-orders' : 'work-orders'}
        compactRows
        cardBelow={900}
        state={state}
        onRetry={() => all.refetch()}
        errorTitle={t('all.error', "Couldn't load your work orders")}
        emptyAction={rows.length === 0 && canCreate && projectChoices.isSuccess ? { label: t('new.action', 'New work order'), onClick: () => setCreating(true) } : undefined}
        emptyActionVariant="primary"
        emptyTitle={rows.length > 0 ? t('all.noMatch', 'No work order matches your search') : t('all.empty', 'You have no work orders yet')}
        cardValuesEnd
        filteredEmpty={rows.length > 0 ? { message: t('all.noMatch', 'No work order matches your search'), clearFiltersLabel: ts('ui.filterBar.clear', 'Clear all'), onClearFilters: clear } : undefined}
      />
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
      {creating && projectChoices.data && (
        <NewWorkOrderModal projects={projectChoices.data} projectId={projectId ?? undefined} onClose={() => setCreating(false)} />
      )}
      {(projectId || values.project) && <WorkOrderProjectPanels projectId={projectId ?? values.project} />}
    </ListPage>
  );
};
