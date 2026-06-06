import React from 'react';
import { StatusPill, ProgressBar } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus, projectIconColor } from './projects';
import ProjectStatusControl from './ProjectStatusControl';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

export interface ProjectCardProps {
  project: ProjectWithRefs;
  /** Drill into the full-page project detail. */
  onOpen: (project: ProjectWithRefs) => void;
}

/**
 * Index Cards-view card (IA-3). The Flat-By-Default Rule: a 1px border defines
 * the card at rest; a `state-lift` shadow appears only on interactive hover (no
 * static shadow, no legacy top colored-border strip — status lives in the
 * StatusPill: dot + text, color-not-only). The project name is the real
 * focusable activation target; the inline ProjectStatusControl (AC-1011's
 * win-transition RPC) is preserved and stops propagation so it never drills.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen }) => {
  const contract = project.contract_value ?? 0;
  const committed = project.budget ?? 0;
  const actual = project.spent ?? 0;
  const committedPct = contract > 0 ? (committed / contract) * 100 : 0;
  const actualPct = contract > 0 ? (actual / contract) * 100 : 0;
  const initial = (project.pm?.full_name?.trim().charAt(0) ?? '?').toUpperCase();

  return (
    <div
      data-testid="project-card"
      className="flex h-full flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-shadow duration-150 hover:shadow-[0_2px_10px_hsl(240_6%_10%/0.06)]"
    >
      {/* Head: icon + name/customer + status */}
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden
          className="grid size-7 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white"
          style={{ background: projectIconColor() }}
        >
          {(project.name.trim().charAt(0) || '•').toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(project)}
            className="block max-w-full truncate text-left text-sm font-semibold text-foreground hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title={project.name}
          >
            {project.name}
          </button>
          <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="truncate">{project.client?.name ?? '—'}</span>
            {project.code && (
              <span className="shrink-0 font-mono text-[11px]">· {project.code}</span>
            )}
          </div>
        </div>
        <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>
          {project.status}
        </StatusPill>
      </div>

      {/* Body: money rows */}
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-muted-foreground">Contract</dt>
          <dd className="font-semibold tabular">{formatCurrency(contract)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Committed</dt>
          <dd className="font-semibold tabular text-muted-foreground">{formatCurrency(committed)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Actual</dt>
          <dd className="font-semibold tabular">{formatCurrency(actual)}</dd>
        </div>
      </dl>

      {/* Dual utilization bars */}
      <div className="flex flex-col gap-1.5">
        <ProgressBar
          value={Math.round(committedPct)}
          tone="warning"
          showValue
          aria-label={`Committed: ${Math.round(committedPct)}% of contract`}
        />
        <ProgressBar
          value={Math.round(actualPct)}
          showValue
          aria-label={`Actual spend: ${Math.round(actualPct)}% of contract`}
        />
      </div>

      {/* Foot: PM + inline status control */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/70 pt-3">
        <span className="flex min-w-0 items-center gap-2 text-[12px]">
          <span
            aria-hidden
            className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground"
          >
            {initial}
          </span>
          <span className="truncate text-muted-foreground">
            {project.pm?.full_name ?? 'Unassigned'}
          </span>
        </span>
        <div onClick={(e) => e.stopPropagation()}>
          <ProjectStatusControl
            project={{
              id: project.id,
              status: project.status as ProjectStatus,
              customer_contract_ref: project.customer_contract_ref,
            }}
          />
        </div>
      </div>

      {project.customer_contract_ref && (
        <div className="truncate font-mono text-[11px] text-muted-foreground" title={project.customer_contract_ref}>
          {project.customer_contract_ref}
        </div>
      )}
    </div>
  );
};

export default ProjectCard;
