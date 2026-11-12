import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useSalesStageLabel, useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { usePermission } from '@/src/auth/usePermission';
import { useSalesPipeline, useLostDeals, useWonDeals } from '@/src/hooks/useDashboard';
import { readPipelineView, writePipelineView, type PipelineView } from '@/src/hooks/usePipelineView';
import { useListWorkingSet, useUrlSearchInput } from '@/src/hooks/useListWorkingSet';
import { useListReturn } from '@/src/hooks/useListReturn';
import { parseListWorkingSet } from '@/src/lib/listWorkingSet';
import { activeClassificationCount } from '@/src/lib/projectClassification';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { SALES_COLUMNS, openOpportunity, type OpenFunnelStage } from '../../components/salesPipeline';
import { DEAL_SCOPES, filterPipelineBoard, filterPipelineTable, type DealScope } from '../sales-pipeline/pipelineListModel';
import { OPEN_COLUMNS, projectFunnelModel } from '../sales-pipeline/pipelineFunnelModel';
import { buildPipelineColumns } from '../sales-pipeline/pipelineColumns';

export function useSalesModel() {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const stageLabel = useSalesStageLabel();
  const projectStatusLabel = useProjectStatusLabel();
  const orgCurrency = useOrgCurrency();
  const may = usePermission();
  const navigate = useNavigate();
  const canViewSales = may('transition', 'project');
  const canCreate = may('create', 'project');

  const open = useSalesPipeline();
  const lostQ = useLostDeals();
  const wonQ = useWonDeals();
  const { workingSet, setWorkingSet } = useListWorkingSet('sales', { sessionView: readPipelineView() });
  const [search, setSearch] = useUrlSearchInput(workingSet.q, (q) => setWorkingSet((ws) => ({ ...ws, q })));
  const { openRecord } = useListReturn({ list: 'sales', contentReady: !open.isPending && !open.isError });

  const scope = workingSet.scope as DealScope;
  const view: PipelineView = isDesktop ? workingSet.view : 'kanban';
  const setView = (v: PipelineView) => {
    writePipelineView(v);
    setWorkingSet((ws) => ({ ...ws, view: v }));
  };
  const selectedStatus: OpenFunnelStage | null = (workingSet.status as OpenFunnelStage | '') || null;
  const stageIndex = useMemo(() => {
    if (selectedStatus === null) return null;
    const idx = OPEN_COLUMNS.findIndex((c) => c.statuses.includes(selectedStatus));
    return idx >= 0 ? idx : null;
  }, [selectedStatus]);

  const openProjects = useMemo(() => open.data?.projects ?? [], [open.data]);
  const lost = useMemo(() => lostQ.data ?? [], [lostQ.data]);
  const won = useMemo(() => wonQ.data ?? [], [wonQ.data]);
  const stages = useMemo(() => open.data?.stages ?? [], [open.data]);
  const declinedCount = useMemo(() => lost.filter((p) => p.status === 'Declined').length, [lost]);
  const allDeals = useMemo(() => [...openProjects, ...won, ...lost], [openProjects, won, lost]);

  const scopeRows = useMemo(
    () => filterPipelineTable({ openProjects, wonProjects: won, lostProjects: lost, scope, selectedStatus }),
    [openProjects, won, lost, scope, selectedStatus],
  );
  const filtered = useMemo(
    () => filterPipelineTable({ openProjects, wonProjects: won, lostProjects: lost, scope, selectedStatus, workingSet, search }),
    [openProjects, won, lost, scope, selectedStatus, workingSet, search],
  );
  const boardRows = useMemo(
    () => filterPipelineBoard({ openProjects, wonProjects: won, lostProjects: lost, workingSet, search }),
    [openProjects, won, lost, workingSet, search],
  );
  const funnel = useMemo(() => projectFunnelModel(stages, openProjects, orgCurrency), [stages, openProjects, orgCurrency]);

  const stageName = (status: PipelineProject['status']) => {
    const col = status === 'Declined' ? undefined : SALES_COLUMNS.find((c) => c.statuses.includes(status));
    return col ? stageLabel(col) : projectStatusLabel(status);
  };
  const { tableColumns, exportColumns } = useMemo(
    () => buildPipelineColumns({ t }),
    [t],
  );

  const [classificationResetToken, setClassificationResetToken] = useState(0);
  const classificationsActive = activeClassificationCount(workingSet) > 0;
  const hasClassification = classificationsActive || allDeals.some((p) =>
    p.service_line || p.sector || p.location || p.award_type || p.bidding_entity);
  const filtersActive = classificationsActive || search.trim() !== '' || scope !== 'All' || stageIndex !== null;
  const narrowedWithinScope = classificationsActive || search.trim() !== '' || stageIndex !== null;
  const clearFilters = () => {
    setSearch('');
    setClassificationResetToken((n) => n + 1);
    setWorkingSet(() => parseListWorkingSet('sales', '', { sessionView: readPipelineView() }));
  };
  const setScope = (next: DealScope) =>
    setWorkingSet((ws) => ({
      ...ws,
      scope: next,
      ...(next === 'Lost' || next === 'Won' ? { status: '' } : {}),
      ...(!isDesktop && next !== 'All' ? { view: 'table' as const } : {}),
    }));
  const selectStage = (status: OpenFunnelStage | '') =>
    setWorkingSet((ws) => ({ ...ws, status: ws.status === status ? '' : status }));

  const state: 'loading' | 'empty' | 'error' | undefined =
    open.isPending || wonQ.isPending || lostQ.isPending ? 'loading'
      : open.isError || !open.data ? 'error'
        : openProjects.length === 0 && lost.length === 0 && won.length === 0 && !wonQ.isError && !lostQ.isError ? 'empty'
          : undefined;

  const scopeLabels: Record<DealScope, string> = {
    All: t('sales:scope.all', 'All'),
    Open: t('sales.scope.open', 'Open'),
    Won: t('sales:scope.won', 'Won'),
    Lost: declinedCount > 0
      ? t('sales.lostCounts', 'Lost {{lost}} · Declined {{declined}}', { lost: lost.length - declinedCount, declined: declinedCount })
      : t('sales.scope.lost', 'Lost'),
    'Needs attention': t('sales.scope.needsAttention', 'Needs attention'),
  };

  return {
    t, isDesktop, navigate, canViewSales, canCreate, orgCurrency,
    open, lostQ, wonQ, state,
    workingSet, setWorkingSet, search, setSearch, openRecord,
    scope, setScope, scopeLabels, DEAL_SCOPES, view, setView,
    selectedStatus, stageIndex, selectStage,
    openProjects, won, lost, allDeals, stages,
    scopeRows, filtered, boardRows, funnel,
    tableColumns, exportColumns, stageLabel, stageName,
    classificationResetToken, classificationsActive, hasClassification, filtersActive, narrowedWithinScope, clearFilters,
    onOpen: (p: PipelineProject) => openOpportunity(openRecord, p),
  };
}
export type SalesModel = ReturnType<typeof useSalesModel>;
