import { companyDisplayName } from '@/src/lib/companyDisplayName';
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
import { useTranslation } from 'react-i18next';
import {
  Kanban,
  KanbanColumn,
  KanbanStageIndicator,
  type KanbanStageItem,
  TaxBasisLabel,
} from '@/src/components/ui';
import { useKanbanMobileScroll } from '@/src/components/kanban/useKanbanMobileScroll';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { projectManagerLabel } from '@/src/lib/projects/projectManagerLabel';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// ---------------------------------------------------------------------------
// Column definitions — lifecycle order, DESIGN.md tokens for dot colors.
// Each maps one or more `projects.status` values into a board column.
// Dot colors: one-blue only for active execution ("Ongoing"); others use
// muted semantic tokens that don't clash with the One Blue Rule.
// ---------------------------------------------------------------------------

interface ProjectKanbanColDef {
  /** Stable key for the translated display title. */
  key: 'won' | 'ongoing' | 'onHold' | 'closeOut' | 'internal';
  /** The project.status values that belong in this column. */
  statuses: string[];
  /** DESIGN.md token for the column dot (color-not-only: label also identifies the column). */
  dotColor: string;
  /** data-testid for the column wrapper (for AC-tagged RTL queries). */
  testId: string;
}

const PROJECT_KANBAN_COLUMNS: ProjectKanbanColDef[] = [
  {
    key: 'won',
    statuses: ['Won, Pending KoM'],
    dotColor: 'hsl(var(--success))',
    testId: 'kanban-col-won',
  },
  {
    key: 'ongoing',
    statuses: ['Ongoing Project'],
    // The one interactive blue — active execution (One Blue Rule allows for status identity).
    dotColor: 'hsl(var(--primary))',
    testId: 'kanban-col-ongoing',
  },
  {
    key: 'onHold',
    statuses: ['On Hold'],
    dotColor: 'hsl(var(--warning))',
    testId: 'kanban-col-onhold',
  },
  {
    key: 'closeOut',
    statuses: ['Close Out'],
    // violet (hsl(262 83% 58%)) is the DESIGN.md categorical accent, explicitly sanctioned
    // for "timeline/legend dots" (DESIGN.md §2 Secondary). Distinct from Won's success-green
    // so the two terminal columns are color-differentiable (color + label, not color-only).
    dotColor: 'hsl(var(--violet))',
    testId: 'kanban-col-closeout',
  },
  {
    key: 'internal',
    statuses: ['Internal Project'],
    dotColor: 'hsl(var(--muted-foreground))',
    testId: 'kanban-col-internal',
  },
];

// ---------------------------------------------------------------------------
// ProjectKanbanCard — a single project card in the kanban view.
// Project lifecycle is communicated by the column header. Cards keep the project
// evidence needed to identify and open a record without repeating the status.
// ---------------------------------------------------------------------------

interface ProjectKanbanCardProps {
  project: ProjectWithRefs;
  onActivate: () => void;
}

const ProjectKanbanCard: React.FC<ProjectKanbanCardProps> = ({ project, onActivate }) => {
  const { t } = useTranslation();
  const displayName = projectDisplayName(project);
  const legalNameId = `kanban-project-legal-${project.id}`;
  const pmLabel = projectManagerLabel({
    managerId: project.project_manager_id,
    fullName: project.pm?.full_name,
    unassignedLabel: t('projects.unassigned', 'Unassigned'),
    unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
  });
  const references = [
    project.pmo_project_number && [t('projects.identifiers.pmo', 'PMO Project Number'), project.pmo_project_number],
    project.code && [t('projects.identifiers.client', 'Client Project Code'), project.code],
    project.customer_contract_ref && [t('uxs14.contractReference', 'Customer contract reference'), project.customer_contract_ref],
  ].filter((row): row is [string, string] => Boolean(row));
  return (
    <button type="button" onClick={onActivate}
      aria-label={t('projects:kanban.openProject', 'Open project {{name}}', { name: displayName })}
      aria-describedby={displayName !== project.name ? legalNameId : undefined}
      className="touch-target flex min-h-11 w-full min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left hover:bg-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
      <span title={project.name} className="block min-w-0 break-words font-semibold text-foreground">{displayName}</span>
      {displayName !== project.name && <span id={legalNameId} className="sr-only">{project.name}</span>}
      {project.client
        ? <span className="block min-w-0 break-words text-[12px] text-muted-foreground">{companyDisplayName(project.client)}</span>
        : <span className="block min-w-0 break-words text-[12px] text-muted-foreground">{t('projects:customerUnavailable', 'Customer unavailable')}</span>}
      {project.end_client && <span className="block min-w-0 break-words text-[12px] text-muted-foreground">{t('projects:endCustomer', 'End customer')}: {companyDisplayName(project.end_client)}</span>}
      <span className="block min-w-0 text-[12px] text-muted-foreground">
        {project.end_date
          ? t('projects:card.expectedEnd', 'Expected end {{date}}', { date: formatDateOnly(project.end_date) })
          : t('projects:dates.noExpectedEnd', 'No expected end')}
      </span>
      {references.map(([label, value]) => <span key={label} className="block min-w-0 break-words text-xs text-muted-foreground"><span className="font-medium">{label}:</span> <span className="break-all font-mono text-foreground">{value}</span></span>)}
      <span className="block break-words text-[12px] font-semibold tabular">
        {formatCurrency(project.contract_value, project.currency)} <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} />
      </span>
      <span className="block min-w-0 break-words text-sm text-foreground">{t('projects.columns.pm', 'PM')}: {pmLabel}</span>
    </button>
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
  const { t } = useTranslation();
  const { activeStageIndex, hasScrolled, scrollWrapRef, colRefs, onScroll, handleStageClick } =
    useKanbanMobileScroll();
  const titles = {
    won: t('projects.kanban.won', 'Won'),
    ongoing: t('projects.kanban.ongoing', 'Ongoing'),
    onHold: t('projects.kanban.onHold', 'On Hold'),
    closeOut: t('projects.kanban.closeOut', 'Close Out'),
    internal: t('projects.kanban.internal', 'Internal'),
  };
  const stages: KanbanStageItem[] = PROJECT_KANBAN_COLUMNS.map((col) => ({
    title: titles[col.key],
    dotColor: col.dotColor,
  }));

  return (
    <div ref={scrollWrapRef} data-testid="project-kanban-board">
      {/* Mobile stage indicator — hidden on md+ (KanbanStageIndicator adds md:hidden). */}
      <KanbanStageIndicator
        stages={stages}
        activeIndex={activeStageIndex}
        onStageClick={handleStageClick}
      />

      {/* Board: onScroll attached directly to <Kanban> so it lands on .kanban-scroll.
          Relative wrapper needed so the absolute swipe-hint chip stays contained. */}
      <div className="relative">
        <Kanban aria-label={t('projects.kanban.board', 'Projects kanban board')} onScroll={onScroll}>
          {PROJECT_KANBAN_COLUMNS.map((col, colIdx) => {
            const colProjects = projects.filter((p) => col.statuses.includes(p.status as string));
            const title = titles[col.key];
            return (
              <div
                key={col.testId}
                ref={(el) => { colRefs.current[colIdx] = el; }}
                data-testid={col.testId}
                className="flex min-w-0 flex-col"
              >
                <KanbanColumn
                  title={title}
                  dotColor={col.dotColor}
                  count={colProjects.length}
                  emptyMessage={t('projects.kanban.empty', 'No projects in {{stage}}', { stage: title })}
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
            'text-[11px] font-semibold text-muted-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.06)]',
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
          {t('projects.kanban.swipe', 'Swipe for more →')}
        </div>
      </div>
    </div>
  );
};

export default ProjectKanbanBoard;
