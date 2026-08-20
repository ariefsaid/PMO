import React from 'react';
import { Kanban, KanbanColumn, KanbanStageIndicator, StatusPill, Badge } from '@/src/components/ui';
import { useKanbanMobileScroll } from '@/src/components/kanban/useKanbanMobileScroll';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { formatCurrency } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import ProjectCardShell from './ProjectCardShell';
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

/**
 * A single deal card — renders the canonical ProjectCardShell (CW-3b, `kanban`
 * variant), the SAME visual vocabulary as the Projects cards-view and kanban. A
 * deal IS a project, so it shares ONE card; the PIPELINE-lens content (win
 * probability + gross/weighted value) rides in the body slot, status in the head.
 */
const DealCard: React.FC<{
  project: PipelineProject;
  selected: boolean;
  onActivate: () => void;
  /** ⚑ FR-L10N-020, and an honest limitation rather than a choice: `get_sales_pipeline()` (0020)
   *  returns no `currency` column, so a pipeline card cannot use the project's OWN currency the way
   *  `ProjectCard` does — it takes the org default, threaded from the board. Adding `currency` to
   *  that RPC's projection is what would make this per-record; until then a foreign-currency deal
   *  renders in the org's denomination on this surface. Recorded rather than hidden. */
  currency: string;
}> = ({ project, selected, onActivate, currency }) => {
  const initial = (project.client_name ?? project.name).trim().charAt(0).toUpperCase() || '•';
  return (
    <ProjectCardShell
      variant="kanban"
      selected={selected}
      initial={initial}
      name={project.name}
      client={project.client_name}
      status={
        <StatusPill variant={pillVariantForStatus(project.status)}>{project.status}</StatusPill>
      }
      body={
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tabular">
              {formatCurrency(project.contract_value, currency)}
            </span>
            <span className="text-[11px] text-muted-foreground tabular">
              {formatCurrency(weightedValue(project), currency)} wtd
            </span>
          </div>
          <Badge className="min-w-0 px-1.5">{formatPercent(project.win_probability)}</Badge>
        </div>
      }
      onOpen={onActivate}
    />
  );
};

/** Two-figure column totals node (gross + weighted), tabular.
 *  ⚑ FR-L10N-020: a COLUMN TOTAL sums across projects, so it has no single record currency of its
 *  own — it is denominated in the org default, threaded from the board rather than read here.
 *  A total that mixed currencies would be arithmetic nobody can defend and it would still render;
 *  that is a separate multi-currency problem (OD-CR-5), and this prop is where it will surface. */
const ColumnTotals: React.FC<{ gross: number; weighted: number; currency: string }> = ({ gross, weighted, currency }) => (
  <>
    <span className="text-[13px] font-bold tabular">{formatCurrency(gross, currency)}</span>
    <span className="text-[11px] text-muted-foreground tabular">{formatCurrency(weighted, currency)} wtd</span>
  </>
);

/**
 * The IA-3 sales pipeline board: six fixed columns (five open stages + one
 * terminal Won/Lost), reusing the Foundation Kanban shell. Cards are
 * keyboard-activatable and drill into the opportunity detail page. Tokens only —
 * the per-stage dot colors are the sole sanctioned categorical literals (§3.1).
 *
 * PR-3 mobile hardening (OD-W4-2, AC-IXD-MOBILE-W4-PR3-C5):
 *   - The `.kanban-scroll` CSS now has `scroll-snap-type: x mandatory` (index.css)
 *     so columns land cleanly one-at-a-time on a phone. Desktop is unchanged.
 *   - A `KanbanStageIndicator` strip above the board shows which column is in view
 *     and lets the user jump to a column by tapping. The strip is `md:hidden` so
 *     it appears only on narrow viewports (the full column headers are visible
 *     on desktop, making the indicator redundant there).
 *   - Scroll tracking + programmatic scroll-to-column live in the shared
 *     `useKanbanMobileScroll` hook (also used by ProjectKanbanBoard). CRITICAL:
 *     scroll events do NOT bubble — `onScroll` is passed DIRECTLY to `<Kanban>`,
 *     which spreads it onto the actual `.kanban-scroll` element (was the Defect-1 bug).
 */
const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects, onOpen, selectedId }) => {
  // FR-L10N-020: the per-CARD figures use each project's own currency; the per-COLUMN totals sum
  // across projects and so have none, and take the org default.
  const orgCurrency = useOrgCurrency();
  const byColumn = (col: SalesColumn) => projects.filter((p) => col.statuses.includes(p.status));
  const { activeStageIndex, scrollWrapRef, colRefs, onScroll, handleStageClick } =
    useKanbanMobileScroll();

  // The five OPEN columns for the stage indicator (terminal Won/Lost are excluded —
  // the indicator is for navigating the pipeline, not the terminal archive columns).
  const openStages = SALES_COLUMNS.filter((c) => !c.terminal).map((c) => ({
    title: c.title,
    dotColor: c.dotColor,
  }));

  return (
    <div ref={scrollWrapRef}>
      {/* Stage-progress indicator — mobile-only (md:hidden via KanbanStageIndicator).
          Shows which of the five open pipeline columns is in view + allows jumping. */}
      <KanbanStageIndicator
        stages={openStages}
        activeIndex={activeStageIndex}
        onStageClick={handleStageClick}
      />

      {/* Kanban scroll wrapper — onScroll is passed directly to <Kanban> so it lands on
          the actual .kanban-scroll element. scroll events do NOT bubble, so attaching the
          handler to any ancestor wrapper would never fire on a swipe gesture. */}
      <Kanban aria-label="Sales pipeline board" onScroll={onScroll}>
        {SALES_COLUMNS.map((col, colIdx) => {
          const colProjects = byColumn(col);
          const gross = colProjects.reduce((s, p) => s + p.contract_value, 0);
          const weighted = colProjects.reduce((s, p) => s + weightedValue(p), 0);
          return (
            <div
              key={col.title}
              ref={(el) => { colRefs.current[colIdx] = el; }}
              data-testid={col.testId}
              className="flex min-w-0 flex-col"
            >
              <KanbanColumn
                title={col.title}
                dotColor={col.dotColor}
                count={colProjects.length}
                totals={!col.terminal ? <ColumnTotals gross={gross} weighted={weighted} currency={orgCurrency} /> : undefined}
                emptyMessage={`No projects in ${col.title}`}
              >
                {colProjects.map((p) => (
                  <DealCard
                    key={p.id}
                    project={p}
                    selected={p.id === selectedId}
                    onActivate={() => onOpen(p)}
                    currency={orgCurrency}
                  />
                ))}
              </KanbanColumn>
            </div>
          );
        })}
      </Kanban>
    </div>
  );
};

export default SalesKanbanBoard;
