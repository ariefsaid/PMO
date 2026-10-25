import { companyDisplayName } from '@/src/lib/companyDisplayName';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { StatusPill, ProgressBar, Button, Icon, TaxBasisLabel, CompanyNameLink } from '@/src/components/ui';
import { formatCurrency, formatDateOnly } from '@/src/lib/format';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { projectManagerLabel } from '@/src/lib/projects/projectManagerLabel';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { formatExactMoney, isActualComplete } from '@/src/lib/projectFinances';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { pillVariantForProjectStatus } from './projects';
import { ProjectDataState } from '@/src/components/projects/ProjectDataState';

export interface ProjectCardProps {
  project: ProjectWithRefs;
  /** Drill into the full-page project detail. */
  onOpen: (project: ProjectWithRefs) => void;
  /** I5: delivery summary (from useProjectsDeliverySummary) for consistent card-view display. */
  deliverySummary?: { deliveryPct: number | null; committedSpend: number; budget: number } | undefined;
  deliveryPending?: boolean;
  deliveryError?: boolean;
  /** Batched canonical Actual and Active-budget read for this project. */
  projectMoney?: ProjectMoneyRead;
  projectMoneyPending?: boolean;
  projectMoneyError?: boolean;
  /**
   * T15opt: optional Edit callback — when provided (can('edit','project') = true) renders
   * a compact "Edit" button in the card foot. Gates on the caller, not the card itself
   * (the card is presentational; RBAC lives in the Projects page).
   */
  onEdit?: (project: ProjectWithRefs) => void;
}

/**
 * Projects Cards-view composition. It intentionally owns its own evidence layout so the
 * collection can keep identity, customer, dates and finance states readable without changing
 * the shared Sales pipeline card. Status changes remain on the project record.
 */
const ProjectCard: React.FC<ProjectCardProps> = ({ project, onOpen, deliverySummary, deliveryPending = false, deliveryError = false, projectMoney, projectMoneyPending = false, projectMoneyError = false, onEdit }) => {
  const { t } = useTranslation();
  const currency = project.currency;
  const actual = projectMoney?.actuals.total == null ? null : Number(projectMoney.actuals.total);
  const activeBudget = projectMoney?.hasActiveBudget && projectMoney.activeBudgetAmount != null
    ? Number(projectMoney.activeBudgetAmount)
    : null;
  const actualStateLabel = () => {
    if (projectMoneyError || !projectMoney) return t('uxs02.unavailable', 'Unavailable');
    if (projectMoney.actuals.excludesRestrictedRows) return t('uxs02.restrictedRowsExcluded', 'Restricted rows excluded');
    if ((projectMoney.ledgerBasis ?? 'erp') === 'erp' && projectMoney.actuals.categories.some((category) => !category.mapped || category.amount == null)) {
      return t('uxs02.incompleteCoverage', 'Incomplete source coverage');
    }
    return t('uxs02.unavailable', 'Unavailable');
  };
  const dataState = (label: string, destination: 'overview' | 'budget' | 'delivery' = 'overview') => (
    <ProjectDataState
      label={label}
      to={`/projects/${project.id}/${destination === 'budget' ? 'budget' : 'overview'}`}
      actionLabel={destination === 'budget'
        ? t('projects:actions.reviewBudget', 'Review budget')
        : destination === 'delivery'
          ? t('projects:actions.reviewDelivery', 'Review delivery plan')
          : t('projects:actions.reviewFinances', 'Review project finances')}
    />
  );
  const actualIsComplete = isActualComplete({
    basis: projectMoney?.ledgerBasis ?? 'unavailable',
    readSucceeded: Boolean(projectMoney) && !projectMoneyError,
    complete: projectMoney?.actuals.complete,
    categories: projectMoney?.actuals.categories,
    excludesRestrictedRows: projectMoney?.actuals.excludesRestrictedRows,
  });
  const showActual = actual != null && actualIsComplete && !projectMoneyError;
  const budgetCurrencyMatches = projectMoney?.activeBudgetCurrency === projectMoney?.actuals.currency
    && projectMoney?.actuals.currency === currency;
  const budgetUsedPct = showActual && !projectMoneyError && activeBudget != null && activeBudget > 0 && budgetCurrencyMatches
    ? Math.round((actual / activeBudget) * 100)
    : null;
  const atRisk = isMoneyAtRisk({
    status: project.status as string,
    budget: activeBudget,
    budgetCurrency: projectMoney?.activeBudgetCurrency ?? null,
    projectCurrency: currency,
    spent: actual,
    actualCurrency: projectMoney?.actuals.currency ?? null,
    actualComplete: actualIsComplete,
  });
  const pmLabel = projectManagerLabel({
    managerId: project.project_manager_id,
    fullName: project.pm?.full_name,
    unassignedLabel: t('projects.unassigned', 'Unassigned'),
    unnamedUserLabel: t('projects.unnamedUser', 'Unnamed user'),
  });
  const referenceRows = [
    project.pmo_project_number && [t('projects.identifiers.pmo', 'PMO Project Number'), project.pmo_project_number],
    project.code && [t('projects.identifiers.client', 'Client Project Code'), project.code],
    project.customer_contract_ref && [t('uxs14.contractReference', 'Customer contract reference'), project.customer_contract_ref],
  ].filter((row): row is [string, string] => Boolean(row));
  const activeBudgetContent = projectMoneyPending
    ? <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>
    : projectMoneyError || !projectMoney
      ? dataState(t('uxs02.unavailable', 'Unavailable'), 'budget')
      : !projectMoney.hasActiveBudget
        ? dataState(t('uxs02.noActiveBudget', 'No active budget'), 'budget')
        : activeBudget == null
          ? dataState(t('uxs02.unavailable', 'Unavailable'), 'budget')
          : formatCurrency(activeBudget, projectMoney.activeBudgetCurrency ?? currency);
  const actualContent = projectMoneyPending
    ? <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>
    : showActual && !projectMoneyError
    ? formatExactMoney(projectMoney?.actuals.total ?? null, projectMoney?.actuals.currency ?? currency, getNumberLocale()) ?? dataState(t('uxs02.unavailable', 'Unavailable'))
    : dataState(actualStateLabel());
  const budgetUsedState = projectMoneyPending || budgetUsedPct != null ? null
    : projectMoneyError || !projectMoney
      ? { label: t('uxs02.unavailable', 'Unavailable'), destination: 'overview' as const }
      : !projectMoney.hasActiveBudget
        ? { label: t('uxs02.unavailable', 'Unavailable'), destination: 'budget' as const }
        : activeBudget == null
          ? { label: t('uxs02.unavailable', 'Unavailable'), destination: 'budget' as const }
        : activeBudget === 0
          ? { label: t('uxs02.zeroActiveBudget', '{{budget}} Active budget; usage unavailable', { budget: formatCurrency(activeBudget, projectMoney.activeBudgetCurrency ?? currency) }), destination: 'budget' as const }
          : !showActual
            ? { label: actualStateLabel(), destination: 'overview' as const }
            : !budgetCurrencyMatches
              ? { label: t('uxs02.currencyMismatch', 'Budget currency differs from Actual'), destination: 'budget' as const }
              : { label: t('uxs02.incompleteCoverage', 'Incomplete source coverage'), destination: 'overview' as const };

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0">
        <button type="button" onClick={() => onOpen(project)}
          className="touch-target block min-h-11 max-w-full break-words text-left text-[15px] font-semibold text-foreground hover:text-primary-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          title={project.name}
          aria-describedby={projectDisplayName(project) !== project.name ? 'project-legal-' + project.id : undefined}>
          {projectDisplayName(project)}
        </button>
        {projectDisplayName(project) !== project.name && <span id={'project-legal-' + project.id} className="sr-only">{project.name}</span>}
        <div className="mt-1 min-w-0 space-y-0.5 text-[12px]">
          {project.client
            ? <CompanyNameLink companyId={project.client_id} name={companyDisplayName(project.client)} className="touch-target block max-w-full break-words" />
            : <p className="break-words text-muted-foreground">{t('projects:customerUnavailable', 'Customer unavailable')}</p>}
          {project.end_client && <p className="break-words text-muted-foreground">{t('projects:endCustomer', 'End customer')}: {companyDisplayName(project.end_client)}</p>}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StatusPill variant={pillVariantForProjectStatus(project.status as string)}>{project.status}</StatusPill>
        <span className="text-[12px] text-muted-foreground">
          {project.end_date
            ? t('projects:card.expectedEnd', 'Expected end {{date}}', { date: formatDateOnly(project.end_date) })
            : t('projects:dates.noExpectedEnd', 'No expected end')}
        </span>
        {atRisk && <span className="text-[12px] font-semibold text-warning">{t('projects.atRiskPill', 'At risk')}</span>}
      </div>

      <div className="min-w-0">
        <p className="mb-1 text-[12px] font-medium text-muted-foreground">{t('projects:columns.delivery', 'Delivery')}</p>
        {deliveryPending
          ? <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>
          : deliveryError
            ? dataState(t('uxs02.unavailable', 'Unavailable'), 'delivery')
            : deliverySummary?.deliveryPct == null
              ? dataState(t('projects.noPhasesYet', 'No phases yet'), 'delivery')
              : <ProgressBar value={Math.round(deliverySummary.deliveryPct)} showValue
              tone={Math.round(deliverySummary.deliveryPct) >= 100 ? 'success' : 'primary'}
              aria-label={t('projects.card.deliveryPercent', 'Delivery {{percent}}%', { percent: Math.round(deliverySummary.deliveryPct) })} />}
      </div>

      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3 text-[12px]">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('projects.columns.contract', 'Contract')}</dt>
          <dd className="break-words font-semibold tabular">{formatCurrency(project.contract_value, currency)}</dd>
          <dd><TaxBasisLabel treatment={project.tax_treatment} showDetails={false} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('uxs02.activeBudget', 'Active budget')}</dt>
          <dd className="min-w-0 break-words font-semibold tabular">{activeBudgetContent}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('projects.columns.actual', 'Actual')}</dt>
          <dd className="break-words font-semibold tabular">
            {actualContent}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t('projects.columns.budgetUsed', 'Budget used')}</dt>
          <dd className="break-words font-semibold tabular">
            {budgetUsedPct == null
              ? projectMoneyPending
                ? <span className="text-xs text-muted-foreground">{t('projects:data.loading', 'Loading…')}</span>
                : budgetUsedState && dataState(budgetUsedState.label, budgetUsedState.destination)
              : <ProgressBar value={budgetUsedPct} showValue
                  tone={atRisk ? 'destructive' : budgetUsedPct >= 70 ? 'warning' : undefined}
                  aria-label={t('uxs02.budgetUsed', '{{percent}}% of Active budget', { percent: budgetUsedPct })} />}
          </dd>
        </div>
      </dl>

      {referenceRows.length > 0 && (
        <details className="min-w-0">
          <summary className="touch-target min-h-11 cursor-pointer break-words text-[12px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {t('uxs14.projectReferencesFor', 'More project references for {{name}}', { name: project.name })}
          </summary>
          <dl className="space-y-1 pt-1 text-xs text-muted-foreground">
            {referenceRows.map(([label, value]) => <div key={label}><dt className="sr-only">{label}</dt><dd className="break-all font-mono">{label}: {value}</dd></div>)}
          </dl>
        </details>
      )}

      <footer className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
        <span className="min-w-0 break-words text-sm text-muted-foreground">
          {t('projects.columns.pm', 'PM')}: {pmLabel}
        </span>
        {onEdit && <Button variant="ghost" size="sm" className="touch-target text-muted-foreground"
          onClick={() => onEdit(project)} aria-label={t('projects.card.editProject', 'Edit {{name}}', { name: project.name })}>
          <Icon name="pencil" />{t('projects.actions.edit', 'Edit')}
        </Button>}
      </footer>
    </article>
  );
};

export default ProjectCard;
