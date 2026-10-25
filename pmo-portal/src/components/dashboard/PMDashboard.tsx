import { projectDisplayName } from '@/src/lib/projectDisplayName';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { DeliveryPctChip } from '@/components/DeliveryPctChip';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { DashPageHead } from './layout';
import { AtRiskProjectsLink } from './AtRiskProjectsLink';
import { isActualComplete } from '@/src/lib/projectFinances';
import { ACTIVE_PROJECT_STATUSES, isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { pillVariantForProjectStatus } from '@/components/projects';
import { INTERNAL_STATUSES, ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';

const DELIVERY_PROJECT_STATUSES = new Set([...ON_HAND_STATUSES, ...INTERNAL_STATUSES]);
type ProjectSort = 'risk' | 'name';

const statusVariant = (status: string) => {
  const variant = pillVariantForProjectStatus(status);
  return variant === 'progress' ? 'neutral' : variant;
};

function actualIsComplete(project: PMDashboardProject): boolean {
  return isActualComplete({
    basis: 'erp',
    readSucceeded: project.spent !== null,
    complete: project.actual_complete,
    coverageCount: project.actual_coverage_count,
    coverageTotal: project.actual_coverage_total,
  });
}

function riskBasisIsKnown(project: PMDashboardProject): boolean {
  if (!ACTIVE_PROJECT_STATUSES.has(project.status)) return true;
  const actualComplete = actualIsComplete(project);
  const budgetCurrency = project.budget_currency ?? project.currency;
  const actualCurrency = project.actual_currency ?? project.currency;
  return project.budget !== null && Number.isFinite(project.budget) && project.budget > 0
    && budgetCurrency === project.currency
    && actualComplete
    && project.spent !== null && Number.isFinite(project.spent)
    && actualCurrency === project.currency;
}

function projectAtRisk(project: PMDashboardProject): boolean {
  return isMoneyAtRisk({
    status: project.status,
    budget: project.budget,
    budgetCurrency: project.budget_currency ?? project.currency,
    projectCurrency: project.currency,
    spent: project.spent,
    actualCurrency: project.actual_currency ?? project.currency,
    actualComplete: actualIsComplete(project),
  });
}

function compareProjectsByName(a: PMDashboardProject, b: PMDashboardProject): number {
  return projectDisplayName(a).localeCompare(projectDisplayName(b)) || a.id.localeCompare(b.id);
}

export const PMDashboard: React.FC = () => {
  const { t } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  const { data: assigned, isPending, isError, refetch } = usePMDashboardProjects();
  const mine = useMemo(
    () => (assigned ?? []).filter((project) => DELIVERY_PROJECT_STATUSES.has(project.status)),
    [assigned],
  );
  const orgCurrency = useOrgCurrency();
  const activeProjects = useMemo(() => mine.filter((project) => ACTIVE_PROJECT_STATUSES.has(project.status)), [mine]);
  const atRiskCount = useMemo(() => mine.filter(projectAtRisk).length, [mine]);
  const uncheckedCount = useMemo(
    () => activeProjects.filter((project) => !riskBasisIsKnown(project)).length,
    [activeProjects],
  );
  const hasUnknownMargin = mine.some((project) => project.realized_margin_pct === null);
  const hasUnknownRisk = uncheckedCount > 0;
  const [searchParams, setSearchParams] = useSearchParams();
  const sort: ProjectSort = searchParams.get('pmSort') === 'name' ? 'name' : 'risk';
  const openEvidenceId = searchParams.get('pmProjectEvidence');

  const updateParam = (key: string, value: string, defaultValue = '') => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (!value || value === defaultValue) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };
  const toggleEvidence = (projectId: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (next.get('pmProjectEvidence') === projectId) next.delete('pmProjectEvidence');
      else next.set('pmProjectEvidence', projectId);
      return next;
    });
  };

  const mineSorted = useMemo(() => [...mine].sort((a, b) => {
    if (sort === 'risk') {
      const riskOrder = Number(projectAtRisk(b)) - Number(projectAtRisk(a));
      if (riskOrder !== 0) return riskOrder;
    }
    return compareProjectsByName(a, b);
  }), [mine, sort]);

  const { data: deliveryPct, isPending: deliveryPending, isError: deliveryError, refetch: refetchDelivery } =
    useProjectsDelivery(mine.map((project) => project.id));
  const missingMilestoneCount = mine.filter((project) => project.status !== 'Close Out' && deliveryPct?.[project.id] === undefined).length;
  const hasUnknownDelivery = !deliveryPending && !deliveryError && missingMilestoneCount > 0;
  const hasUnknownContract = mine.some((project) => project.contract_value === null);

  const contractTotals = useMemo(() => {
    if (mine.length === 0) return [{ currency: orgCurrency, amount: 0, complete: true }];
    const totals = new Map<string, { amount: number; complete: boolean }>();
    for (const project of mine) {
      const current = totals.get(project.currency) ?? { amount: 0, complete: true };
      if (project.contract_value === null || !Number.isFinite(project.contract_value)) current.complete = false;
      else current.amount += project.contract_value;
      totals.set(project.currency, current);
    }
    return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, total]) => ({ currency, ...total }));
  }, [mine, orgCurrency]);

  const contractScope = contractTotals.map(({ currency, amount, complete }) => {
    const formatted = complete ? formatDashboardMoney(amount, currency) : null;
    return formatted ?? `— ${currency}`;
  }).join(' · ');

  const money = (amount: number | null, currency: string) => formatDashboardMoney(amount, currency) ?? '—';

  const showUnknownDataNote = !isPending && !isError && (hasUnknownRisk || hasUnknownMargin || hasUnknownContract || hasUnknownDelivery || deliveryError);

  return (
    <div className="space-y-4">
      <DashPageHead
        title={t('dashboard.pm.title', 'My Dashboard')}
        sub={t('dashboard.pm.deliveryScope', 'Delivery projects assigned to you.')}
      />

      <section aria-label={t('uxs03.attentionAndApprovals', 'Attention and approvals')} className="empty:hidden">
        <AwaitingApprovalTile includeTimesheets />
      </section>

      <Card>
        <div className="border-b border-border/70 px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardHead><span id="pm-delivery-projects-heading">{t('dashboard.pm.projectsTitle', 'My delivery projects')}</span></CardHead>
              <p data-testid="pm-project-scope" aria-describedby={hasUnknownContract && showUnknownDataNote ? 'pm-project-data-note' : undefined} className="mt-1 text-sm text-muted-foreground">
                {isPending || isError
                  ? t('uxs03.notAvailableYet', 'Not available yet')
                  : t('dashboard.pm.projectScope', '{{count}} delivery projects · Contract total: {{total}}', {
                    count: mine.length,
                    total: contractScope,
                  })}
              </p>
            </div>
            {!isPending && !isError && atRiskCount > 0 && (
              <AtRiskProjectsLink
                count={atRiskCount}
                className="inline-flex min-h-11 items-center font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            )}
            {!isPending && !isError && mine.length > 0 && (
              <label className="flex min-w-40 flex-col gap-1 text-xs text-muted-foreground">
                <span>{t('dashboard.pm.sortLabel', 'Sort projects')}</span>
                <select
                  data-testid="pm-project-sort"
                  aria-label={t('dashboard.pm.sortLabel', 'Sort projects')}
                  value={sort}
                  onChange={(event) => updateParam('pmSort', event.currentTarget.value, 'risk')}
                  className="min-h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <option value="risk">{t('dashboard.pm.sortRisk', 'At risk first')}</option>
                  <option value="name">{t('dashboard.pm.sortName', 'Project name')}</option>
                </select>
              </label>
            )}
          </div>
        </div>

        <div className="px-4 pb-2">
          {isPending ? (
            <ListState variant="loading" rows={3} />
          ) : isError ? (
            <ListState variant="error" title={t('dashboard.pm.loadError', "Couldn't load your projects")} onRetry={() => refetch()} />
          ) : mine.length === 0 ? (
            <div data-testid="pm-projects-empty" className="py-4">
              <p className="text-sm font-medium">{t('dashboard:pm.noProjects', 'No delivery projects assigned to you yet')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('dashboard:pm.noProjectsSub', 'Projects in the delivery phase will appear here.')}</p>
              <Link
                to="/projects?filter=My+Projects"
                className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {t('dashboard.pm.openMyProjects', 'Open my projects')}
              </Link>
            </div>
          ) : (
            <ol aria-labelledby="pm-delivery-projects-heading" className="divide-y divide-border/70">
              {mineSorted.map((project) => {
                const name = projectDisplayName(project);
                const isActive = ACTIVE_PROJECT_STATUSES.has(project.status);
                const isRiskUnknown = isActive && !riskBasisIsKnown(project);
                const isAtRisk = projectAtRisk(project);
                const isExpanded = openEvidenceId === project.id;
                const actualComplete = actualIsComplete(project)
                  && project.spent !== null && Number.isFinite(project.spent)
                  && (project.actual_currency ?? project.currency) === project.currency;
                const actual = actualComplete ? project.spent : null;
                const margin = project.realized_margin_pct === null ? null : project.realized_margin_pct * 100;
                const hasNoMilestones = project.status !== 'Close Out' && deliveryPct?.[project.id] === undefined;
                const comparisonPct = project.contract_value !== null && project.contract_value > 0 && actualComplete && actual !== null
                  ? (actual / project.contract_value) * 100
                  : null;
                const barPercent = comparisonPct === null ? null : Math.max(0, Math.min(100, comparisonPct));
                const evidenceId = `pm-project-evidence-${project.id}`;
                const rowNoteId = showUnknownDataNote && (isRiskUnknown || margin === null || project.contract_value === null || !actualComplete || hasNoMilestones)
                  ? 'pm-project-data-note'
                  : undefined;

                return (
                  <li key={project.id} data-testid={`pm-project-row-${project.id}`} className="py-3.5">
                    <div className="flex flex-col gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          to={`/projects/${project.id}`}
                          title={name !== project.name ? project.name : undefined}
                          className="inline-flex min-h-11 min-w-0 flex-1 items-center break-words text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {name}
                        </Link>
                        <StatusPill variant={statusVariant(project.status)}>{statusLabel(project.status)}</StatusPill>
                        {isAtRisk && <StatusPill variant="warn">{t('dashboard.pm.atRisk', 'At risk')}</StatusPill>}
                        {isActive && !isAtRisk && !isRiskUnknown && (
                          <span className="text-xs text-muted-foreground">{t('dashboard.pm.riskClear', 'No confirmed budget risk')}</span>
                        )}
                        {isRiskUnknown && (
                          <span data-testid={`pm-risk-unavailable-${project.id}`} aria-describedby={rowNoteId} className="text-xs text-muted-foreground">
                            {t('dashboard.pm.riskUnavailable', 'Risk unavailable')}
                          </span>
                        )}
                      </div>

                      <div className="grid min-w-0 grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                        <p className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{t('dashboard:pmRow.delivery', 'Delivery')}</span>
                          {deliveryPct?.[project.id] !== undefined ? (
                            <DeliveryPctChip pct={deliveryPct[project.id]} />
                          ) : deliveryError ? (
                            <button type="button" onClick={() => refetchDelivery()} className="inline-flex min-h-11 items-center text-left text-muted-foreground underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                              <span aria-hidden="true">—</span><span className="sr-only">{t('dashboard.pm.deliveryUnavailable', 'Delivery unavailable')}</span>
                              <span className="ml-2">{t('common.retry', 'Retry')}</span>
                            </button>
                          ) : deliveryPending ? (
                            <span role="img" aria-label={t('dashboard.pm.deliveryLoading', 'Loading delivery')} className="text-muted-foreground">—</span>
                          ) : (
                            <span role="img" aria-label={t('dashboard.pm.deliveryUnavailable', 'No delivery milestones are recorded.')} aria-describedby={rowNoteId} className="text-muted-foreground">
                              <span aria-hidden="true">—</span><span className="sr-only">{t('dashboard.pm.deliveryUnavailable', 'No delivery milestones are recorded.')}</span>
                            </span>
                          )}
                        </p>
                        <p className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{t('dashboard:pmRow.margin', 'Margin to date')}</span>
                          {margin === null ? (
                            <span role="img" aria-describedby={rowNoteId} aria-label={t('dashboard.pm.marginUnavailable', 'Margin unavailable')} className="font-semibold tabular text-muted-foreground">—</span>
                          ) : (
                            <span role="img" aria-label={t('dashboard:pmRow.marginAria', '{{name}} margin to date: {{pct}}%', { name: project.name, pct: margin.toFixed(1) })} className="font-semibold tabular">{margin.toFixed(1)}%</span>
                          )}
                        </p>
                      </div>

                      <button
                        type="button"
                        data-testid={`pm-project-evidence-toggle-${project.id}`}
                        aria-expanded={isExpanded}
                        aria-controls={evidenceId}
                        onClick={() => toggleEvidence(project.id)}
                        className="inline-flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-border px-3 text-left text-sm hover:bg-secondary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto sm:self-start"
                      >
                        <span>{isExpanded
                          ? t('dashboard.pm.hideEvidence', 'Hide project evidence for {{name}}', { name })
                          : t('dashboard.pm.showEvidence', 'Project evidence for {{name}}', { name })}</span>
                        <span aria-hidden="true">{isExpanded ? '−' : '+'}</span>
                      </button>

                      {isExpanded && (
                        <div id={evidenceId} data-testid={`pm-project-evidence-${project.id}`} className="grid min-w-0 gap-3 rounded-md bg-secondary/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                            <p className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                              <span className="text-muted-foreground">{t('dashboard.pm.actual', 'Actual')}</span>
                              {actual === null ? (
                                <span role="img" aria-describedby={rowNoteId} aria-label={t('dashboard.pm.actualUnavailable', 'Actual unavailable')} className="font-medium tabular">—</span>
                              ) : <span role="img" aria-label={`${t('dashboard.pm.actual', 'Actual')}: ${money(actual, project.actual_currency ?? project.currency)}`} className="font-medium tabular">{money(actual, project.actual_currency ?? project.currency)}</span>}
                            </p>
                            <p className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                              <span className="text-muted-foreground">{t('dashboard.pm.contract', 'Contract')}</span>
                              {project.contract_value === null
                                ? <span role="img" aria-describedby={rowNoteId} aria-label={t('dashboard.pm.contractUnavailable', 'Contract unavailable')} className="font-medium tabular">—</span>
                                : <span role="img" aria-label={`${t('dashboard.pm.contract', 'Contract')}: ${money(project.contract_value, project.currency)}`} className="font-medium tabular">{money(project.contract_value, project.currency)}</span>}
                            </p>
                            <div className="sm:col-span-2">
                              {barPercent !== null && comparisonPct !== null ? (
                                <div
                                  role="progressbar"
                                  aria-label={t('dashboard.pm.comparisonBar', '{{name}}: {{percent}}% of contract', { name, percent: Math.round(comparisonPct) })}
                                  aria-valuenow={barPercent}
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuetext={`${Math.round(comparisonPct)}% of contract`}
                                  className="h-2 overflow-hidden rounded-full bg-secondary"
                                >
                                  <span aria-hidden="true" className="block h-full rounded-full bg-muted-foreground" style={{ width: `${barPercent}%` }} />
                                </div>
                              ) : (
                                <p aria-describedby={rowNoteId} className="text-xs text-muted-foreground">
                                  {t('dashboard.pm.comparisonUnavailable', 'Comparison unavailable; Actual or contract coverage is incomplete.')}
                                </p>
                              )}
                            </div>
                          </div>
                          <Link
                            to={`/projects/${project.id}/budget`}
                            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {t('dashboard.pm.openBudgetFor', 'Open budget for {{name}}', { name })}
                          </Link>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {showUnknownDataNote && (
          <aside id="pm-project-data-note" data-testid="pm-project-data-note" className="border-t border-border/70 px-4 py-3 text-xs text-muted-foreground" aria-label={t('dashboard.pm.dataNotes', 'Project data notes')}>
            <p className="font-medium text-foreground">{t('dashboard.pm.dataNotes', 'Project data notes')}</p>
            <ul className="mt-1 list-inside list-disc space-y-1">
              {hasUnknownRisk && <li>{t('dashboard.pm.riskUnavailableNote', 'Risk needs a positive active budget and complete, comparable Actual.')}</li>}
              {hasUnknownMargin && <li>{t('dashboard.pm.marginUnavailableNote', 'Margin needs billed-work revenue and complete Actual.')}</li>}
              {hasUnknownContract && <li>{t('dashboard.pm.contractUnavailableNote', 'Contract totals need a recorded value for each assigned project.')}</li>}
              {deliveryError && <li>{t('dashboard.pm.deliveryUnavailableNote', 'Delivery progress could not be loaded; retry the delivery query.')}</li>}
              {hasUnknownDelivery && <li>{t('dashboard.pm.noMilestonesNote', 'No milestone progress was supplied for some projects; open a project to review its milestones.')}</li>}
            </ul>
            {hasUnknownDelivery && (
              <Link to="/projects?filter=My+Projects" className="mt-2 inline-flex min-h-11 items-center font-medium text-primary-text underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                {t('dashboard.pm.openMyProjects', 'Open my projects')}
              </Link>
            )}
          </aside>
        )}
      </Card>
    </div>
  );
};
