import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { Link } from 'react-router';
import { usePMDashboardProjects } from '@/src/hooks/useDashboard';
import { useProjectsDelivery } from '@/src/hooks/useProjectsDelivery';
import { DeliveryPctChip } from '@/components/DeliveryPctChip';
import { KPITile } from '@/src/components/ui/KPITile';
import { AwaitingApprovalTile } from './AwaitingApprovalTile';
import { Card, CardHead } from '@/src/components/ui/Card';
import { StatusPill } from '@/src/components/ui/StatusPill';
import { ListState } from '@/src/components/ui/ListState';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { BvACard } from './BvACard';
import { DashPageHead, DashGrid } from './layout';
import type { PMDashboardProject } from '@/src/lib/db/dashboard';
import { isActualComplete } from '@/src/lib/projectFinances';
import { isMoneyAtRisk, riskCheckableFor } from '@/src/lib/dashboardConstants';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { pillVariantForProjectStatus } from '@/components/projects';
import { INTERNAL_STATUSES, ON_HAND_STATUSES } from '@/src/lib/db/projectTransitions';

const DELIVERY_PROJECT_STATUSES = new Set([...ON_HAND_STATUSES, ...INTERNAL_STATUSES]);

const statusVariant = (status: string) => {
  const v = pillVariantForProjectStatus(status);
  return v === 'progress' ? 'neutral' : v;
};

const projectAtRisk = (p: PMDashboardProject) => isMoneyAtRisk({
  status: p.status, budget: p.budget, budgetCurrency: p.budget_currency ?? p.currency, projectCurrency: p.currency,
  spent: p.spent, actualCurrency: p.actual_currency ?? p.currency,
  actualComplete: isActualComplete({ basis: 'erp', readSucceeded: p.spent !== null, complete: p.actual_complete,
    coverageCount: p.actual_coverage_count, coverageTotal: p.actual_coverage_total }),
});

// Project-status pill comes from the canonical project-status map
// (`pillVariantForProjectStatus`), which routes through the single status registry's
// Freed-Blue Status Rule: on-hand execution ("Ongoing Project") is neutral grey
// `progress` — NOT the action-blue (the distinct LABEL carries identity).

/**
 * Project-Manager pane — real off `useProjects` (filtered to my projects). The
 * approvals KPI is now the real combined `AwaitingApprovalTile` (PRs a PM can
 * approve + timesheets awaiting), routing to the unified `/approvals` inbox — the
 * prior fake procurement-approvals placeholder is gone (Wave-5 N15).
 */
export const PMDashboard: React.FC = () => {
  const { t, i18n } = useTranslation('dashboard');
  const statusLabel = useProjectStatusLabel();
  const { data: assigned, isPending, isError, refetch } = usePMDashboardProjects();
  // D-019: count the canonical on-hand + internal delivery partition, not pipeline or lost bids.
  const mine = useMemo(() => (assigned ?? []).filter((p) => DELIVERY_PROJECT_STATUSES.has(p.status)), [assigned]);
  const orgCurrency = useOrgCurrency();
  const contractCurrency = mine[0]?.currency;
  const contractValue = useMemo(() => mine.every((p) => p.contract_value !== null && p.currency === contractCurrency)
    ? mine.reduce((s, p) => s + (p.contract_value ?? 0), 0) : null, [mine, contractCurrency]);
  const atRiskCount = useMemo(() => mine.filter(projectAtRisk).length, [mine]);
  const riskCheckable = useMemo(() => {
    const unchecked = mine.filter((project) => !(project.budget !== null && Number.isFinite(project.budget) && project.budget > 0
      && project.budget_currency === project.currency && project.actual_complete
      && project.spent !== null && Number.isFinite(project.spent)
      && (project.actual_currency ?? project.currency) === project.currency)).length;
    return riskCheckableFor(mine.length, unchecked);
  }, [mine]);

  // AC-IXD-DASH-W5-C2C N18: sort at-risk projects first (stable secondary order).
  const mineSorted = useMemo(
    () => [...mine].sort((a, b) => {
      const riskA = projectAtRisk(a);
      const riskB = projectAtRisk(b);
      return Number(riskB) - Number(riskA);
    }), [mine],
  );

  // FR-DEL-017: one batched delivery-% call for all PM projects (NFR-DEL-PERF-001).
  const { data: deliveryPct } = useProjectsDelivery(mine.map((p) => p.id));

  const bvaProjects: PMDashboardProject[] = mine;

  return (
    <div className="space-y-4">
      <DashPageHead title={t('dashboard.pm.title', 'My Dashboard')} sub={t('dashboard.pm.subtitle', 'Your projects, budget health, and approvals queue.')} />

      <section aria-label={t('uxs03.attentionAndApprovals', 'Attention and approvals')} className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2">
        <AwaitingApprovalTile includeTimesheets />
      </section>

      <section aria-label={t('dashboard.pm.kpiBand', 'My KPIs')} className="grid grid-cols-1 gap-3 min-[560px]:grid-cols-2 min-[1180px]:grid-cols-4">
        {/* AC-IXD-DASH-W5-C2A: My projects → /projects?filter=My+Projects */}
        <KPITile testId="kpi-my-projects" tone="violet" icon="folder" label={t('dashboard.pm.myProjects', 'My projects')}
          value={String(mine.length)} loading={isPending} error={isError}
          to="/projects?filter=My+Projects"
          linkLabel={t('dashboard.pm.openMyProjects', 'Open my projects')}
          help={t('dashboard:pm.myProjectsHelp', 'Delivery projects where you are the assigned project manager.')} />
        {/* AC-IXD-DASH-W5-C2A: My contract value → /projects?filter=My+Projects */}
        <KPITile testId="kpi-my-contract-value" tone="green" icon="dollar" label={t('dashboard.pm.contractValue', 'My contract value')}
          value={contractValue === null ? t('uxs03.notAvailableYet', 'Not available yet') : formatDashboardMoney(contractValue, contractCurrency ?? orgCurrency, i18n.language) ?? t('uxs03.notAvailableYet', 'Not available yet')} loading={isPending} error={isError}
          to="/projects?filter=My+Projects"
          linkLabel={t('dashboard.pm.openContractValue', 'Open my projects to see contract value')}
          help={t('dashboard.pm.contractValueHelp', 'Total contract value across your projects.')} />
        {/* AC-IXD-DASH-W5-C2A: At risk → /projects?filter=at-risk */}
        <KPITile testId="kpi-at-risk" tone="amber" icon="alert" label={t('dashboard.pm.atRisk', 'At risk')}
          value={riskCheckable || atRiskCount > 0 ? String(atRiskCount) : t('dashboard:risk.unavailable', "Can't be checked yet")}
          loading={isPending} error={isError}
          vs={riskCheckable || atRiskCount > 0 ? t('dashboard.pm.budgetUsage', 'budget usage > 90%') : t('dashboard:risk.noBudgetBasis', 'An active budget and complete actuals are needed to check risk.')}
          to="/projects?filter=at-risk"
          linkLabel={t('dashboard.pm.openAtRisk', 'Open my at-risk projects')}
          help={t('dashboard.pm.atRiskHelp', 'Your projects whose actual spend exceeds 90% of budget.')} />
      </section>

      <DashGrid>
        <Card>
          <CardHead>{t('uxs03.spendingContract', 'Spending vs contract')}</CardHead>
          <div className="px-4 pb-3.5">
            {isError ? (
              <ListState variant="error" title={t('dashboard.pm.loadError', "Couldn't load your projects")} onRetry={() => refetch()} />
            ) : isPending ? (
              <ListState variant="loading" />
            ) : mine.length === 0 ? (
              <ListState variant="empty" icon="folder" title={t('dashboard:pm.noProjects', 'No delivery projects assigned to you yet')}
                sub={t('dashboard:pm.noProjectsSub', 'Projects in the delivery phase will appear here.')} />
            ) : (
              <BvACard projects={bvaProjects} currency={orgCurrency} />
            )}
          </div>
        </Card>

        <Card role="region" aria-labelledby="pm-project-status-heading">
          <CardHead><span id="pm-project-status-heading">{t('dashboard.pm.statusTitle', 'Project Status')}</span><span className="ml-2 text-[12px] font-normal text-muted-foreground">{t('uxs03.marginToDate', 'Margin to date')}</span></CardHead>
          <div className="px-4 pb-3.5">
            {isPending ? (
              <ListState variant="loading" />
            ) : isError ? (
              <ListState variant="error" title={t('dashboard.pm.loadError', "Couldn't load your projects")} onRetry={() => refetch()} />
            ) : mine.length === 0 ? (
              <ListState variant="empty" icon="folder" title={t('dashboard.pm.nothingToShow', 'Nothing to show yet')} />
            ) : (
              <ul className="divide-y divide-border/70">
                {mineSorted.map((p) => {
                  const margin = p.realized_margin_pct === null ? null : p.realized_margin_pct * 100;
                  const marginClass =
                    margin === null
                      ? 'text-muted-foreground'
                      : margin < 10
                        ? 'text-destructive'
                        : 'text-foreground';
                  const atRisk = projectAtRisk(p);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-3">
                      <Link
                        to={`/projects/${p.id}`}
                        title={p.name}
                        className="min-w-[8rem] flex-1 truncate text-[13px] font-medium hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      >
                        {p.name}
                      </Link>
                      {/* AC-IXD-DASH-W5-C2C N18: text+dot pill on at-risk rows (not color-only). */}
                      {atRisk && <StatusPill variant="warn">{t('dashboard.pm.atRisk', 'At risk')}</StatusPill>}
                      {/* FR-DEL-017: delivery-% chip (absent when project has no milestones). */}
                      {deliveryPct?.[p.id] != null && (
                        <span className="flex shrink-0 items-center gap-1">
                          <span className="text-[11.5px] text-muted-foreground">{t('dashboard:pmRow.delivery', 'Delivery')}</span>
                          <DeliveryPctChip pct={deliveryPct[p.id]} />
                        </span>
                      )}
                      {/* D-021: one dot marker for every status — the progress halo ring made Ongoing look different. */}
                      <StatusPill variant={statusVariant(p.status)}>{statusLabel(p.status)}</StatusPill>
                      <span className="flex shrink-0 items-baseline gap-1">
                        <span className="text-[11.5px] text-muted-foreground">{t('dashboard:pmRow.margin', 'Margin')}</span>
                        <span
                          role="img"
                          aria-label={margin !== null ? t('dashboard:pmRow.marginAria', '{{name}} margin to date: {{pct}}%', { name: p.name, pct: margin.toFixed(1) }) : undefined}
                          className={`min-w-12 text-right text-[13px] font-bold ${margin !== null ? 'tabular' : ''} ${marginClass}`}
                        >
                          {margin !== null ? `${margin.toFixed(1)}%` : t('uxs03.notAvailableYet', 'Not available yet')}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </DashGrid>

    </div>
  );
};
