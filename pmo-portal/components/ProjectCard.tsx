import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, ProgressBar, Button, Icon, TaxBasisLabel } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import { projectManagerLabel } from '@/src/lib/projects/projectManagerLabel';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { formatExactMoney, isActualComplete } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { pillVariantForProjectStatus } from './projects';
import ProjectCardShell from './ProjectCardShell';

export interface ProjectCardProps {
  project: ProjectWithRefs;
  /** Drill into the full-page project detail. */
  onOpen: (project: ProjectWithRefs) => void;
  /** I5: delivery summary (from useProjectsDeliverySummary) for consistent card-view display. */
  deliverySummary?: { deliveryPct: number | null; committedSpend: number; budget: number } | undefined;
  /** Batched canonical Actual and Active-budget read for this project. */
  projectMoney?: ProjectMoneyRead;
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
 * utilization bars). Status changes (AC-1011's win-transition) live on the record, not here.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen, deliverySummary, projectMoney, onEdit }) => {
  const { t } = useTranslation();
  // FR-L10N-020: every figure on this card belongs to THIS project, so the currency is the
  // project's own — not the org default. Two projects in different currencies render correctly
  // side by side in the same list, which is the whole point of the per-record column (0187).
  const currency = project.currency;
  const contract = project.contract_value ?? 0;
  const actual = projectMoney?.actuals.total == null ? null : Number(projectMoney.actuals.total);
  const activeBudget = projectMoney?.hasActiveBudget && projectMoney.activeBudgetAmount != null
    ? Number(projectMoney.activeBudgetAmount)
    : null;
  const activeBudgetLabel = !projectMoney || (projectMoney.hasActiveBudget && activeBudget == null)
    ? t('uxs02.unavailable', 'Unavailable')
    : projectMoney.hasActiveBudget
      ? formatCurrency(activeBudget!, projectMoney.activeBudgetCurrency ?? currency)
      : t('uxs02.noActiveBudget', 'No active budget');
  const budgetCurrencyMatches = projectMoney?.activeBudgetCurrency === projectMoney?.actuals.currency
    && projectMoney?.actuals.currency === project.currency;
  const actualIsComplete = isActualComplete({ basis: projectMoney?.ledgerBasis ?? (projectMoney ? 'erp' : 'unavailable'),
    readSucceeded: Boolean(projectMoney), complete: projectMoney?.actuals.complete,
    categories: projectMoney?.actuals.categories, excludesRestrictedRows: projectMoney?.actuals.excludesRestrictedRows });
  const budgetUsedPct = actual != null && actualIsComplete && activeBudget != null && activeBudget > 0 && budgetCurrencyMatches
    ? Math.round((actual / activeBudget) * 100)
    : null;
  const atRisk = isMoneyAtRisk({ status: project.status as string, budget: activeBudget,
    budgetCurrency: projectMoney?.activeBudgetCurrency ?? null, projectCurrency: project.currency, spent: actual,
    actualCurrency: projectMoney?.actuals.currency ?? null, actualComplete: actualIsComplete });
  // FR-PRJUX-004/005: the footer label reads from the manager ID, so an assigned blank-name
  // profile shows `Unnamed user · <short ID>` and a null ID shows `Unassigned` — never the
  // same label for both states.
  const pmLabel = projectManagerLabel({
    managerId: project.project_manager_id,
    fullName: project.pm?.full_name,
    unassignedLabel: t('projects.unassigned', 'Unassigned'),
    unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
  });
  const initial = (pmLabel.trim().charAt(0) || '?').toUpperCase();

  // Actual is shown only when complete — the same rule as the table: unknown is never a partial total.
  const showActual = actual != null && actualIsComplete;
  const body = (
    <>
      {/* Body: money rows. Each fact once: no freshness, coverage or "x of y" prose on the card. */}
      <dl className="grid grid-cols-3 gap-2 text-[12px]">
        <div>
          <dt className="text-muted-foreground">{t('projects.columns.contract', 'Contract')}</dt>
          <dd className="font-semibold tabular">{formatCurrency(contract, currency)}</dd>
          {/* OD-TAX-1 §2 — the card's headline money figure states its basis (plain; rate/DPP live on the record). */}
          <dd>
            <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} />
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('uxs02.activeBudget', 'Active budget')}</dt>
          <dd className="font-semibold tabular text-muted-foreground">{activeBudgetLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('projects.columns.actual', 'Actual')}</dt>
          <dd className="font-semibold tabular">
            {showActual ? formatExactMoney(projectMoney?.actuals.total ?? null, projectMoney?.actuals.currency ?? currency, getNumberLocale()) ?? t('uxs02.unavailable', 'Unavailable') : t('uxs02.unavailable', 'Unavailable')}
          </dd>
        </div>
      </dl>

      {/* Delivery progress and Active-budget utilization use separate, explicit denominators;
          a row appears only when it has a figure. */}
      {((deliverySummary && deliverySummary.deliveryPct != null) || budgetUsedPct != null) && (
        <div
          data-testid="project-card-bars"
          className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1.5"
        >
          {deliverySummary && deliverySummary.deliveryPct != null && (
            <>
              <span className="text-[12px] font-semibold text-muted-foreground">{t('projects.card.delivery', 'Delivery')}</span>
              <ProgressBar
                value={Math.round(deliverySummary.deliveryPct)}
                showValue
                tone={Math.round(deliverySummary.deliveryPct) >= 100 ? 'success' : 'primary'}
                aria-label={t('projects.card.deliveryPercent', 'Delivery {{percent}}%', { percent: Math.round(deliverySummary.deliveryPct) })}
              />
            </>
          )}
          {budgetUsedPct != null && (
            <>
              <span className="text-[12px] font-semibold text-muted-foreground">{t('projects.columns.budgetUsed', 'Budget used')}</span>
              <div className="flex flex-col gap-0.5">
                <ProgressBar
                  value={budgetUsedPct}
                  showValue
                  tone={atRisk ? 'destructive' : budgetUsedPct >= 70 ? 'warning' : undefined}
                  aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: budgetUsedPct })}
                />
                {atRisk && <span className="text-[11px] font-semibold text-warning">{t('uxs02.atRisk', 'At risk')}</span>}
              </div>
            </>
          )}
        </div>
      )}

      {(project.pmo_project_number || project.code || project.customer_contract_ref) && (
        <details>
          <summary aria-label={t('uxs14.projectReferencesFor', 'More project references for {{name}}', { name: project.name })} className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('uxs14.projectReferences', 'More project references')}
          </summary>
          <div className="space-y-0.5 pt-1 font-mono text-[11px] text-muted-foreground">
            {project.pmo_project_number && <div>{t('projects.identifiers.pmo', 'PMO Project Number')}: <span className="break-words md:truncate" title={project.pmo_project_number}>{project.pmo_project_number}</span></div>}
            {project.code && <div>{t('projects.identifiers.client', 'Client Project Code')}: <span className="break-words md:truncate" title={project.code}>{project.code}</span></div>}
            {project.customer_contract_ref && <div>{t('uxs14.contractReference', 'Customer contract reference')}: <span className="break-words md:truncate" title={project.customer_contract_ref}>{project.customer_contract_ref}</span></div>}
          </div>
        </details>
      )}
    </>
  );

  // Foot: PM + the optional Edit button (stops propagation so it never triggers the card drill).
  const foot = (
    <>
      <span className="flex min-w-0 items-center gap-2 text-[12px]">
        {project.project_manager_id != null && (
          <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-bold text-muted-foreground">
            {initial}
          </span>
        )}
        <span className="truncate text-muted-foreground">{pmLabel}</span>
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
            aria-label={t('projects.card.editProject', 'Edit {{name}}', { name: project.name })}
          >
            <Icon name="pencil" />
            {t('projects.actions.edit', 'Edit')}
          </Button>
        )}
      </div>
    </>
  );

  return (
    // UX-019: secondary identifiers are rendered only in the disclosure above.
    <ProjectCardShell
      variant="grid"
      initial={(project.name.trim().charAt(0) || '•').toUpperCase()}
      name={project.name}
      client={project.client ? companyDisplayName(project.client) : null}
      clientId={project.client_id}
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
