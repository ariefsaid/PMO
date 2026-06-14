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
  KanbanStageIndicator,
  StatusPill,
  type KanbanStageItem,
} from '@/src/components/ui';
import { useKanbanMobileScroll } from '@/src/components/kanban/useKanbanMobileScroll';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus } from './projects';
import ProjectCardShell from './ProjectCardShell';

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
// Renders the canonical ProjectCardShell (CW-3b, `kanban` variant) — the SAME
// visual vocabulary as the cards-view and Sales board. Delivery-lens content:
// contract value + status pill + PM, with the column status as the head slot.
// ---------------------------------------------------------------------------

interface ProjectKanbanCardProps {
  project: ProjectWithRefs;
  onActivate: () => void;
}

const ProjectKanbanCard: React.FC<ProjectKanbanCardProps> = ({ project, onActivate }) => {
  const initial = (project.name.trim().charAt(0) || '•').toUpperCase();
  return (
    <ProjectCardShell
      variant="kanban"
      initial={initial}
      name={project.name}
      client={project.client?.name ?? null}
      status={
        <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>
          {project.status}
        </StatusPill>
      }
      body={
        <div className="text-[12px] font-bold tabular">
          {formatCurrency(project.contract_value)}
        </div>
      }
      foot={
        project.pm?.full_name ? (
          <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className="grid size-[16px] shrink-0 place-items-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
            >
              {(project.pm.full_name.trim().charAt(0) ?? '?').toUpperCase()}
            </span>
            <span className="max-w-[14ch] truncate">{project.pm.full_name}</span>
          </span>
        ) : undefined
      }
      onOpen={onActivate}
    />
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
  const { activeStageIndex, hasScrolled, scrollWrapRef, colRefs, onScroll, handleStageClick } =
    useKanbanMobileScroll();

  return (
    <div ref={scrollWrapRef} data-testid="project-kanban-board">
      {/* Mobile stage indicator — hidden on md+ (KanbanStageIndicator adds md:hidden). */}
      <KanbanStageIndicator
        stages={PROJECT_KANBAN_COLUMNS.map((c) => c.stageItem)}
        activeIndex={activeStageIndex}
        onStageClick={handleStageClick}
      />

      {/* Board: onScroll attached directly to <Kanban> so it lands on .kanban-scroll.
          Relative wrapper needed so the absolute swipe-hint chip stays contained. */}
      <div className="relative">
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

        {/* A-MIN-2: First-scroll affordance — "Swipe for more →" hint chip.
            Shown ONLY on mobile (md:hidden) and ONLY before the user has scrolled.
            Decorative: aria-hidden="true". Pointer-events-none so it never blocks cards.
            Tokens: bg-card border-border text-muted-foreground rounded-full (DESIGN.md §3).
            Transitions out with opacity/translate (compositor-only, prefers-reduced-motion
            safe — 0ms when reduced-motion is set by the global CSS rule in index.css). */}
        <div
          data-testid="swipe-hint"
          aria-hidden="true"
          className={[
            // Mobile-only: hidden at md+ where all columns are visible.
            'md:hidden',
            // Positioning: float at bottom-right of the board area.
            'pointer-events-none absolute bottom-3 right-2 z-10',
            // Chip visual: matches the count-badge pattern from DESIGN.md §3
            // (secondary bg, border, muted-foreground text, full radius).
            'flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1',
            'text-[11px] font-semibold text-muted-foreground shadow-[0_1px_2px_hsl(240_6%_10%/0.06)]',
            // Visibility: animate away once the user has scrolled (hasScrolled latch).
            // opacity + translate so only compositor properties are animated (no reflow).
            'transition-[opacity,transform] duration-200',
            hasScrolled ? 'pointer-events-none opacity-0 translate-x-1' : 'opacity-100 translate-x-0',
          ].join(' ')}
        >
          {/* Arrow icon — SVG so no emoji (DESIGN.md §4, taste §icon rule). */}
          <svg
            aria-hidden="true"
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="shrink-0"
          >
            <path
              d="M1.5 5h7M5.5 2l3 3-3 3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Swipe for more →
        </div>
      </div>
    </div>
  );
};

export default ProjectKanbanBoard;
