import React, { useCallback, useRef, useState } from 'react';
import { Kanban, KanbanColumn, KanbanCard, KanbanStageIndicator, StatusPill, Badge } from '@/src/components/ui';
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
 *
 * PR-3 mobile hardening (OD-W4-2, AC-IXD-MOBILE-W4-PR3-C5):
 *   - The `.kanban-scroll` CSS now has `scroll-snap-type: x mandatory` (index.css)
 *     so columns land cleanly one-at-a-time on a phone. Desktop is unchanged.
 *   - A `KanbanStageIndicator` strip above the board shows which column is in view
 *     and lets the user jump to a column by tapping. The strip is `md:hidden` so
 *     it appears only on narrow viewports (the full column headers are visible
 *     on desktop, making the indicator redundant there).
 *   - The indicator tracks scroll position via an `onScroll` handler passed DIRECTLY
 *     to the `<Kanban>` primitive. `<Kanban>` spreads `...rest` onto its outermost
 *     `.kanban-scroll` div, so the listener attaches to the actual scrolling element.
 *     CRITICAL: scroll events do NOT bubble — attaching onScroll to any ancestor div
 *     would silently never fire on a swipe gesture (was the Defect-1 bug pre-fix).
 *   - `scrollWrapRef` on the outer wrapper is kept for `handleStageClick`'s programmatic
 *     `scrollEl.scrollTo(...)` — it locates `.kanban-scroll` via querySelector.
 */
const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = ({ projects, onOpen, selectedId }) => {
  const byColumn = (col: SalesColumn) => projects.filter((p) => col.statuses.includes(p.status));
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  // Wrapper ref used by handleStageClick to locate .kanban-scroll for programmatic scrollTo.
  // The scroll LISTENER is NOT on this wrapper — it's on <Kanban> (= .kanban-scroll) directly,
  // because scroll events do not bubble.
  const scrollWrapRef = useRef<HTMLDivElement>(null);
  // Refs to each column div — used for programmatic scroll-to-column
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Detect which column is nearest the left edge of the scroll container.
  // NOTE: this handler MUST be attached to the actual .kanban-scroll element —
  // scroll events do not bubble, so a parent wrapper's onScroll never fires.
  // We pass this directly to <Kanban> which spreads ...rest onto .kanban-scroll.
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollLeft = e.currentTarget.scrollLeft;
    // Find the column whose left offset is closest to scrollLeft
    let bestIdx = 0;
    let bestDist = Infinity;
    colRefs.current.forEach((col, i) => {
      if (!col) return;
      const dist = Math.abs(col.offsetLeft - scrollLeft);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });
    setActiveStageIndex(bestIdx);
  }, []);

  // Scroll to a specific column when the stage indicator button is tapped.
  const handleStageClick = useCallback((index: number) => {
    const wrap = scrollWrapRef.current;
    if (!wrap) return;
    const scrollEl = wrap.querySelector('.kanban-scroll') as HTMLElement | null;
    const col = colRefs.current[index];
    if (!scrollEl || !col) return;
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scrollEl.scrollTo({
      left: col.offsetLeft,
      behavior: prefersReduced ? 'instant' : 'smooth',
    });
    setActiveStageIndex(index);
  }, []);

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
    </div>
  );
};

export default SalesKanbanBoard;
