/**
 * ProjectKanbanBoard — Projects index kanban view grouped by lifecycle status.
 *
 * READ-ONLY v1 (no drag-to-change-status). Reuses the Foundation Kanban shell
 * (Kanban / KanbanColumn / KanbanCard / KanbanStageIndicator) — NO new board engine.
 *
 * Five lifecycle columns in order (sourced from ACTIVE_PROJECT_STATUSES):
 *   Won          → Won, Pending KoM
 *   Ongoing      → Ongoing Project
 *   On Hold      → On Hold
 *   Close Out    → Close Out
 *   Internal     → Internal Project
 *
 * Mobile @390: horizontal-scroll board with scroll-snap + KanbanStageIndicator
 * (contained within the board div — no page overflow). DESIGN.md tokens only;
 * no raw hex. Status identity via shape/style + legend, not color-only (One Blue Rule).
 *
 * AC coverage: AC-PK-001 (columns in lifecycle DOM order), AC-PK-002 (a project
 * lands ONLY in its status column — exclusivity), AC-PK-003 (card click → onOpen
 * → navigate), AC-PK-004 (empty column header renders), AC-PK-006 (keyboard:
 * focus card + Enter → onOpen), AC-PK-009 (card shows name/customer/PM).
 */
import React from 'react';
import {
  Kanban,
  KanbanColumn,
  KanbanCard,
  KanbanStageIndicator,
  StatusPill,
  type KanbanStageItem,
} from '@/src/components/ui';
import { useKanbanMobileScroll } from '@/src/components/kanban/useKanbanMobileScroll';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus, projectIconColor } from './projects';

// ---------------------------------------------------------------------------
// Column definitions — lifecycle order, DESIGN.md tokens for dot colors.
// Each maps one or more `projects.status` values into a board column.
// Dot colors: one-blue only for active execution ("Ongoing"); others use
// muted semantic tokens that don't clash with the One Blue Rule.
// ---------------------------------------------------------------------------

interface ProjectKanbanColDef {
  /** Display title */
  title: string;
  /** The project.status values that belong in this column. */
  statuses: string[];
  /** DESIGN.md token for the column dot (color-not-only: label also identifies the column). */
  dotColor: string;
  /** data-testid for the column wrapper (for AC-tagged RTL queries). */
  testId: string;
  /** KanbanStageItem for the mobile indicator strip. */
  stageItem: KanbanStageItem;
}

const PROJECT_KANBAN_COLUMNS: ProjectKanbanColDef[] = [
  {
    title: 'Won',
    statuses: ['Won, Pending KoM'],
    dotColor: 'hsl(var(--success))',
    testId: 'kanban-col-won',
    stageItem: { title: 'Won', dotColor: 'hsl(var(--success))' },
  },
  {
    title: 'Ongoing',
    statuses: ['Ongoing Project'],
    // The one interactive blue — active execution (One Blue Rule allows for status identity).
    dotColor: 'hsl(var(--primary))',
    testId: 'kanban-col-ongoing',
    stageItem: { title: 'Ongoing', dotColor: 'hsl(var(--primary))' },
  },
  {
    title: 'On Hold',
    statuses: ['On Hold'],
    dotColor: 'hsl(var(--warning))',
    testId: 'kanban-col-onhold',
    stageItem: { title: 'On Hold', dotColor: 'hsl(var(--warning))' },
  },
  {
    title: 'Close Out',
    statuses: ['Close Out'],
    dotColor: 'hsl(var(--success))',
    testId: 'kanban-col-closeout',
    stageItem: { title: 'Close Out', dotColor: 'hsl(var(--success))' },
  },
  {
    title: 'Internal',
    statuses: ['Internal Project'],
    dotColor: 'hsl(var(--muted-foreground))',
    testId: 'kanban-col-internal',
    stageItem: { title: 'Internal', dotColor: 'hsl(var(--muted-foreground))' },
  },
];

// ---------------------------------------------------------------------------
// ProjectKanbanCard — a single project card in the kanban view.
// Mirrors ProjectCard fields: name, customer, PM, contract value, status pill.
// ---------------------------------------------------------------------------

interface ProjectKanbanCardProps {
  project: ProjectWithRefs;
  onActivate: () => void;
}

const ProjectKanbanCard: React.FC<ProjectKanbanCardProps> = ({ project, onActivate }) => {
  const initial = (project.name.trim().charAt(0) || '•').toUpperCase();
  return (
    <KanbanCard onActivate={onActivate} aria-label={project.name}>
      <div className="mb-2 flex items-start gap-2">
        <span
          aria-hidden
          className="grid size-[26px] shrink-0 place-items-center rounded-md text-[12px] font-bold text-white"
          style={{ background: projectIconColor() }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          {/* No inner button — the KanbanCard (role="button") is the single
              activation target (a11y: avoids a button nested in role=button). */}
          <div
            className="block max-w-full truncate text-[13px] font-semibold text-foreground"
            title={project.name}
          >
            {project.name}
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {project.client?.name ?? '—'}
          </div>
        </div>
      </div>

      <div className="text-[12px] font-bold tabular">{formatCurrency(project.contract_value)}</div>

      <div className="mt-2 flex items-center justify-between border-t border-border/70 pt-2">
        <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>
          {project.status}
        </StatusPill>
        {project.pm?.full_name && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className="grid size-[16px] shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
            >
              {(project.pm.full_name.trim().charAt(0) ?? '?').toUpperCase()}
            </span>
            <span className="max-w-[14ch] truncate">{project.pm.full_name}</span>
          </span>
        )}
      </div>
    </KanbanCard>
  );
};

// ---------------------------------------------------------------------------
// ProjectKanbanBoard
// ---------------------------------------------------------------------------

export interface ProjectKanbanBoardProps {
  /** Role-scoped, pre-filtered projects from useProjects() — the board just groups them. */
  projects: ProjectWithRefs[];
  /** Drill into a project's detail (mirrors SalesKanbanBoard's contract). */
  onOpen: (project: ProjectWithRefs) => void;
}

/**
 * Groups `projects` by status into the five lifecycle columns and renders a
 * horizontally-scrollable kanban board. Read-only v1 — no drag-to-change-status.
 *
 * Mobile UX: scroll-snap columns + KanbanStageIndicator strip (md:hidden) so a
 * phone user can see which column is in view and jump to another — provided by
 * the shared `useKanbanMobileScroll` hook (also used by SalesKanbanBoard). The
 * scroll listener is attached directly to <Kanban> (= the .kanban-scroll element)
 * — scroll events do NOT bubble, so a parent wrapper's onScroll would never fire
 * on a swipe gesture (Defect-1 precedent).
 */
const ProjectKanbanBoard: React.FC<ProjectKanbanBoardProps> = ({ projects, onOpen }) => {
  const { activeStageIndex, scrollWrapRef, colRefs, onScroll, handleStageClick } =
    useKanbanMobileScroll();

  return (
    <div ref={scrollWrapRef} data-testid="project-kanban-board">
      {/* Mobile stage indicator — hidden on md+ (KanbanStageIndicator adds md:hidden). */}
      <KanbanStageIndicator
        stages={PROJECT_KANBAN_COLUMNS.map((c) => c.stageItem)}
        activeIndex={activeStageIndex}
        onStageClick={handleStageClick}
      />

      {/* Board: onScroll attached directly to <Kanban> so it lands on .kanban-scroll. */}
      <Kanban aria-label="Projects kanban board" onScroll={onScroll}>
        {PROJECT_KANBAN_COLUMNS.map((col, colIdx) => {
          const colProjects = projects.filter((p) => col.statuses.includes(p.status as string));
          return (
            <div
              key={col.testId}
              ref={(el) => { colRefs.current[colIdx] = el; }}
              data-testid={col.testId}
              className="flex min-w-0 flex-col"
            >
              <KanbanColumn
                title={col.title}
                dotColor={col.dotColor}
                count={colProjects.length}
                emptyMessage={`No projects in ${col.title}`}
              >
                {colProjects.map((p) => (
                  <ProjectKanbanCard
                    key={p.id}
                    project={p}
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

export default ProjectKanbanBoard;
