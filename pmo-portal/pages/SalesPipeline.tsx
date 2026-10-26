import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import ProjectClassificationFilters from '../components/ProjectClassificationFilters';
import {
  AccessDenied,
  Button,
  DataTable,
  Funnel,
  Icon,
  ListState,
  PageHeading,
  StatusPill,
  TaxBasisLabel,
  ViewToggle,
  type Column,
  type FunnelStage,
} from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { usePermission } from '@/src/auth/usePermission';
import { useSalesPipeline, useLostDeals } from '@/src/hooks/useDashboard';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useProjectStatusLabel, useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { activeClassificationCount } from '@/src/lib/projectClassification';
import { formatCurrency, formatCurrencyAuto, formatNumberExact, formatNumberWhole } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { weightedValue, openOpportunity, daysSince, ATTENTION_THRESHOLD_DAYS, SALES_COLUMNS, formatPercent, pillVariantForStatus } from '../components/salesPipeline';
import { selectSalesProjects } from '@/src/components/sales/salesWorkingSet';
import { readPipelineView, writePipelineView } from '@/src/hooks/usePipelineView';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesScope, SalesSort, SalesStage } from '@/src/lib/listWorkingSet';
import type { PipelineView } from '@/src/hooks/usePipelineView';
import { ExportButton } from '@/src/components/export';
import SalesKanbanBoard from '../components/SalesKanbanBoard';

const OPEN_COLUMNS = SALES_COLUMNS.filter((column) => !column.terminal);
const SORTS: readonly SalesSort[] = ['activity-oldest', 'activity-newest'];
const SCOPES: readonly SalesScope[] = ['Open', 'Lost', 'Needs attention'];

function StageActivity({ project }: { project: PipelineProject }) {
  const { t } = useTranslation('sales');
  const days = daysSince(project.last_update);
  if (days === null) return <span className="text-foreground tabular">{t('pipeline.activityUnavailable', 'Activity unavailable')}</span>;
  if (days === 0) return <span>{t('pipeline.today', 'Today')}</span>;
  if (days === 1) return <span>{t('pipeline.oneDay', '1 day ago')}</span>;
  return <span>{t('pipeline.daysAgo', '{{days}} days ago', { days })}</span>;
}

function isTerminal(project: PipelineProject): boolean {
  return project.status === 'Loss Tender' || project.status === 'Declined';
}

const SalesPipeline: React.FC = () => {
  const { t } = useTranslation();
  const { t: salesT } = useTranslation('sales');
  const isDesktop = useIsDesktop();
  const stageLabel = useSalesStageLabel();
  const statusLabel = useProjectStatusLabel();
  const orgCurrency = useOrgCurrency();
  const may = usePermission();
  const canView = may('transition', 'project');
  const canCreate = may('create', 'project');
  const pipeline = useSalesPipeline();
  const lostQuery = useLostDeals();
  const { data, isPending, isError, refetch } = pipeline;
  const { data: lostDeals, isPending: lostPending, isError: lostError, refetch: refetchLost } = lostQuery;
  const openProjects = useMemo(() => data?.projects ?? [], [data]);
  const lostProjects = useMemo(() => lostDeals ?? [], [lostDeals]);
  const navigate = useNavigate();
  const { workingSet, setWorkingSet } = useListWorkingSet('sales', { sessionView: readPipelineView() });
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) =>
    setWorkingSet((current) => ({ ...current, q })),
  );
  const contentReady = !isPending && !isError;
  const { openRecord } = useListReturn({ list: 'sales', contentReady });
  const [classificationResetToken, setClassificationResetToken] = useState(0);
  const [showWeighted, setShowWeighted] = useState(false);
  const view: PipelineView = isDesktop ? workingSet.view : 'kanban';
  const allProjects = useMemo(() => [...openProjects, ...lostProjects], [openProjects, lostProjects]);
  const selectedStatus = workingSet.status as SalesStage;
  const scopeLabels: Record<SalesScope, string> = {
    Open: salesT('pipeline.scopeOpen', 'Open'),
    Lost: salesT('pipeline.scopeLost', 'Lost'),
    'Needs attention': salesT('pipeline.scopeAttention', 'Needs attention'),
  };
  const sortLabels: Record<SalesSort, string> = {
    'activity-oldest': salesT('pipeline.sortOldest', 'Oldest activity first'),
    'activity-newest': salesT('pipeline.sortNewest', 'Newest activity first'),
  };
  const visible = useMemo(() => selectSalesProjects(openProjects, lostProjects, {
    ...workingSet,
    q: search,
  }), [openProjects, lostProjects, search, workingSet]);
  const hasActiveClassification = activeClassificationCount(workingSet) > 0;
  const hasActiveFilters = Boolean(search.trim() || hasActiveClassification || selectedStatus || workingSet.scope !== 'Open');
  const stageName = selectedStatus ? stageLabel(OPEN_COLUMNS.find((column) => column.statuses.includes(selectedStatus)) ?? OPEN_COLUMNS[0]) : salesT('pipeline.allStages', 'All stages');
  const displayStage = (project: PipelineProject) => {
    const column = OPEN_COLUMNS.find((candidate) => candidate.statuses.includes(project.status));
    return column ? stageLabel(column) : statusLabel(project.status);
  };
  const activeFilterSummary = [
    search.trim() ? `${salesT('pipeline.searchSummary', 'Search')}: ${search.trim()}` : null,
    hasActiveClassification ? salesT('pipeline.classificationActive', 'Classification filters active') : null,
  ].filter(Boolean).join(' · ');
  const scopeLine = [scopeLabels[workingSet.scope], stageName, activeFilterSummary || null].filter(Boolean).join(' · ');
  const state: 'loading' | 'error' | 'empty' | undefined = isPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : openProjects.length === 0 && lostProjects.length === 0 && !lostError && !lostPending
        ? 'empty'
        : undefined;
  const lostScopeBlocked = lostError && workingSet.scope === 'Lost';
  const lostScopePending = lostPending && workingSet.scope === 'Lost';
  const partialLostFailure = lostError && workingSet.scope === 'Needs attention';
  const partialLostPending = lostPending && workingSet.scope === 'Needs attention';

  const updateScope = (scope: SalesScope) => setWorkingSet((current) => ({
    ...current,
    scope,
    ...(scope === 'Lost' ? { status: '' as const } : {}),
  }));
  const updateStage = (status: SalesStage) => setWorkingSet((current) => ({
    ...current,
    scope: 'Open',
    status,
  }));
  const updateView = (next: PipelineView) => {
    writePipelineView(next);
    setWorkingSet((current) => ({ ...current, view: next }));
  };
  const clearFilters = () => {
    setSearch('');
    setClassificationResetToken((token) => token + 1);
    setWorkingSet((current) => ({
      ...current,
      scope: 'Open', status: '', q: '', serviceLine: '', sector: '', awardType: undefined,
      biddingEntity: undefined, location: '',
    }));
  };
  const onOpen = (project: PipelineProject) => openOpportunity(openRecord, project);
  const createAction = canCreate ? (
    <Button variant="primary" className="min-h-11 w-full px-4 md:w-auto" onClick={() => openRecord('/projects/new')}>
      <Icon name="plus" />{t('sales.newProject', 'New project')}
    </Button>
  ) : null;

  if (!canView) {
    return <AccessDenied
      title={t('sales.accessDenied.title', "You don't have access to the Sales Pipeline")}
      sub={t('sales.accessDenied.sub', 'The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks.')}
      onBack={() => navigate('/')}
    />;
  }

  const columns: Column<PipelineProject>[] = [
    {
      key: 'project', header: t('sales.column.project', 'Project'), kind: 'primary', rowHeader: true, size: 250,
      cell: (project) => (
        <Link to={`/projects/${project.id}`} onClick={(event) => { event.preventDefault(); onOpen(project); }}
          data-list-return-focus={`project-${project.id}`} className="block min-h-11 break-words font-normal text-primary-text underline-offset-4 hover:underline">
          {projectDisplayName(project)}
        </Link>
      ),
      primaryTitle: (project) => project.name,
      secondaryCell: (project) => [projectDisplayName(project) !== project.name ? project.name : null, project.pmo_project_number, project.code].filter(Boolean).join(' · ') || undefined,
      exportValue: (project) => project.name,
    },
    {
      key: 'customer', header: t('sales.column.customer', 'Customer / end customer'), kind: 'text', size: 160,
      cell: (project) => <span className="block min-w-0 break-words">{project.client_name || '—'}{project.end_client_name && <span className="block text-sm text-muted-foreground">{salesT('pipeline.endCustomerLine', 'for {{name}}', { name: project.end_client_name })}</span>}</span>,
      exportValue: (project) => project.client_name ?? '',
    },
    {
      key: 'owner', header: t('sales.column.owner', 'Owner'), kind: 'meta', size: 120,
      cell: (project) => project.pm_name || <span className="text-muted-foreground">{salesT('pipeline.ownerUnavailable', 'Owner unavailable')}</span>,
      exportValue: (project) => project.pm_name ?? '',
    },
    {
      key: 'stage', header: t('sales.column.stage', 'Stage'), kind: 'status', size: 115,
      cell: (project) => <StatusPill variant={pillVariantForStatus(project.status)} className="text-sm font-normal">{displayStage(project)}</StatusPill>,
      exportValue: (project) => displayStage(project),
    },
    {
      key: 'last_activity', header: salesT('pipeline.lastActivity', 'Last activity'), size: 115,
      cell: (project) => <StageActivity project={project} />,
      exportValue: (project) => {
        const days = daysSince(project.last_update);
        return days === null ? '' : days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
      },
    },
    {
      key: 'value', header: t('sales.column.value', 'Value'), kind: 'money', size: 185, align: 'num',
      cell: (project) => <span className="flex min-w-0 flex-wrap items-center justify-end gap-1 whitespace-normal tabular"><span className="min-w-0 whitespace-normal break-words [overflow-wrap:anywhere]">{formatCurrencyAuto(project.contract_value, project.currency)}</span><TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails={false} /></span>,
      exportValue: (project) => project.contract_value,
    },
    {
      key: 'win', header: t('sales.column.winPct', 'Win %'), kind: 'percent', size: 75, align: 'num',
      cell: (project) => isTerminal(project) ? salesT('pipeline.notApplicable', 'Not applicable') : formatPercent(project.win_probability),
      exportValue: (project) => isTerminal(project) ? '' : Math.round(project.win_probability * 100),
    },
    {
      key: 'weighted', header: salesT('pipeline.weightedSameCurrency', 'Weighted · same currency as Value'), kind: 'money', size: 190, align: 'num',
      cell: (project) => isTerminal(project) ? salesT('pipeline.notApplicable', 'Not applicable') : formatNumberWhole(weightedValue(project)),
      exportValue: (project) => isTerminal(project) ? '' : weightedValue(project),
    },
  ];
  const currencyColumn: Column<PipelineProject> = {
    key: 'currency', header: salesT('pipeline.currency', 'Currency'), kind: 'text', cell: (project) => project.currency,
    exportValue: (project) => project.currency,
  };
  const endCustomerColumn: Column<PipelineProject> = {
    key: 'end-customer', header: t('sales.column.endCustomer', 'End customer'), kind: 'text',
    cell: (project) => project.end_client_name ?? '—', exportValue: (project) => project.end_client_name ?? '',
  };
  const exportColumns = columns.flatMap((column) => {
    if (column.key === 'customer') return [column, endCustomerColumn];
    if (column.key === 'value') return [column, currencyColumn];
    return [column];
  });
  const sharedBasis = visible.length > 0 && visible.every((project) => project.tax_treatment === visible[0].tax_treatment) ? visible[0] : undefined;
  const displayColumns = (showWeighted ? columns : columns.filter((column) => column.key !== 'weighted')).map((column) => column.key === 'value' && sharedBasis ? { ...column, header: <span>{t('sales.column.value', 'Value')} · <TaxBasisLabel treatment={sharedBasis.tax_treatment} showDetails={false} className="font-semibold" /></span>, cell: (project: PipelineProject) => <span className="whitespace-nowrap tabular">{formatCurrencyAuto(project.contract_value, project.currency)}</span> } : column);

  const pipelineCurrencies = new Set(openProjects.map((project) => project.currency));
  const summarySharedCurrency = pipelineCurrencies.size === 1 ? [...pipelineCurrencies][0] : undefined;
  let summaryHasUnknown = pipelineCurrencies.size > 1;
  const summaryStages: FunnelStage[] = OPEN_COLUMNS.map((column) => {
    const aggregate = data?.stages.find((stage) => stage.status === column.statuses[0]);
    const stageRows = openProjects.filter((project) => column.statuses.includes(project.status));
    const currencies = new Set(stageRows.map((project) => project.currency));
    const valueUnavailable = currencies.size > 1 || !aggregate || !Number.isFinite(aggregate.total_value);
    const probabilityUnavailable = !aggregate || !Number.isFinite(aggregate.win_probability);
    summaryHasUnknown ||= valueUnavailable || probabilityUnavailable || !Number.isFinite(aggregate?.weighted_value);
    const currency = currencies.size === 1 ? [...currencies][0] : orgCurrency;
    return {
      name: !summarySharedCurrency && !valueUnavailable && currencies.size <= 1
        ? `${stageLabel(column)} · ${currencies.size === 1 ? currency : orgCurrency}`
        : stageLabel(column),
      dotColor: column.dotColor,
      prob: !probabilityUnavailable && aggregate ? formatPercent(aggregate.win_probability) : undefined,
      value: valueUnavailable ? <span>{salesT('pipeline.summaryForecastUnavailable', 'Not available')} · {currencies.size > 1 ? salesT('pipeline.mixedCurrencies', 'Mixed currencies') : salesT('pipeline.missingAggregate', 'Stage total unavailable')}</span> : stageRows.length === 1 ? salesT('pipeline.oneProject', '1 project · value on row') : formatNumberExact(aggregate?.total_value ?? 0),
      weighted: undefined,
      barPct: (stageRows.length / Math.max(1, ...OPEN_COLUMNS.map((stage) => openProjects.filter((project) => stage.statuses.includes(project.status)).length))) * 100,
    };
  });
  const summaryAggregates = OPEN_COLUMNS.map((column) => data?.stages.find((stage) => stage.status === column.statuses[0]));
  const forecastUnavailable = pipelineCurrencies.size > 1 || summaryAggregates.some((aggregate) =>
    !aggregate || !Number.isFinite(aggregate.weighted_value) || !Number.isFinite(aggregate.total_value),
  );
  summaryHasUnknown ||= forecastUnavailable;
  const weightedForecast = forecastUnavailable
    ? salesT('pipeline.summaryForecastUnavailable', 'Not available')
    : formatCurrency(summaryAggregates.reduce((total, aggregate) => total + (aggregate?.weighted_value ?? 0), 0), pipelineCurrencies.size === 1 ? [...pipelineCurrencies][0] : orgCurrency);
  const summary = (
    <details data-testid="sales-summary" className="mb-4">
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-baseline gap-2"><span aria-hidden>▸ </span><span className="text-xs font-semibold text-muted-foreground">{salesT('pipeline.summaryDisclosure', 'Pipeline summary')}</span><span className="text-xl font-bold text-foreground tabular">{formatNumberWhole(openProjects.length)}</span></span>
        <span className="text-xs font-semibold text-muted-foreground">{salesT('pipeline.summaryScope', 'All open projects · before list filters')}</span>
      </summary>
      <div className="mt-2">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{salesT('pipeline.comparisonCount', 'Stage comparison · project count')}{summarySharedCurrency && ` · ${summarySharedCurrency}`}</p>
        <Funnel stages={summaryStages} className="[&_[data-funnel-stage-prob]]:text-sm [&_[data-funnel-stage-prob]]:font-normal [&_[data-funnel-stage-prob]]:text-foreground [&_[data-funnel-stage-prob]]:tabular-nums" />
        <p data-testid="pipeline-weighted-total" className="mt-2 flex flex-wrap items-baseline gap-2 text-sm">
          <span className="text-xs font-semibold text-muted-foreground">{salesT('pipeline.summaryForecast', 'Weighted pipeline forecast')}: </span>
          <span className="text-sm text-foreground tabular">{weightedForecast}</span>
        </p>
        {summaryHasUnknown && <p className="mt-2 text-sm text-muted-foreground">{salesT('pipeline.summaryCaveat', 'Some stage totals are unavailable or span mixed currencies.')} <Link className="text-primary-text underline underline-offset-4" to="/projects">{salesT('pipeline.reviewEvidence', 'Review project records')}</Link></p>}
      </div>
    </details>
  );

  const toolbar = (
    <section aria-label={salesT('pipeline.controls', 'Sales pipeline controls')} className="mb-4 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 md:w-72 md:min-w-64 md:flex-none">
        <Icon name="search" />
        <input type="search" aria-label={t('sales.search.label', 'Search projects')} placeholder={t('sales.search.placeholder', 'Search projects…')} value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
      </div>
      <label className="flex min-w-28 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground md:min-w-0 md:flex-none">
        <span>{salesT('pipeline.scopeLabel', 'Project scope')}</span>
        <select aria-label={salesT('pipeline.scopeLabel', 'Project scope')} value={workingSet.scope} onChange={(event) => updateScope(event.currentTarget.value as SalesScope)} className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {SCOPES.map((scope) => <option key={scope} value={scope}>{scopeLabels[scope]}</option>)}
        </select>
      </label>
      <label className="flex min-w-28 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground md:min-w-0 md:flex-none">
        <span>{salesT('pipeline.stageLabel', 'Stage')}</span>
        <select aria-label={salesT('pipeline.stageLabel', 'Stage')} value={selectedStatus} disabled={workingSet.scope === 'Lost'} onChange={(event) => updateStage(event.currentTarget.value as SalesStage)} className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-70">
          <option value="">{salesT('pipeline.allStages', 'All stages')}</option>
          {OPEN_COLUMNS.map((column) => <option key={column.testId} value={column.statuses[0]}>{stageLabel(column)}</option>)}
        </select>
        {workingSet.scope === 'Lost' && <span className="text-xs">{salesT('pipeline.stageOpenOnly', 'Stage applies to open projects')}</span>}
      </label>
      <div className="contents">
        <ProjectClassificationFilters rows={allProjects} value={workingSet} onChange={(patch) => setWorkingSet((current) => ({ ...current, ...patch }))} inlineTrigger resetToken={classificationResetToken} />
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground md:flex-none">
          <span>{salesT('pipeline.sortLabel', 'Sort')}</span>
          <select aria-label={salesT('pipeline.sortLabel', 'Sort')} value={workingSet.sort} onChange={(event) => setWorkingSet((current) => ({ ...current, sort: event.currentTarget.value as SalesSort }))} className="min-h-11 min-w-0 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {SORTS.map((sort) => <option key={sort} value={sort}>{sortLabels[sort]}</option>)}
          </select>
        </label>
      </div>
      {isDesktop && <ViewToggle<PipelineView> options={[
        { value: 'kanban', label: t('sales.view.board', 'Board'), icon: 'cards' },
        { value: 'table', label: t('sales.view.table', 'Table'), icon: 'table' },
      ]} value={view} onChange={updateView} ariaLabel={t('sales.viewToggleLabel', 'Pipeline view')} />}
      {isDesktop ? <ExportButton rows={visible} columns={exportColumns} entity="Pipeline" /> : (
        <details className="relative">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-md border border-input px-3 text-sm font-medium">{salesT('pipeline.moreActions', 'More actions')}</summary>
          <div className="absolute right-0 z-10 mt-1 rounded-md border border-border bg-card p-2"><ExportButton rows={visible} columns={exportColumns} entity="Pipeline" className="min-h-11" /></div>
        </details>
      )}
      {createAction && <div className="ml-auto w-full md:w-auto">{createAction}</div>}
    </section>
  );

  const narrowedEmpty = hasActiveFilters;
  const hasTextOrClassificationFilter = Boolean(search.trim() || hasActiveClassification);
  const emptyCopy = hasTextOrClassificationFilter
    ? [salesT('pipeline.emptyMatchTitle', 'No matching projects'), salesT('pipeline.emptyMatchBody', 'Try another search or clear filters.')]
    : selectedStatus
      ? [salesT('pipeline.emptyStageTitle', 'No projects in this stage'), salesT('pipeline.emptyStageBody', 'Choose another stage to see more projects.')]
      : workingSet.scope === 'Lost'
    ? [salesT('pipeline.emptyLostTitle', 'No lost projects'), salesT('pipeline.emptyLostBody', 'Projects marked lost will appear here.')]
    : workingSet.scope === 'Needs attention'
      ? [salesT('pipeline.emptyAttentionTitle', 'No projects need attention'), salesT('pipeline.emptyAttentionBody', 'No project has been untouched for {{days}}+ days.', { days: ATTENTION_THRESHOLD_DAYS })]
      : [salesT('pipeline.emptyMatchTitle', 'No matching projects'), salesT('pipeline.emptyMatchBody', 'Try another search or clear filters.')];
  const showEmpty = state !== 'loading' && state !== 'error' && !lostScopeBlocked && !lostScopePending && !partialLostFailure && !partialLostPending && visible.length === 0;
  const shouldShowSummary = state === undefined;

  return (
    <div className="min-w-0">
      <PageHeading
        title={t('shell.nav.sales', 'Sales Pipeline')}
        scope={scopeLine}
        kind="collection"
        className="mb-4 [&_[data-page-scope]]:text-sm"
      />
      {toolbar}
      {isDesktop && shouldShowSummary && summary}
      {lostScopeBlocked && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-card p-3">
          <p>{salesT('pipeline.lostError', "Couldn't load lost project evidence. Open projects remain available below.")}</p>
          <Button variant="outline" className="min-h-11" onClick={() => refetchLost()}>{t('ui.listState.retry', 'Retry')}</Button>
        </div>
      )}
      {lostScopePending && <ListState variant="loading" rows={4} />}
      {partialLostPending && <p role="status" className="mb-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">{salesT('pipeline.partialLostLoading', 'Lost-project evidence is loading; matching open projects remain available.')}</p>}
      {partialLostFailure && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning bg-card p-3">
          <p>{salesT('pipeline.partialLostError', 'Lost-project evidence is unavailable; open projects needing attention are shown.')}</p>
          <Button variant="outline" className="min-h-11" onClick={() => refetchLost()}>{t('ui.listState.retry', 'Retry')}</Button>
        </div>
      )}
      {state === 'loading' && <ListState variant="loading" rows={5} />}
      {state === 'error' && <ListState variant="error" title={t('sales.error.title', "Couldn't load the sales pipeline")} sub={t('sales.error.sub', 'Something went wrong fetching your pipeline.')} onRetry={() => refetch()} />}
      {state === 'empty' && !hasActiveFilters && <div className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold">{t('sales.empty.title', 'No projects yet')}</h2><p className="mt-1 text-sm text-muted-foreground">{canCreate ? t('sales.empty.sub', 'Add a project to start tracking the pipeline.') : salesT('pipeline.financeCreateHint', 'Ask a project manager to add a project.')}</p></div>}
      {(state === undefined || state === 'empty' && hasActiveFilters) && showEmpty && <ListState variant="empty" className="[&_button:hover]:bg-primary" title={emptyCopy[0]} sub={emptyCopy[1]} action={narrowedEmpty ? { label: salesT('pipeline.clearFilters', 'Clear filters'), onClick: clearFilters } : undefined} />}
      {state === undefined && !lostScopeBlocked && !lostScopePending && visible.length > 0 && view === 'kanban' && isDesktop && <SalesKanbanBoard projects={visible} onOpen={onOpen} />}
      {state === undefined && !lostScopeBlocked && !lostScopePending && visible.length > 0 && !isDesktop && <SalesKanbanBoard projects={visible} onOpen={onOpen} presentation="list" />}
      {state === undefined && !lostScopeBlocked && !lostScopePending && visible.length > 0 && view === 'table' && isDesktop && (
        <div className="min-w-0 [&_table]:text-sm [&_thead_th]:text-xs [&_tbody_td]:text-sm [&_li]:text-sm [&_dd]:text-sm [&_table]:!min-w-0 [&_table]:!w-full [&_tbody_.truncate]:!whitespace-normal [&_tbody_.truncate]:!overflow-visible [&_tbody_.truncate]:!text-clip">
          <details className="mb-2">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-muted-foreground underline underline-offset-4">{salesT('pipeline.columns', 'Columns')}</summary>
            <label className="ml-3 inline-flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showWeighted} onChange={(event) => setShowWeighted(event.currentTarget.checked)} />{t('sales.column.weighted', 'Weighted')}</label>
          </details>
          <DataTable rows={visible} columns={displayColumns} rowKey={(project) => project.id} accessibleName={salesT('pipeline.table', 'Sales projects')} tableId="salespipeline-table" />
        </div>
      )}
      {state === undefined && shouldShowSummary && !isDesktop && summary}
    </div>
  );
};

export default SalesPipeline;
