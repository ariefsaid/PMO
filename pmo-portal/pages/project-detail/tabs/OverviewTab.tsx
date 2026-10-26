import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, StatusPill, ListState, HoursBar } from '@/src/components/ui';
import { formatCurrency } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { ProjectFinancesSection } from '../ProjectFinancesSection';
import { useProjectProcurements, type CommitmentSource, type CommittedOtherCurrencies } from '@/src/hooks/useProcurements';
import { useBudgetVersions, useProjectBudget } from '@/src/hooks/useBudget';
import { summarizeProcurement, recentRequests } from '@/src/lib/procurement-summary';
import { activeSnapshot } from '@/src/lib/budget-snapshot';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { buildProjectMoneyPosition } from '@/src/lib/projectFinances';
import { pillVariantForStatus, stageLabelForStatus, openPR } from '../../../components/procurement';
import { projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { projectSectionHeading, projectSubsectionHeading } from '../typography';
import { formatProjectDetailAmount } from '../formatProjectDetailMoney';

export interface OverviewTabProps {
  project: ProjectWithRefs;
  committedSpend?: number;
  /** Committed amounts in other currencies — named beside the figure, never added to it (0373). */
  committedOtherCurrencies?: CommittedOtherCurrencies;
  commitmentSource?: CommitmentSource;
  ledgerBasis?: 'pmo' | 'erp' | 'unavailable';
  commitmentPending?: boolean;
  commitmentError?: boolean;
  /** Callback to switch to a sibling tab (budget / procurement). */
  setTab?: (tab: 'overview' | 'budget' | 'procurement' | 'tasks' | 'documents') => void;
  /** A compact current-phase/blocker signal and the actionable planner, in that order. */
  phaseSummary?: React.ReactNode;
  phasePlanner?: React.ReactNode;
  /** Pre-win/lost replaces the delivery money band with the PipelineLens. */
  showMoneyPosition?: boolean;
}

/**
 * Phase 5 (T14-T18): densified Overview tab.
 * PD-B: every block renders only when it has data (or failed to load) — the Budget snapshot
 * carries budget use % + At risk; Procurement summary needs ≥1 request; Drawdown needs a work order.
 * Both new cards use real data only — no fabricated content (plan §1).
 * setTab prop enables footer links to switch tabs without router navigation.
 *
 * L3-RECORD: the record-identifying fields (customer / PM / dates / code / PO ref)
 * now live in the persistent page rail, so Overview no longer duplicates them.
 */
const OverviewTab: React.FC<OverviewTabProps> = ({ project, committedSpend, ledgerBasis = 'unavailable', commitmentPending = false, commitmentError = false, setTab, phaseSummary, phasePlanner, showMoneyPosition = true }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  // The delivery money position has no job on pipeline/lost records, whose figures belong to
  // PipelineLens. Keep the project-wide finance read scoped to the delivery surface as well.
  const group = projectStatusGroup(project.status as never);
  const isDelivery = showMoneyPosition && (group === 'onHand' || group === 'internal');
  // AC-W2-1-FE-01: use the DERIVED budget (Σ Active-version line-items) not the dead stored
  // projects.budget column.  The Budget-snapshot card already uses activeSnapshot (derived);
  // this aligns the utilization card + at-risk gate to the same source.
  // B-0.4: budget state remains distinct from a missing or unavailable Actual reading.
  const { data: derivedBudget } = useProjectBudget(project.id);
  const activeBudget = derivedBudget ?? 0;
  const { data: projectFinances } = useProjectFinances(project.id, { enabled: isDelivery });
  const actuals = ledgerBasis === 'erp' && !may('view', 'salesInvoice') ? undefined : projectFinances?.actuals;
  const moneyPosition = buildProjectMoneyPosition({ ledgerBasis,
    committedSpend, commitmentPending, commitmentError, projectCurrency: project.currency, actuals,
    contractValue: project.contract_value, activeBudget });
  const actualPosition = moneyPosition.actual;
  const actualSpend = moneyPosition.comparableActual;
  const budgetUtilPctValue = moneyPosition.spendPercent;
  // Missing or partial Actual data cannot become a false zero-risk result.
  const budgetUtil = isMoneyAtRisk({
    status: project.status as string, budget: activeBudget,
    budgetCurrency: projectFinances?.budget?.currency ?? project.currency, projectCurrency: project.currency,
    spent: actualSpend, actualCurrency: actualPosition.currency,
    actualComplete: actualPosition.complete,
  }) ? budgetUtilPctValue : null;
  const exactMoney = (value: number) => formatProjectDetailAmount(value, project.currency, i18n.language)
    ?? t('projectFinances.unavailable', 'Unavailable');

  // T14/T15 — Procurement summary (project-filtered server-side)
  const { data: projectProcData, isPending: procPending, isError: procError, refetch: procRefetch } = useProjectProcurements(project.id);
  const projectProc = useMemo(() => projectProcData ?? [], [projectProcData]);
  const procSummary = useMemo(() => summarizeProcurement(projectProc, project.currency), [projectProc, project.currency]);
  const top3Proc = useMemo(() => recentRequests(projectProc, 3), [projectProc]);
  const requestValueSummary = procSummary.requestValueByCurrency
    .map(({ currency, amount }) => formatCurrency(amount, currency))
    .join(' · ');

  // T16/T17 — Budget snapshot
  const { data: budgetVersions, isPending: budgetPending, isError: budgetError, refetch: budgetRefetch } = useBudgetVersions(project.id);
  const snapshot = useMemo(
    () => actualSpend === null ? null : activeSnapshot(budgetVersions ?? [], actualSpend),
    [budgetVersions, actualSpend],
  );

  const showProc = procPending || procError || projectProc.length > 0;
  const budgetPositionSupplement = (
    <div data-testid="overview-budget-position" className="min-w-0 space-y-2">
      <h4 className={projectSubsectionHeading}>{t('uxs01.budgetPosition', 'Budget position')}</h4>
      {budgetPending ? <ListState variant="loading" rows={1} className="min-h-12" /> : budgetError ? (
        <ListState variant="error" title={t('projectDetail.overview.budgetSnapshot.error', "Couldn't load budget")} onRetry={() => budgetRefetch()} />
      ) : snapshot ? (
        <>
          <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t('project:projectDetail.moneyPosition.activeBudget', 'Active budget')}</dt>
              <dd className="break-words font-semibold tabular-nums">{exactMoney(snapshot.activeTotal)}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t('projectDetail.overview.budgetUtil.variance', 'Variance')}</dt>
              <dd data-testid="budget-variance" className="break-words font-semibold tabular-nums">
                {snapshot.variance > 0
                  ? t('uxs01.overBudgetBy', 'Over budget by {{amount}}', { amount: exactMoney(snapshot.variance) })
                  : snapshot.variance < 0
                    ? t('uxs01.budgetRemaining', 'Budget remaining {{amount}}', { amount: exactMoney(Math.abs(snapshot.variance)) })
                    : t('uxs01.onBudget', 'On budget')}
              </dd>
            </div>
            {budgetUtilPctValue !== null && <div className="col-span-2">
              <dt className="text-xs text-muted-foreground">{t('projectDetail.overview.budgetUtil.ofBudget', 'of budget')}</dt>
              <dd data-testid="budget-used" className="flex flex-wrap items-center gap-2 font-semibold tabular-nums">
                <span>{budgetUtilPctValue}% {t('projectDetail.overview.budgetUtil.ofBudget', 'of budget')}</span>
                {budgetUtil !== null && <StatusPill variant="warn">{t('projectDetail.overview.budgetUtil.atRisk', 'At risk')}</StatusPill>}
              </dd>
            </div>}
          </dl>
          {snapshot.byCategory.length > 0 && <details className="min-w-0">
            <summary className="cursor-pointer text-sm font-medium">{t('project:projectDetail.moneyPosition.budgetCategories', 'Budget categories')}</summary>
            <div role="group" aria-label={t('projectDetail.overview.budgetSnapshot.byCategoryLabel', 'Budget by category')} className="mt-2 flex min-w-0 flex-col gap-1">
              {snapshot.byCategory.map((cat) => <HoursBar
                key={cat.category}
                label={cat.category}
                code={null}
                hours={cat.amount}
                maxHours={snapshot.activeTotal}
                formatValue={(value) => exactMoney(value)}
              />)}
            </div>
          </details>}
          {setTab && <button type="button" onClick={() => setTab('budget')} className="min-h-11 text-left text-sm font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('projectDetail.overview.budgetSnapshot.openBudgetTab', 'Open Budget tab')}
          </button>}
        </>
      ) : budgetVersions?.some((version) => version.status === 'Active') && activeBudget > 0 ? (
        <p className="break-words font-semibold tabular-nums">{exactMoney(activeBudget)}</p>
      ) : <p className="text-sm text-muted-foreground">{t('project:projectDetail.moneyPosition.noActiveBudget', 'No active budget')}</p>}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {isDelivery && (may('view', 'salesInvoice')
        ? <ProjectFinancesSection project={project} costSupplement={budgetPositionSupplement} />
        : <section role="group" aria-label={t('project:projectDetail.moneyPosition.spending', 'Spending')} className="min-w-0 space-y-4">
          <h2 className={projectSectionHeading}>{t('project:projectDetail.moneyPosition.spending', 'Spending')} · {project.currency}</h2>
          {budgetPositionSupplement}
        </section>)}
      {isDelivery && <section aria-label={t('project:projectDetail.sectionNav.delivery', 'Delivery')} className="min-w-0 space-y-4">
        <h2 className={projectSectionHeading}>{t('project:projectDetail.sectionNav.delivery', 'Delivery')}</h2>
        {phaseSummary}
        {phasePlanner}
      </section>}
      {!isDelivery && phaseSummary}
      {!isDelivery && phasePlanner}
      {showProc && <div data-testid="overview-procurement-summary" className="min-w-0">
        {/* T14/T15 — Procurement summary card */}
        {showProc && <Card variant="bare">
          <CardHead className={`border-0 px-0 py-0 ${projectSectionHeading}`}>
            {t('projectDetail.overview.procSummary.title', 'Procurement summary')}
          </CardHead>
          {procPending ? <ListState variant="loading" rows={3} /> : procError ? (
            <ListState
              variant="error"
              title={t('projectDetail.overview.procSummary.error', "Couldn't load procurement")}
              onRetry={() => procRefetch()}
            />
          ) : (
            <CardPad className="flex flex-col gap-4">
              {/* Count strip — 3 plain buckets (not 6 same-hue dots) */}
              <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5">
                  {/* Freed-Blue Status Rule: "Open" is neutral grey `progress`, not the action-blue. */}
                  <StatusPill variant="progress">
                    {procSummary.open} {t('projectDetail.overview.procSummary.open', 'Open')}
                  </StatusPill>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusPill variant="won">
                    {procSummary.completed} {t('projectDetail.overview.procSummary.completed', 'Completed')}
                  </StatusPill>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusPill variant="neutral">
                    {procSummary.closed} {t('projectDetail.overview.procSummary.closed', 'Closed')}
                  </StatusPill>
                </div>
              </div>

              {/* Committed total */}
              <div className="text-xs text-muted-foreground">
                {/* #571 — one sentence; the styled amount is a placeholder a translator moves. */}
                <Trans
                  i18nKey="uxs01.totalRequestValueAcross"
                  defaults="Total request value: <amount>{{amount}}</amount> across {{n}} {{unit}}"
                  values={{
                  amount: requestValueSummary,
                  n: String(procSummary.totalCount),
                    unit:
                      procSummary.count === 1
                        ? t('projectDetail.overview.procSummary.requestOne', 'request')
                        : t('projectDetail.overview.procSummary.requestOther', 'requests'),
                  }}
                  components={{
                    amount: <span className="font-semibold tabular text-foreground text-sm" />,
                  }}
                />
              </div>

              {/* Top 3 recent requests */}
              {top3Proc.length > 0 && (
                <ul className="divide-y divide-border/70 -mx-4">
                  {top3Proc.map((pr) => (
                    <li key={pr.id}>
                      <button
                        type="button"
                        onClick={() => openPR(navigate, pr)}
                        className="w-full flex items-center gap-3 px-4 py-[9px] text-left hover:bg-accent/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-1.5 min-w-0">
                            <span className="truncate text-sm font-semibold">{pr.title}</span>
                            {pr.code && (
                              <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{pr.code}</span>
                            )}
                          </div>
                          <div className="mt-0.5">
                            <StatusPill variant={pillVariantForStatus(pr.status as Parameters<typeof pillVariantForStatus>[0])}>
                              {stageLabelForStatus(pr.status as Parameters<typeof stageLabelForStatus>[0])}
                            </StatusPill>
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular text-foreground">
                          {formatCurrency(Number(pr.total_value), pr.currency || project.currency)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Footer link */}
              {setTab && (
                <button
                  type="button"
                  onClick={() => setTab('procurement')}
                  className="touch-target inline-flex min-h-11 items-center self-start text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t('projectDetail.overview.procSummary.viewAll', 'View all procurement')}
                </button>
              )}
            </CardPad>
          )}
        </Card>}

      </div>}
    </div>
  );
};

export default OverviewTab;
