import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/src/components/ui/Avatar';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/src/components/shadcn/dropdown-menu';
import { Kanban, KanbanColumn, KanbanStageIndicator, StatusPill, Badge, TaxBasisLabel, type DropState } from '@/src/components/ui';
import { useKanbanMobileScroll } from '@/src/components/kanban/useKanbanMobileScroll';
import { BoardDnd, DraggableCard, DroppableColumn } from '@/src/components/kanban/BoardDnd';
import type { MoveState } from '@/src/components/kanban/useOptimisticMoves';
import { useSalesStageLabel } from '@/src/hooks/useProjectStatusLabel';
import { formatCurrency, formatCalendarDayInTimeZone } from '@/src/lib/format';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import ProjectCardShell from './ProjectCardShell';
import {
  SALES_COLUMNS,
  formatPercent,
  isStaleBid,
  stageLine,
  formatIsoDayMonth,
  canSummarizeExclusiveTaxBasis,
  type SalesColumn,
} from './salesPipeline';

interface SalesKanbanBoardProps {
  projects: PipelineProject[];
  /** Drill into a deal's opportunity detail (opens a workspace record tab). */
  onOpen: (project: PipelineProject) => void;
  /** Currently-open opportunity id — highlights its card. */
  selectedId?: string;
  /**
   * Index (into the open columns) of the funnel stage the page has selected, or null/undefined for
   * none (#697). Changing it takes the board to that column and marks it — the same jump the
   * mobile stage tabs make — so a stage selection has a visible effect in Board view.
   */
  selectedStageIndex?: number | null;
  /** Compact, vertical projection for the phone pipeline stage list. */
  presentation?: 'board' | 'list';
  /** Active URL stage; compact rows omit a repeated status label when grouped by stage. */
  selectedStatus?: PipelineProject['status'] | null;
  /** Drag controller (DND, #1637). Absent: the board renders exactly as before. */
  drag?: {
    columnOf: (projectId: string, serverColumnId: string) => string;
    stateOf: (projectId: string) => MoveState | null;
    canDrag: (project: PipelineProject) => boolean;
    canDrop: (projectId: string, columnId: string) => boolean;
    isHome: (projectId: string, columnId: string) => boolean;
    onMove: (projectId: string, columnId: string) => void;
  };
}

/** #1638 FR-PSH-013: one line for the latest stage entry; lost deals date from decided_at (an instant). */
const DealStageLine: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const today = useOrgToday();
  const lost = project.status === 'Loss Tender' || project.status === 'Declined';
  const enteredOn = lost
    ? (project.decided_at ? formatCalendarDayInTimeZone(new Date(project.decided_at), getActiveLocale().timezone) : undefined)
    : project.stage_started_at?.slice(0, 10); // the pipeline RPC emits entered_on at UTC midnight
  if (!enteredOn) return null;
  return (
    <p data-testid={`stage-line-${project.id}`} className="text-control text-muted-foreground tabular">
      {stageLine(project.status, enteredOn, today, (k, d) => t(k, d))}
    </p>
  );
};

/** #1638 FR-PSH-014: won deals carry a Signed pill with the contract date, in place of the stage line. */
const SignedPill: React.FC<{ project: PipelineProject }> = ({ project }) => {
  const { t } = useTranslation();
  const label = t('sales:stageDate.signed', 'Signed');
  const date = project.contract_date ? formatIsoDayMonth(project.contract_date) : null;
  return (
    <StatusPill variant="won" data-testid={`signed-pill-${project.id}`} className="w-fit">
      {date ? `${label} ${date}` : label}
    </StatusPill>
  );
};

const DealStamp: React.FC<{ project: PipelineProject }> = ({ project }) =>
  ON_HAND_STATUSES.includes(project.status) ? <SignedPill project={project} /> : <DealStageLine project={project} />;

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
  hideExclusiveTaxBasis?: boolean;
}> = ({ project, selected, onActivate, hideExclusiveTaxBasis = false }) => {
  const { t } = useTranslation();
  const displayName = projectDisplayName(project);
  const initial = (project.client_name ?? displayName).trim().charAt(0).toUpperCase() || '•';
  // The column already names a single-status stage; only Won/Lost (several statuses) need the chip.
  const columnRepeatsStatus = (SALES_COLUMNS.find((c) => c.statuses.includes(project.status))?.statuses.length ?? 0) <= 1;
  return (
    <ProjectCardShell
      variant="kanban"
      selected={selected}
      initial={initial}
      name={displayName}
      contractualName={project.name}
      client={project.client_name}
      pmoProjectNumber={null}
      code={null}
      status={columnRepeatsStatus ? null : (
        <StatusPill record="project" state={project.status} wrap />
      )}
      // The head (first child) keeps clear of the card menu's trigger.
      className="[&>div:first-child]:pr-7"
      foot={project.pm_name ? (
        <span className="flex min-w-0 items-center gap-2 text-control text-muted-foreground">
          <Avatar name={project.pm_name} size="xs" decorative fallback="" />
          <span className="truncate">{project.pm_name}</span>
        </span>
      ) : undefined}
      body={
        // #696: the money row WRAPS. A column is ~258px wide, and in Bahasa (longer grouped
        // amounts + the PPN label) amount, basis and the probability pill do not
        // fit on one line — non-wrapping, they overran the card and gave every column's card list
        // its own sideways scrollbar. `min-w-0` lets each group shrink to the card, `shrink-0` keeps
        // the pill whole when it drops to its own line.
        <div className="min-w-0 space-y-1">
          <DealStamp project={project} />
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-[15px] font-bold tabular">
                {formatCurrency(project.contract_value, project.currency)}
              </span>
              {/* OD-TAX-1 §2: the basis comes from THIS deal's row (0208), never the org default.
                  It sits IMMEDIATELY after the contract value — a label whose job is to remove
                  ambiguity must not sit where it could be read as qualifying another number. */}
              {!(hideExclusiveTaxBasis && project.tax_treatment === 'exclusive') && <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} showDetails={false} />}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Badge aria-label={t('sales:chanceBadgeAria', 'Chance {{chance}}; % Go {{go}}, % Get {{get}}', {
                chance: formatPercent((project.go_probability ?? project.win_probability ?? 1) * (project.get_probability ?? 1)),
                go: formatPercent(project.go_probability ?? project.win_probability),
                get: formatPercent(project.get_probability ?? 1),
              })} className="px-1.5">
                {t('sales:chanceValue', '{{pct}}%', { pct: formatPercent((project.go_probability ?? project.win_probability ?? 1) * (project.get_probability ?? 1)) })}
              </Badge>
            </div>
          </div>
          {isStaleBid(project) && (
            <Badge role="status" data-testid={`stale-bid-${project.id}`} className="px-1.5">
              {t('sales:pipeline.staleBid', 'Stale bid · stage unchanged for 90+ days')}
            </Badge>
          )}
        </div>
      }
      onOpen={onActivate}
    />
  );
};

/**
 * Compact deal row for the phone pipeline. The existing project shell keeps the
 * record activation target canonical; the list adds only value, basis and win %.
 */
const CompactDealCard: React.FC<{
  project: PipelineProject;
  onActivate: () => void;
  hideStatus: boolean;
  hideExclusiveTaxBasis?: boolean;
}> = ({ project, onActivate, hideStatus, hideExclusiveTaxBasis = false }) => {
  const { t } = useTranslation();
  const displayName = projectDisplayName(project);
  const initial = (project.client_name ?? displayName).trim().charAt(0).toUpperCase() || '•';

  return (
    <ProjectCardShell
      variant="grid"
      initial={initial}
      name={displayName}
      contractualName={project.name}
      client={project.client_name}
      pmoProjectNumber={null}
      code={null}
      status={hideStatus ? null : (
        <StatusPill record="project" state={project.status} />
      )}
      className="min-w-0 p-3 [&_button]:block [&_button]:overflow-visible [&_button]:[-webkit-line-clamp:unset] [&_span.truncate]:overflow-visible [&_span.truncate]:text-clip [&_span.truncate]:whitespace-normal [&_span.truncate]:break-words"
      body={
        <div className="min-w-0 space-y-1">
          <DealStamp project={project} />
          <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="break-words text-[15px] font-bold tabular">
                {formatCurrency(project.contract_value, project.currency)}
              </span>
              {!(hideExclusiveTaxBasis && project.tax_treatment === 'exclusive') && <TaxBasisLabel
                treatment={project.tax_treatment}
                taxRate={project.tax_rate}
                taxBaseNumerator={project.tax_base_numerator}
                taxBaseDenominator={project.tax_base_denominator}
                showDetails={false}
              />}
            </div>
            <div className="flex shrink-0 flex-wrap gap-1">
              <Badge aria-label={t('sales:chanceBadgeAria', 'Chance {{chance}}; % Go {{go}}, % Get {{get}}', {
                chance: formatPercent((project.go_probability ?? project.win_probability ?? 1) * (project.get_probability ?? 1)),
                go: formatPercent(project.go_probability ?? project.win_probability),
                get: formatPercent(project.get_probability ?? 1),
              })} className="px-1.5">
                {t('sales:chanceValue', '{{pct}}%', { pct: formatPercent((project.go_probability ?? project.win_probability ?? 1) * (project.get_probability ?? 1)) })}
              </Badge>
            </div>
          </div>
          {isStaleBid(project) && (
            <Badge role="status" data-testid={`stale-bid-${project.id}`} className="px-1.5">
              {t('sales:pipeline.staleBid', 'Stale bid · stage unchanged for 90+ days')}
            </Badge>
          )}
        </div>
      }
      onOpen={onActivate}
    />
  );
};

/**
 * The card's menu: "Move to" is the keyboard path to the same move a drop asks for (same confirm, same
 * win form, same write). Sits beside the card, not inside it: the card is itself a button.
 */
const DealMoveMenu: React.FC<{
  project: PipelineProject;
  drag: NonNullable<SalesKanbanBoardProps['drag']>;
  stageLabel: (c: SalesColumn) => string;
}> = ({ project, drag, stageLabel }) => {
  const { t } = useTranslation();
  const targets = SALES_COLUMNS.filter((c) => drag.canDrop(project.id, c.testId));
  if (targets.length === 0) return null;
  return (
    <div className="absolute right-1.5 top-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('boardDrag:cardActions', 'Actions for {{name}}', { name: projectDisplayName(project) })}
          className="touch-target grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span aria-hidden="true" className="text-base leading-none">⋯</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-[160px]">
          {targets.map((c) => (
            <DropdownMenuItem key={c.testId} onClick={() => drag.onMove(project.id, c.testId)}>
              {t('boardDrag:moveTo', 'Move to {{stage}}', { stage: stageLabel(c) })}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

const SalesPipelineCompactList: React.FC<Pick<SalesKanbanBoardProps, 'projects' | 'onOpen' | 'selectedStatus'>> = ({
  projects,
  onOpen,
  selectedStatus,
}) => {
  const { t } = useTranslation();
  const sharedExclusiveTaxBasis = canSummarizeExclusiveTaxBasis(projects);
  return (
    <>
      <ul
        data-testid="sales-phone-stage-list"
        aria-label={t('uxs24.phoneList', 'Projects in selected pipeline stage')}
        className="grid min-w-0 list-none gap-3 p-0 sm:grid-cols-2"
      >
        {projects.map((project) => (
          <li key={project.id} className="min-w-0">
            <CompactDealCard
              project={project}
              onActivate={() => onOpen(project)}
              hideStatus={selectedStatus != null}
              hideExclusiveTaxBasis={sharedExclusiveTaxBasis}
            />
          </li>
        ))}
      </ul>
      <div role="group" aria-label={t('sales:boardFigureContext', 'Board figure context')} className="mt-2 flex flex-wrap items-center justify-end gap-x-4 text-control text-muted-foreground">
        {sharedExclusiveTaxBasis && <span>{t('sales:exclusiveTaxSummary', 'excl. PPN')}</span>}
        <span>{t('sales:chanceHeader', 'Chance')}</span>
      </div>
    </>
  );
};

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
const SalesKanbanBoardView: React.FC<SalesKanbanBoardProps> = ({
  projects,
  onOpen,
  selectedId,
  selectedStageIndex = null,
  drag,
}) => {
  const { t } = useTranslation();
  // Cards use each project's OWN currency (migration 0201). Open columns show a count only: the
  // stage value lives once, in the funnel above, where mixed currencies are handled.
  const stageLabel = useSalesStageLabel();
  const serverColumnId = (p: PipelineProject) => SALES_COLUMNS.find((c) => c.statuses.includes(p.status))?.testId ?? '';
  const byColumn = (col: SalesColumn) =>
    projects.filter((p) => (drag ? drag.columnOf(p.id, serverColumnId(p)) : serverColumnId(p)) === col.testId);
  const { activeStageIndex, scrollWrapRef, colRefs, onScroll, handleStageClick } =
    useKanbanMobileScroll();
  const sharedExclusiveTaxBasis = canSummarizeExclusiveTaxBasis(projects);

  // #697: a funnel stage selection scrolls the board to that column (on mount too, so a copied
  // `?status=` link lands on it). `handleStageClick` is identity-stable.
  useEffect(() => {
    if (selectedStageIndex !== null) handleStageClick(selectedStageIndex);
  }, [selectedStageIndex, handleStageClick]);

  const byId = new Map(projects.map((p) => [p.id, p]));
  const withDnd = (board: React.ReactElement) =>
    drag ? (
      <BoardDnd
        canDrop={drag.canDrop}
        isHome={drag.isHome}
        onMove={drag.onMove}
        cardLabel={(id) => { const p = byId.get(id); return p ? projectDisplayName(p) : ''; }}
        columnLabel={(id) => { const c = SALES_COLUMNS.find((x) => x.testId === id); return c ? stageLabel(c) : id; }}
        renderOverlay={(id) => {
          const p = byId.get(id);
          // The card being held, at its own width (dnd-kit sizes the overlay to the source card). Inert: a picture, not a control.
          return p ? (
            <div inert aria-hidden="true" className="pointer-events-none w-full shadow-[0_10px_30px_hsl(240_10%_8%/0.16)]">
              <DealCard project={p} selected={false} onActivate={() => undefined} hideExclusiveTaxBasis={sharedExclusiveTaxBasis} />
            </div>
          ) : null;
        }}
      >
        {board}
      </BoardDnd>
    ) : board;

  // The five OPEN columns for the stage indicator (terminal Won/Lost are excluded —
  // the indicator is for navigating the pipeline, not the terminal archive columns).
  const openStages = SALES_COLUMNS.filter((c) => !c.terminal).map((c) => ({
    title: stageLabel(c),
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

      <div role="group" aria-label={t('sales:boardFigureContext', 'Board figure context')} className="mb-2 flex flex-wrap items-center justify-end gap-x-4 text-control text-muted-foreground">
        {sharedExclusiveTaxBasis && <span>{t('sales:exclusiveTaxSummary', 'excl. PPN')}</span>}
        <span>{t('sales:chanceHeader', 'Chance')}</span>
      </div>

      {/* Kanban scroll wrapper — onScroll is passed directly to <Kanban> so it lands on
          the actual .kanban-scroll element. scroll events do NOT bubble, so attaching the
          handler to any ancestor wrapper would never fire on a swipe gesture. */}
      {withDnd(
      <Kanban narrowEmpty aria-label={t('sales.board.ariaLabel', 'Sales pipeline board')} className="px-2" onScroll={onScroll}>
        {SALES_COLUMNS.map((col, colIdx) => {
          const colProjects = byColumn(col);
          const colTitle = stageLabel(col);
          // #774: the Lost column also holds Declined deals; show the two counts separately.
          const declinedCount = colProjects.filter((p) => p.status === 'Declined').length;
          const lostCountsLine =
            declinedCount > 0 ? (
              <span data-testid="lost-column-counts" className="text-control text-muted-foreground tabular">
                {t('sales.lostCounts', 'Lost {{lost}} · Declined {{declined}}', {
                  lost: colProjects.length - declinedCount,
                  declined: declinedCount,
                })}
              </span>
            ) : undefined;
          const column = (dropState?: DropState) => (
            <KanbanColumn
              title={colTitle}
              dotColor={col.dotColor}
              count={colProjects.length}
              totals={col.terminal ? lostCountsLine : undefined}
              emptyMessage={t('projects.kanban.empty', { defaultValue: 'No projects in {{stage}}', stage: colTitle })}
              selected={colIdx === selectedStageIndex}
              presentation="flat"
              dropState={dropState}
            >
              {colProjects.map((p) => {
                const card = (
                  <DealCard
                    key={p.id}
                    project={p}
                    selected={p.id === selectedId}
                    onActivate={() => onOpen(p)}
                    hideExclusiveTaxBasis={sharedExclusiveTaxBasis}
                  />
                );
                if (!drag) return card;
                const moveState = drag.stateOf(p.id);
                return (
                  <DraggableCard key={p.id} id={p.id} disabled={!drag.canDrag(p)} moveState={moveState}>
                    <div className="relative">
                      {card}
                      {drag.canDrag(p) && <DealMoveMenu project={p} drag={drag} stageLabel={stageLabel} />}
                    </div>
                    {moveState === 'saving' && (
                      <p className="px-1 pt-1 text-control text-muted-foreground">{t('boardDrag:saving', 'Saving…')}</p>
                    )}
                  </DraggableCard>
                );
              })}
            </KanbanColumn>
          );
          const columnClass = 'flex min-w-0 flex-col';
          const setColRef = (el: HTMLDivElement | null) => { colRefs.current[colIdx] = el; };
          return drag ? (
            <DroppableColumn key={col.title} id={col.testId} testId={col.testId} className={columnClass} nodeRef={setColRef}>
              {column}
            </DroppableColumn>
          ) : (
            <div key={col.title} ref={setColRef} data-testid={col.testId} className={columnClass}>
              {column()}
            </div>
          );
        })}
      </Kanban>,
      )}
    </div>
  );
};

const SalesKanbanBoard: React.FC<SalesKanbanBoardProps> = (props) => {
  if (props.presentation === 'list') {
    return (
      <SalesPipelineCompactList
        projects={props.projects}
        onOpen={props.onOpen}
        selectedStatus={props.selectedStatus}
      />
    );
  }
  return <SalesKanbanBoardView {...props} />;
};

export default SalesKanbanBoard;
