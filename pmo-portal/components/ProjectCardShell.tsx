import React from 'react';
import { useTranslation } from 'react-i18next';
import { KanbanCard, CompanyNameLink } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { projectIconColor } from './projects';

export type ProjectCardVariant = 'grid' | 'kanban';

export interface ProjectCardShellProps {
  /** Avatar/icon-tile initial (the project name's first letter). */
  initial: string;
  /** Project name — the activation target. */
  name: string;
  /** Customer name (em-dash fallback for a missing client). */
  client: string | null | undefined;
  /**
   * PL-2 (AC-JR-W3B-E1): optional client company UUID. When provided in `grid`
   * mode, the client name is rendered as a `CompanyNameLink` so users can navigate
   * to the company record. In `kanban` mode the whole card is role=button, so a
   * nested Link would be invalid HTML — the name renders as inert text there.
   */
  clientId?: string | null;
  /** PMO-owned stable identity, distinct from client and external codes. */
  pmoProjectNumber?: string | null;
  /** Optional organisation-owned Client Project Code. */
  code?: string | null;
  /** Status slot — a <StatusPill> for the project's lifecycle status. */
  status: React.ReactNode;
  /** Metric body slot — money rows / progress bars / weighted value. */
  body?: React.ReactNode;
  /** Foot slot — PM avatar + optional inline control. */
  foot?: React.ReactNode;
  /** Drill into the project. */
  onOpen?: () => void;
  /**
   * `grid` (cards-view, full) | `kanban` (board, compact). Both share the SAME
   * visual vocabulary — only the density/spacing and activation-target differ:
   * grid uses an inner name <button> (so inline foot controls can coexist);
   * kanban makes the whole card the single role=button (a11y: no nested button).
   */
  variant?: ProjectCardVariant;
  /** Highlights the card (kanban selection). */
  selected?: boolean;
  className?: string;
}

/**
 * ProjectCardShell — the ONE canonical project-card visual vocabulary (CW-3b).
 *
 * A project renders the SAME wherever it appears: the Projects cards view, the
 * Projects kanban board, and the Sales/Pipeline kanban board all compose this
 * shell. The shell owns the chrome — 1px border at rest, hover-lift on interaction
 * (Flat-By-Default Rule), the icon tile + name + client·code subtitle head, then a
 * body slot (lens-specific metrics) and a foot slot (PM + optional control).
 * Grid keeps status beside the head; Kanban places it below the full title and
 * before client/code. Lens content (delivery committed/actual vs pipeline weighted
 * value) is passed in — the SHELL never forks.
 *
 * Two density variants:
 *  - `grid`  — full cards-view card; the name is an inner <button> so the foot can
 *              host an inline status control without nesting interactives.
 *  - `kanban`— compact board card; the WHOLE card is the activation target
 *              (KanbanCard, role=button) so it stays a single focusable control.
 */
const ProjectCardShell: React.FC<ProjectCardShellProps> = ({
  initial,
  name,
  client,
  clientId,
  pmoProjectNumber,
  code,
  status,
  body,
  foot,
  onOpen,
  variant = 'grid',
  selected = false,
  className,
}) => {
  const { t } = useTranslation();
  const isKanban = variant === 'kanban';
  const cardLabel = [
    name,
    pmoProjectNumber && `${t('projects.identifiers.pmo', 'PMO Project Number')}: ${pmoProjectNumber}`,
    code && `${t('projects.identifiers.client', 'Client Project Code')}: ${code}`,
  ].filter(Boolean).join('. ');
  const iconSize = isKanban ? 'size-[26px] text-[12px]' : 'size-7 text-[11px]';

  const head = (
    <div className={cn('flex items-start gap-2.5', isKanban && 'gap-2')}>
      <span
        aria-hidden
        className={cn('grid shrink-0 place-items-center rounded-md font-bold text-white', iconSize)}
        style={{ background: projectIconColor() }}
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        {isKanban ? (
          // Kanban: the KanbanCard wrapper is the single role=button activation
          // target, so the name is plain text (no nested button in role=button).
          <div
            className="block max-w-full break-words text-[13px] font-semibold text-foreground leading-5"
            title={name}
          >
            {name}
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full break-words text-left text-sm font-semibold text-foreground line-clamp-2 leading-5 hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title={name}
          >
            {name}
          </button>
        )}
        {isKanban && <div className="mt-1 flex min-w-0 items-center">{status}</div>}
        <div
          className={cn(
            'mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted-foreground',
            isKanban && 'mt-1',
          )}
        >
          {/* PL-2: grid mode only — kanban card is role=button so nested Links are invalid. */}
          {!isKanban && clientId ? (
            <CompanyNameLink
              companyId={clientId}
              name={client ?? null}
              className="text-[12px]"
            />
          ) : (
            <span className="truncate">{client ?? '—'}</span>
          )}
          {pmoProjectNumber && (
            <span className="break-all font-mono text-[11px]">
              <span className="font-sans">{t('projects.identifiers.pmo', 'PMO Project Number')}:</span> {pmoProjectNumber}
            </span>
          )}
          {code && (
            <span className="break-all font-mono text-[11px]">
              <span className="font-sans">{t('projects.identifiers.client', 'Client Project Code')}:</span> {code}
            </span>
          )}
        </div>
      </div>
      {!isKanban && status}
    </div>
  );

  // Kanban variant: the whole card is the KanbanCard (role=button) — single
  // focusable activation target, deeper hover-lift, optional selected ring.
  if (isKanban) {
    return (
      <KanbanCard
        onActivate={onOpen}
        selected={selected}
        aria-label={cardLabel}
        data-testid="project-card"
        className={className}
      >
        {head}
        {body && <div className="mt-2">{body}</div>}
        {foot && (
          <div className="mt-2 flex items-center justify-between border-t border-border/70 pt-2">
            {foot}
          </div>
        )}
      </KanbanCard>
    );
  }

  // Grid variant: full card with the Flat-By-Default chrome (1px border at rest,
  // hover-lift only on interaction — never a false static shadow).
  return (
    <div
      data-testid="project-card"
      className={cn(
        'flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-shadow duration-150 hover:shadow-[0_2px_10px_hsl(var(--foreground)/0.06)]',
        className,
      )}
    >
      {head}
      {body}
      {foot && (
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3">
          {foot}
        </div>
      )}
    </div>
  );
};

export default ProjectCardShell;
