import ProjectClassificationFilters from '../components/ProjectClassificationFilters';
import { activeClassificationCount } from '@/src/lib/projectClassification';
import React, { useMemo, useState } from 'react';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import {
  Button,
  ListPage,
  SearchMini,
  ViewToggle,
  ListState,
  Icon,
  AccessDenied,
} from '@/src/components/ui';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { useProjectStatusLabel, useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { usePermission } from '@/src/auth/usePermission';
import { useSalesPipeline, useLostDeals, useWonDeals } from '@/src/hooks/useDashboard';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { readPipelineView, writePipelineView } from '@/src/hooks/usePipelineView';
import type { PipelineView } from '@/src/hooks/usePipelineView';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import { parseListWorkingSet } from '@/src/lib/listWorkingSet';
import {
  SALES_COLUMNS,
  openOpportunity,
  type OpenFunnelStage,
} from '../components/salesPipeline';
import { ExportButton } from '@/src/components/export';
import {
  type DealScope,
  DEAL_SCOPES,
  filterPipelineTable,
  filterPipelineBoard,
} from './sales-pipeline/pipelineListModel';
import { projectFunnelModel, OPEN_COLUMNS } from './sales-pipeline/pipelineFunnelModel';
import { PipelineFunnel } from './sales-pipeline/PipelineFunnel';
import { buildPipelineColumns } from './sales-pipeline/pipelineColumns';
import { PipelineResults } from './sales-pipeline/PipelineResults';

const SalesPipeline: React.FC = () => {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const stageLabel = useSalesStageLabel();
  const projectStatusLabel = useProjectStatusLabel();
  // FR-L10N-020: STAGE/FUNNEL AGGREGATES sum across deals. They render in the deals' one shared
  // currency; with none the org default is used for a true zero; with several there is no total.
  // Per-ROW deal figures (table Value/Weighted cells, kanban cards) render each deal's OWN currency
  // (get_sales_pipeline now projects it, migration 0201) — never the org default.
  const orgCurrency = useOrgCurrency();
  const may = usePermission();
  // A-4 (rbac-visibility §C): Sales Pipeline view = Admin·Exec·PM·Finance; Engineer = ○ (no
  // nav, no page). The rail hides it but the ROUTE does not — so an Engineer reaching /sales
  // by URL gets a clean access-denied surface with a way back, never the org pipeline board.
  // `project.transition` is exactly the Sales-view role set (Admin·Exec·PM·Finance). RLS is the
  // authority for the rows; this is FE clarity.
  const canViewSales = may('transition', 'project');
  // B-3 (AC-W2-IXD-005): the "+ New project" CTA — same gate as Projects.tsx (DELIVERY:
  // Admin·Exec·PM). Finance views the pipeline but cannot start projects (rbac-visibility §C).
  const canCreate = may('create', 'project');

  const { data, isPending, isError, refetch } = useSalesPipeline();
  // Terminal deal rows use the projects RLS path (get_sales_pipeline returns only OPEN stages),
  // so both terminal kanban columns and their table scopes are reachable.
  // PGA05-006: capture isPending for lostDeals so loading state is respected.
  const { data: lostDeals, isPending: lostPending, isError: lostError, refetch: refetchLost } = useLostDeals();
  const { data: wonDeals, isPending: wonPending, isError: wonError, refetch: refetchWon } = useWonDeals();
  const navigate = useNavigate();
  // list-working-set-return (#682): `scope`/`status`/`q`/`view` are URL-owned. D-1
  // (AC-JR-W3B-05) dashboard drill-links via `?status=` keep working — the codec normalizes
  // a contradictory `scope=Lost&status=<open stage>` to Open (AC-LRC-002).
  const { workingSet, setWorkingSet } = useListWorkingSet('sales', {
    sessionView: readPipelineView(),
  });
  // Search stays LOCAL text written to the URL after a pause — see useUrlSearchInput's contract.
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) =>
    setWorkingSet((ws) => ({ ...ws, q })),
  );
  const { openRecord } = useListReturn({ list: 'sales', contentReady: !isPending && !isError });

  const scope: DealScope = workingSet.scope as DealScope;
  // The phone has one presentation — the stage list — so a stored `table` view is not honoured
  // there and no Board/Table toggle is offered.
  const view: PipelineView = isDesktop ? workingSet.view : 'kanban';
  const onViewChange = (v: PipelineView) => {
    writePipelineView(v);
    setWorkingSet((ws) => ({ ...ws, view: v }));
  };

  /** The funnel stage currently selected from the URL, or null when none is. */
  const selectedStatus: OpenFunnelStage | null =
    (workingSet.status as OpenFunnelStage | '') || null;
  /** Index into OPEN_COLUMNS for the currently selected funnel stage (null = no stage filter). */
  const stageIndex = useMemo(
    () =>
      selectedStatus === null
        ? null
        : (() => {
            const idx = OPEN_COLUMNS.findIndex((c) => c.statuses.includes(selectedStatus));
            return idx >= 0 ? idx : null;
          })(),
    [selectedStatus],
  );

  const openProjects = useMemo(() => data?.projects ?? [], [data]);
  const lost = useMemo(() => lostDeals ?? [], [lostDeals]);
  const won = useMemo(() => wonDeals ?? [], [wonDeals]);
  const declinedCount = useMemo(() => lost.filter((p) => p.status === 'Declined').length, [lost]); // #774
  const stages = useMemo(() => data?.stages ?? [], [data]);

  // The RPC returns open stages only; terminal Won and Lost rows use their RLS-backed project reads.
  const kanbanProjects = useMemo(() => [...openProjects, ...won, ...lost], [openProjects, won, lost]);

  // Table rows scoped by Open / Won / Lost / Needs attention and funnel stage, then filtered by shared search (XG02-006, OE04-004)
  const filtered = useMemo(
    () =>
      filterPipelineTable({
        openProjects,
        wonProjects: won,
        lostProjects: lost,
        scope,
        selectedStatus,
        workingSet,
        search,
      }),
    [openProjects, won, lost, scope, selectedStatus, workingSet, search],
  );

  // Board rows span open ∪ won ∪ lost, filtered by classification and shared search (XG02-006, OE04-004)
  const kanbanFiltered = useMemo(
    () =>
      filterPipelineBoard({
        openProjects,
        wonProjects: won,
        lostProjects: lost,
        workingSet,
        search,
      }),
    [openProjects, won, lost, workingSet, search],
  );

  // Funnel projection model computing currency-safe stage totals and weighted forecast (XG02-006)
  const funnelProjection = useMemo(
    () => projectFunnelModel(stages, openProjects, orgCurrency),
    [stages, openProjects, orgCurrency],
  );

  // Display labels for the scope segments. The VALUES stay literal — they drive `filtered`'s
  // branch and terminal-query error gates below.
  const scopeLabels: Record<DealScope, string> = {
    Open: t('sales.scope.open', 'Open'),
    Won: t('sales:scope.won', 'Won'),
    Lost: declinedCount > 0
      ? t('sales.lostCounts', 'Lost {{lost}} · Declined {{declined}}', { lost: lost.length - declinedCount, declined: declinedCount })
      : t('sales.scope.lost', 'Lost'),
    'Needs attention': t('sales.scope.needsAttention', 'Needs attention'),
  };

  const onOpen = (p: PipelineProject) => openOpportunity(openRecord, p);
  const onScopeChange = (nextScope: DealScope) =>
    setWorkingSet((ws) => ({
      ...ws,
      scope: nextScope,
      ...(nextScope === 'Lost' || nextScope === 'Won' ? { status: '' } : {}),
    }));
  const onPhoneScopeChange = (nextScope: DealScope) =>
    setWorkingSet((ws) => ({
      ...ws,
      scope: nextScope,
      ...(nextScope === 'Lost' || nextScope === 'Won' ? { status: '' } : {}),
      // The URL codec only allows a non-Open scope on the table view; the phone still shows its list.
      ...(nextScope !== 'Open' ? { view: 'table' as const } : {}),
    }));

  /** Board title for the stage (Pre-Qual, not "PQ Submitted"); other statuses use their own label. */
  const stageName = React.useCallback(
    (status: PipelineProject['status']) => {
      const col = status === 'Declined' ? undefined : SALES_COLUMNS.find((c) => c.statuses.includes(status));
      return col ? stageLabel(col) : projectStatusLabel(status);
    },
    [stageLabel, projectStatusLabel],
  );

  const { tableColumns, exportColumns } = useMemo(
    () => buildPipelineColumns({ t, stageName }),
    [t, stageName],
  );

  const classificationsActive = activeClassificationCount(workingSet) > 0;
  // The Classification disclosure earns its place only when some deal carries a tag (or a filter is
  // already active, so it can be cleared).
  const hasClassification = classificationsActive || kanbanProjects.some((p) =>
    p.service_line || p.sector || p.location || p.award_type || p.bidding_entity);
  const filtersActive = classificationsActive || search.trim() !== '' || scope !== 'Open' || stageIndex !== null;
  const narrowedWithinScope = classificationsActive || search.trim() !== '' || stageIndex !== null;

  // #682/#683: Clear all is ONE working-set update plus the search reset, so the URL and
  // controls move together (no second event drops the first call). Shared by the table's
  // DataTable `emptyAction` and the board's zero-match ListState below.
  const [classificationResetToken, setClassificationResetToken] = useState(0);
  const clearFilters = () => {
    setSearch('');
    setClassificationResetToken((n) => n + 1);
    setWorkingSet(() => parseListWorkingSet('sales', '', { sessionView: readPipelineView() }));
  };

  // ── States ────────────────────────────────────────────────────────────────
  // PGA05-006: Empty only when there are no open, won, or lost deals AND no terminal errors.
  // Gate genuinely empty on lost query completion.
  const state: 'loading' | 'empty' | 'error' | undefined = isPending || wonPending || lostPending
    ? 'loading'
    : isError || !data
      ? 'error'
      : openProjects.length === 0 && lost.length === 0 && won.length === 0 && !wonError && !lostError
        ? 'empty'
        : undefined;

  // PGA05-007: active presentation export selection — desktop board exports kanbanFiltered,
  // table/mobile views export scope-filtered rows.
  const exportRows = isDesktop && view === 'kanban' ? kanbanFiltered : filtered;

  // A-4 page view-gate (after all hooks — Rules of Hooks): a denied role (Engineer) gets the
  // shared access-denied surface, not the pipeline board.
  if (!canViewSales) {
    return (
      <AccessDenied
        title={t('sales.accessDenied.title', "You don't have access to the Sales Pipeline")}
        sub={t(
          'sales.accessDenied.sub',
          'The Sales Pipeline is available to managers and finance. Your work lives on your dashboard, projects, and tasks.',
        )}
        onBack={() => navigate('/')}
      />
    );
  }

  return (
    <ListPage
      title={t('shell.nav.sales', 'Sales Pipeline')}
      bodyPanel
      /* B-3 (AC-W2-IXD-005): the natural place to start a project is the Pipeline where
         pre-win projects live — not the Projects list. Opens the one-step
         create page (#806; same page as Projects). Gated on can('create','project')
         = DELIVERY (Admin·Exec·PM); Finance views but cannot start projects per §C. */
      primaryAction={
        canCreate && (
          <Button variant="primary" onClick={() => openRecord('/projects/new', 'projects')}>
            <Icon name="plus" />
            {t('sales.newProject', 'New project')}
          </Button>
        )
      }
      banner={
        <>
          {/* Weighted funnel summary band — the Pipeline's stage-summary, above the toolbar. */}
          {state === 'loading' && isDesktop ? (
            <div className="panel-card mb-4 p-[var(--panel-inset)]">
              <ListState variant="loading" rows={2} />
            </div>
          ) : state === undefined && isDesktop ? (
            <PipelineFunnel
              projection={funnelProjection}
              selectedIndex={stageIndex}
              stageLabel={stageLabel}
              onSelectStage={(nextStatus) => {
                setWorkingSet((ws) => ({
                  ...ws,
                  status: ws.status === nextStatus ? '' : (nextStatus ?? ''),
                }));
              }}
            />
          ) : null}
        </>
      }
      mobileToolbar={state !== 'loading' && (
        <div className="w-full min-w-0 space-y-2">
          {view === 'kanban' && !isDesktop && scope !== 'Lost' && scope !== 'Won' && (
            <label className="flex min-w-0 items-center gap-2 text-sm font-medium text-foreground">
              <span className="shrink-0">{t('uxs24.stageLabel', 'Pipeline stage')}</span>
              <select
                data-testid="sales-phone-stage-selector"
                aria-label={t('uxs24.stageLabel', 'Pipeline stage')}
                value={selectedStatus ?? ''}
                onChange={(event) => {
                  const status = event.currentTarget.value as OpenFunnelStage | '';
                  setWorkingSet((ws) => ({ ...ws, scope: 'Open', status }));
                }}
                className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <option value="">{t('uxs24.allStages', 'All stages')}</option>
                {OPEN_COLUMNS.map((column) => {
                  const status = column.statuses[0] as OpenFunnelStage;
                  return <option key={status} value={status}>{stageLabel(column)}</option>;
                })}
              </select>
            </label>
          )}
          <div className="max-w-full overflow-x-auto scroll-fade-x">
            <ViewToggle<DealScope>
              options={DEAL_SCOPES.map((s) => ({ value: s, label: scopeLabels[s] }))}
              value={scope} onChange={onPhoneScopeChange}
              ariaLabel={t('sales.scopeToggleLabel', 'Project scope')}
            />
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <SearchMini placeholder={t('sales.search.placeholder', 'Search projects…')}
              aria-label={t('sales.search.label', 'Search projects')} value={search}
              onChange={(e) => setSearch(e.target.value)} containerClassName="min-w-0! flex-1" className="min-w-0" />
          </div>
          {hasClassification && (
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <ProjectClassificationFilters rows={kanbanProjects} value={workingSet}
                onChange={(patch) => setWorkingSet((ws) => ({ ...ws, ...patch }))} inlineTrigger resetToken={classificationResetToken} />
            </div>
          )}
        </div>
      )}
      filters={
        state !== 'loading' &&
        /* Won / Lost scope — table-only (the kanban already shows both terminal columns). */
        view === 'table' && (
          <ViewToggle<DealScope>
            options={DEAL_SCOPES.map((s) => ({ value: s, label: scopeLabels[s] }))}
            value={scope}
            onChange={onScopeChange}
            ariaLabel={t('sales.scopeToggleLabel', 'Project scope')}
          />
        )
      }
      secondaryFilter={state !== 'loading' && hasClassification && (
        <ProjectClassificationFilters
          rows={kanbanProjects}
          value={workingSet}
          onChange={(patch) => setWorkingSet((ws) => ({ ...ws, ...patch }))}
          resetToken={classificationResetToken}
        />
      )}
      search={
        state !== 'loading' && (
          <SearchMini
            placeholder={t('sales.search.placeholder', 'Search projects…')}
            aria-label={t('sales.search.label', 'Search projects')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            containerClassName="max-sm:basis-full max-sm:w-full max-sm:min-w-0"
          />
        )
      }
      /* PGA05-007: Export live xlsx uses active presentation rows (kanbanFiltered for board, filtered for table) */
      exportAction={
        state !== 'loading' && (
          <ExportButton rows={exportRows} columns={exportColumns} entity="Pipeline" />
        )
      }
      view={
        state !== 'loading' && (
          <ViewToggle
            options={[
              { value: 'kanban', label: t('sales.view.board', 'Board'), icon: 'cards' },
              { value: 'table', label: t('sales.view.table', 'Table'), icon: 'table' },
            ]}
            value={view}
            onChange={onViewChange}
            ariaLabel={t('sales.viewToggleLabel', 'Pipeline view')}
          />
        )
      }
    >
      <PipelineResults
        state={state}
        view={view}
        isDesktop={isDesktop}
        scope={scope}
        filtered={filtered}
        kanbanFiltered={kanbanFiltered}
        tableColumns={tableColumns}
        onOpen={onOpen}
        stageIndex={stageIndex}
        selectedStatus={selectedStatus}
        wonError={wonError}
        lostError={lostError}
        refetchPipeline={refetch}
        refetchWon={refetchWon}
        refetchLost={refetchLost}
        clearFilters={clearFilters}
        filtersActive={filtersActive}
        narrowedWithinScope={narrowedWithinScope}
        classificationsActive={classificationsActive}
        search={search}
      />
    </ListPage>
  );
};

export default SalesPipeline;
