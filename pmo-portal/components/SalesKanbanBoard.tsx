import React from 'react';
import { Kanban, KanbanColumn, KanbanCard, StatusPill, Badge } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import {
  SALES_COLUMNS,
  weightedValue,
  pillVariantForStatus,
  formatPercent,
  type SalesColumn,
} from './salesPipeline';

interface SalesKanbanBoardProps {
  projects: PipelineProject[];
  /** Drill into a deal's opportunity detail (opens a workspace record tab). */
  onOpen: (project: PipelineProject) => void;
  /** Currently-open opportunity id — highlights its card. */
  selectedId?: string;
}

/** A single deal card (DESIGN.md "Kanban Card" signature). */
const DealCard: React.FC<{
  project: PipelineProject;
  dotColor: string;
  selected: boolean;
  onActivate: () => void;
}> = ({ project, dotColor, selected, onActivate }) => {
  const initial = (project.client_name ?? project.name).trim().charAt(0).toUpperCase() || '•';
  return (
    <KanbanCard selected={selected} onActivate={onActivate} aria-label={`Open ${project.name}`}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-md text-[12px] font-bold text-white"
          style={{ background: dotColor }}
        >
          {initial}
        </span>
        <Badge className="min-w-0 px-1.5">{formatPercent(project.win_probability)}</Badge>
      </div>
      <div className="line-clamp-2 text-[13px] font-semibold leading-snug" title={project.name}>
        {project.name}
      </div>
      <div className="mt-0.5 truncate text-[12px] text-muted-foreground">
        {project.client_name ?? '—'}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[15px] font-bold tabular">{formatCurrency(project.contract_value)}</span>
        <span className="text-[11px] text-muted-foreground tabular">
          {formatCurrency(weightedValue(project))} wtd
        </span>
      </div>
      <div className="mt-2.5 flex items-center justify-between border-t border-border/70 pt-2">
        <StatusPill variant={pillVariantForStatus(project.status)}>{project.status}</StatusPill>
      </div>
    </KanbanCard>
  );
};

/** Two-figure column totals node (gross + weighted), tabular. */
const ColumnTotals: React.FC<{ gross: number; weighted: number }> = ({ gross, weighted }) => (
  <>
    <span className="text-[13px] font-bold tabular">{formatCurrency(gross)}</span>
    <span className="text-[11px] text-muted-foreground tabular">{formatCurrency(weighted)} wtd</span>
  </>
);

/**
 * The IA-3 sales pipeline board: six fixed columns (five open stages + one
 * terminal Won/Lost), reusing the Foundation Kanban shell. Cards are
 * keyboard-activatable and drill into the opportunity detail page. Tokens only —
 * the per-stage dot colors are the sole sanctioned categorical literals (§3.1).
 */
const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects, onOpen, selectedId }) => {
  const byColumn = (col: SalesColumn) => projects.filter((p) => col.statuses.includes(p.status));

  return (
    <Kanban aria-label="Sales pipeline board">
      {SALES_COLUMNS.map((col) => {
        const colProjects = byColumn(col);
        const gross = colProjects.reduce((s, p) => s + p.contract_value, 0);
        const weighted = colProjects.reduce((s, p) => s + weightedValue(p), 0);
        return (
          <div key={col.title} data-testid={col.testId} className="flex min-w-0 flex-col">
            <KanbanColumn
              title={col.title}
              dotColor={col.dotColor}
              count={colProjects.length}
              totals={!col.terminal ? <ColumnTotals gross={gross} weighted={weighted} /> : undefined}
              emptyMessage={`No deals in ${col.title}`}
            >
              {colProjects.map((p) => (
                <DealCard
                  key={p.id}
                  project={p}
                  dotColor={col.dotColor}
                  selected={p.id === selectedId}
                  onActivate={() => onOpen(p)}
                />
              ))}
            </KanbanColumn>
          </div>
        );
      })}
    </Kanban>
  );
};

export default SalesKanbanBoard;
