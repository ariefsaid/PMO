import React from 'react';
import { StatusPill, ProgressBar, Button, Icon } from '@/src/components/ui';
import { formatCurrency, formatCompactCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { pillVariantForProjectStatus } from './projects';
import ProjectCardShell from './ProjectCardShell';
import ProjectStatusControl from './ProjectStatusControl';
import type { ProjectStatus } from '@/src/lib/db/projectTransitions';

export interface ProjectCardProps {
  project: ProjectWithRefs;
  /** Drill into the full-page project detail. */
  onOpen: (project: ProjectWithRefs) => void;
  /** I5: delivery summary (from useProjectsDeliverySummary) for consistent card-view display. */
  deliverySummary?: { deliveryPct: number | null; committedSpend: number; budget: number } | undefined;
  /**
   * T15opt: optional Edit callback — when provided (can('edit','project') = true) renders
   * a compact "Edit" button in the card foot. Gates on the caller, not the card itself
   * (the card is presentational; RBAC lives in the Projects page).
   */
  onEdit?: (project: ProjectWithRefs) => void;
}

/**
 * Index Cards-view card (IA-3). Renders the canonical ProjectCardShell (CW-3b) in
 * the `grid` variant — the SAME visual vocabulary used by the Projects kanban and
 * Sales pipeline boards. The Flat-By-Default Rule (1px border at rest, hover-lift
 * only on interaction), the icon/name/status head, and the PM foot all live in the
 * shell; this card supplies the DELIVERY-lens body (Contract/Committed/Actual +
 * utilization bars) and the inline ProjectStatusControl (AC-1011's win-transition
 * RPC), which stops propagation so it never drills.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen, deliverySummary, onEdit }) => {
  const contract = project.contract_value ?? 0;
  const committed = project.budget ?? 0;
  const actual = project.spent ?? 0;
  const committedPct = contract > 0 ? (committed / contract) * 100 : 0;
  const actualPct = contract > 0 ? (actual / contract) * 100 : 0;
  const initial = (project.pm?.full_name?.trim().charAt(0) ?? '?').toUpperCase();

  const body = (
    <>
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

      {/* I5: Delivery + Budget used — consistent with table view */}
      {deliverySummary && deliverySummary.deliveryPct != null ? (
        <div
          data-testid="project-card-bars"
          className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5"
        >
          <span className="text-[12px] font-semibold text-muted-foreground">Delivery</span>
          <ProgressBar
            value={Math.round(deliverySummary.deliveryPct)}
            showValue
            aria-label={`Delivery ${Math.round(deliverySummary.deliveryPct)}%`}
          />
          <span className="text-[12px] font-semibold text-muted-foreground">Budget used</span>
          <div className="flex flex-col gap-0.5">
            <ProgressBar
              value={deliverySummary.budget > 0 ? Math.round((deliverySummary.committedSpend / deliverySummary.budget) * 100) : 0}
              showValue
              tone="warning"
              aria-label={`Budget used ${deliverySummary.budget > 0 ? Math.round((deliverySummary.committedSpend / deliverySummary.budget) * 100) : 0}%`}
            />
            <span className="text-[11px] text-muted-foreground">
              {`${formatCompactCurrency(deliverySummary.committedSpend)} of ${formatCompactCurrency(deliverySummary.budget)} budget`}
            </span>
          </div>
        </div>
      ) : (
        <div
          data-testid="project-card-bars"
          className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5"
        >
          <span className="text-[12px] font-semibold text-muted-foreground">Committed</span>
          <ProgressBar
            value={Math.round(committedPct)}
            tone="warning"
            showValue
            aria-label={`Committed: ${Math.round(committedPct)}% of contract`}
          />
          <span className="text-[12px] font-semibold text-muted-foreground">Actual</span>
          <ProgressBar
            value={Math.round(actualPct)}
            showValue
            aria-label={`Actual spend: ${Math.round(actualPct)}% of contract`}
          />
        </div>
      )}

      {project.customer_contract_ref && (
        <div className="truncate font-mono text-[11px] text-muted-foreground" title={project.customer_contract_ref}>
          {project.customer_contract_ref}
        </div>
      )}
    </>
  );

  // Foot: PM + inline controls. Both the status control and the optional Edit button
  // stop propagation so they never trigger the card-drill navigation.
  const foot = (
    <>
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
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        {onEdit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(project);
            }}
            aria-label={`Edit ${project.name}`}
          >
            <Icon name="pencil" />
            Edit
          </Button>
        )}
        <ProjectStatusControl
          project={{
            id: project.id,
            status: project.status as ProjectStatus,
            customer_contract_ref: project.customer_contract_ref,
          }}
        />
      </div>
    </>
  );

  return (
    <ProjectCardShell
      variant="grid"
      initial={(project.name.trim().charAt(0) || '•').toUpperCase()}
      name={project.name}
      client={project.client?.name ?? null}
      clientId={project.client_id}
      code={project.code}
      status={
        <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>
          {project.status}
        </StatusPill>
      }
      body={body}
      foot={foot}
      onOpen={() => onOpen(project)}
    />
  );
};

export default ProjectCard;
