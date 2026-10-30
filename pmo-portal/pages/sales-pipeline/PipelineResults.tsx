import React from 'react';
import { useTranslation } from 'react-i18next';
import { DataTable, ListState, type Column } from '@/src/components/ui';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import SalesKanbanBoard from '../../components/SalesKanbanBoard';
import type { PipelineView } from '@/src/hooks/usePipelineView';
import { ATTENTION_THRESHOLD_DAYS, type OpenFunnelStage } from '../../components/salesPipeline';
import type { DealScope } from './pipelineListModel';

export interface PipelineResultsProps {
  state: 'loading' | 'empty' | 'error' | undefined;
  view: PipelineView;
  isDesktop: boolean;
  scope: DealScope;
  filtered: PipelineProject[];
  kanbanFiltered: PipelineProject[];
  tableColumns: Column<PipelineProject>[];
  onOpen: (p: PipelineProject) => void;
  stageIndex: number | null;
  selectedStatus: OpenFunnelStage | null;
  wonError: boolean;
  lostError: boolean;
  refetchPipeline: () => void;
  refetchWon: () => void;
  refetchLost: () => void;
  clearFilters: () => void;
  filtersActive: boolean;
  narrowedWithinScope: boolean;
  classificationsActive: boolean;
  search: string;
}

export const PipelineResults: React.FC<PipelineResultsProps> = ({
  state,
  view,
  isDesktop,
  scope,
  filtered,
  kanbanFiltered,
  tableColumns,
  onOpen,
  stageIndex,
  selectedStatus,
  wonError,
  lostError,
  refetchPipeline,
  refetchWon,
  refetchLost,
  clearFilters,
  filtersActive,
  narrowedWithinScope,
  classificationsActive,
  search,
}) => {
  const { t } = useTranslation();

  if (state === 'loading') {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={6} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <ListState
        variant="error"
        title={t('sales.error.title', "Couldn't load the sales pipeline")}
        sub={t('sales.error.sub', 'Something went wrong fetching your pipeline.')}
        onRetry={refetchPipeline}
      />
    );
  }

  if (state === 'empty') {
    return (
      <ListState
        variant="empty"
        title={t('sales.empty.title', 'No projects yet')}
        sub={t('sales.empty.sub', 'Add a project to start tracking the pipeline.')}
      />
    );
  }

  // Desktop Board Presentation
  if (view === 'kanban' && isDesktop) {
    const boardZeroMatch = kanbanFiltered.length === 0;

    if (boardZeroMatch && !wonError && !lostError) {
      return (
        <ListState
          variant="empty"
          title={
            classificationsActive && search.trim() === ''
              ? t('sales.boardEmpty.classification.title', 'No projects match these classifications')
              : t('sales.tableEmpty.search.title', 'No projects match your search')
          }
          sub={
            classificationsActive && search.trim() === ''
              ? t('sales.boardEmpty.classification.sub', 'Clear a classification filter to see more projects.')
              : t('sales.tableEmpty.search.sub', 'Try a different name or customer.')
          }
          action={{ label: t('sales.tableEmpty.clearFilters', 'Clear filters'), onClick: clearFilters }}
        />
      );
    }

    return (
      <>
        {wonError && (
          <ListState
            variant="error"
            title={t('sales:wonError.title', "Couldn't load won projects")}
            sub={t('sales:wonError.sub', 'Something went wrong fetching won projects.')}
            onRetry={refetchWon}
          />
        )}
        {lostError && (
          <ListState
            variant="error"
            title={t('sales.lostError.title', "Couldn't load lost projects")}
            sub={t('sales.lostError.sub', 'Something went wrong fetching lost projects.')}
            onRetry={refetchLost}
          />
        )}
        <SalesKanbanBoard projects={kanbanFiltered} onOpen={onOpen} selectedStageIndex={stageIndex} />
      </>
    );
  }

  // Mobile Board/List Presentation
  if (view === 'kanban' && !isDesktop) {
    if (wonError && scope === 'Won') {
      return (
        <ListState
          variant="error"
          title={t('sales:wonError.title', "Couldn't load won projects")}
          sub={t('sales:wonError.sub', 'Something went wrong fetching won projects.')}
          onRetry={refetchWon}
        />
      );
    }

    if (lostError && (scope === 'Lost' || scope === 'Needs attention')) {
      return (
        <ListState
          variant="error"
          title={t('sales.lostError.title', "Couldn't load lost projects")}
          sub={t('sales.lostError.sub', 'Something went wrong fetching lost projects.')}
          onRetry={refetchLost}
        />
      );
    }

    if (filtered.length === 0) {
      return (
        <ListState
          variant="empty"
          title={
            scope === 'Won' && !narrowedWithinScope
              ? t('sales:tableEmpty.won.title', 'No won projects')
              : scope === 'Lost' && !narrowedWithinScope
                ? t('sales.tableEmpty.lost.title', 'No lost projects')
                : scope === 'Needs attention' && !narrowedWithinScope
                  ? t('sales.tableEmpty.needsAttention.title', 'No projects need attention')
                  : t('uxs24.stageEmptyTitle', 'No projects in this stage')
          }
          sub={
            scope === 'Won' && !narrowedWithinScope
              ? t('sales:tableEmpty.won.sub', 'Projects marked won will appear here.')
              : scope === 'Lost' && !narrowedWithinScope
                ? t('sales.tableEmpty.lost.sub', 'Projects marked lost will appear here.')
                : scope === 'Needs attention' && !narrowedWithinScope
                  ? t(
                      'sales.tableEmpty.needsAttention.sub',
                      'No project has been untouched for {{days}}+ days. Pipeline is active.',
                      { days: String(ATTENTION_THRESHOLD_DAYS) },
                    )
                  : t('uxs24.stageEmptyBody', 'Choose another stage or clear filters to see more projects.')
          }
          action={
            filtersActive
              ? { label: t('sales.tableEmpty.clearFilters', 'Clear filters'), onClick: clearFilters }
              : undefined
          }
        />
      );
    }

    return (
      <SalesKanbanBoard
        projects={filtered}
        onOpen={onOpen}
        presentation="list"
        selectedStatus={selectedStatus}
      />
    );
  }

  // Table Presentation
  if (wonError && scope === 'Won') {
    return (
      <ListState
        variant="error"
        title={t('sales:wonError.title', "Couldn't load won projects")}
        sub={t('sales:wonError.sub', 'Something went wrong fetching won projects.')}
        onRetry={refetchWon}
      />
    );
  }

  if (lostError && (scope === 'Lost' || scope === 'Needs attention')) {
    return (
      <ListState
        variant="error"
        title={t('sales.lostError.title', "Couldn't load lost projects")}
        sub={t('sales.lostError.sub', 'Something went wrong fetching lost projects.')}
        onRetry={refetchLost}
      />
    );
  }

  return (
    <DataTable<PipelineProject>
      embedded
      rows={filtered}
      columns={tableColumns}
      rowKey={(r) => r.id}
      onActivate={onOpen}
      rowLabel={(r) => `${t('sales.openRow', 'Open')} ${r.name}`}
      state={filtered.length === 0 ? 'empty' : undefined}
      emptyTitle={
        !narrowedWithinScope && scope === 'Won'
          ? t('sales:tableEmpty.won.title', 'No won projects')
          : !narrowedWithinScope && scope === 'Lost'
            ? t('sales.tableEmpty.lost.title', 'No lost projects')
            : !narrowedWithinScope && scope === 'Needs attention'
              ? t('sales.tableEmpty.needsAttention.title', 'No projects need attention')
              : t('sales.tableEmpty.search.title', 'No projects match your search')
      }
      emptySub={
        !narrowedWithinScope && scope === 'Won'
          ? t('sales:tableEmpty.won.sub', 'Projects marked won will appear here.')
          : !narrowedWithinScope && scope === 'Lost'
            ? t('sales.tableEmpty.lost.sub', 'Projects marked lost will appear here.')
            : !narrowedWithinScope && scope === 'Needs attention'
              ? t(
                  'sales.tableEmpty.needsAttention.sub',
                  'No project has been untouched for {{days}}+ days. Pipeline is active.',
                  { days: String(ATTENTION_THRESHOLD_DAYS) },
                )
              : t('sales.tableEmpty.search.sub', 'Try a different name or customer.')
      }
      emptyAction={
        filtersActive
          ? { label: t('sales.tableEmpty.clearFilters', 'Clear filters'), onClick: clearFilters }
          : undefined
      }
      tableId="salespipeline-table"
    />
  );
};
