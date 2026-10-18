import React, { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ProgressBar, StatusPill, ListState, HoursBar, StatTiles, Icon, TaxBasisLabel, type StatTile } from '@/src/components/ui';
import { formatCurrency, formatInstantDate } from '@/src/lib/format';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { ProjectFinancesSection } from '../ProjectFinancesSection';
import { useProjectProcurements, type CommitmentSource } from '@/src/hooks/useProcurements';
import { useBudgetVersions, useProjectBudget } from '@/src/hooks/useBudget';
import { summarizeProcurement, recentRequests } from '@/src/lib/procurement-summary';
import { activeSnapshot } from '@/src/lib/budget-snapshot';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { buildProjectMoneyPosition, formatExactMoney, formatSignedExactMoney } from '@/src/lib/projectFinances';
import { pillVariantForStatus, stageLabelForStatus, openPR } from '../../../components/procurement';
import { ON_HAND_STATUSES, projectStatusGroup } from '@/src/lib/db/projectTransitions';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import ProjectDrawdown from '../ProjectDrawdown';
import FxEquivalent from '@/src/components/fx/FxEquivalent';

export interface OverviewTabProps {
  project: ProjectWithRefs;
  committedSpend?: number;
  commitmentSource?: CommitmentSource;
  ledgerBasis?: 'pmo' | 'erp' | 'unavailable';
  commitmentPending?: boolean;
  commitmentError?: boolean;
  /** Callback to switch to a sibling tab (budget / procurement). */
  setTab?: (tab: 'overview' | 'budget' | 'procurement' | 'tasks' | 'documents') => void;
  /**
   * D15 (OD-W5-C3-A): when true the Overview tab renders the "Financial summary" aside
   * — the finance StatTiles + contract-value SoD row relocated from the page header for
   * delivery-forward roles (Engineer). Finance-forward roles (Admin·Exec·Finance·PM) keep
   * the finance block in the header; showFinanceSummary is false/omitted for them.
   * Always read-only (lock pill, no edit affordance) — mutations stay in the header for
   * finance-forward roles; the Engineer never gets a contract-value edit control.
   */
  showFinanceSummary?: boolean;
}

/**
 * Phase 5 (T14-T18): densified Overview tab.
 * Row 1: Budget utilization (unchanged).
 * Row 2 (NEW): Procurement summary card + Budget snapshot card.
 * Both new cards use real data only — no fabricated content (plan §1).
 * setTab prop enables footer links to switch tabs without router navigation.
 *
 * L3-RECORD: the record-identifying fields (customer / PM / dates / code / PO ref)
 * now live in the persistent page rail, so Overview no longer duplicates them.
 *
 * D15 (OD-W5-C3-A): when showFinanceSummary is true (delivery-forward / Engineer role),
 * a read-only "Financial summary" aside renders near the top of the Overview tab.
 * Finance-forward roles (Admin·Exec·Finance·PM) keep the header unchanged; this section
 * is not rendered for them (showFinanceSummary is false/omitted).
 */
const OverviewTab: React.FC<OverviewTabProps> = ({ project, committedSpend, commitmentSource = 'unavailable', ledgerBasis = 'unavailable', commitmentPending = false, commitmentError = false, setTab, showFinanceSummary = false }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  // AC-W2-1-FE-01: use the DERIVED budget (Σ Active-version line-items) not the dead stored
  // projects.budget column.  The Budget-snapshot card already uses activeSnapshot (derived);
  // this aligns the utilization card + at-risk gate to the same source.
  // B-0.4: budget state remains distinct from a missing or unavailable Actual reading.
  const { data: derivedBudget, isPending: budgetUtilPending, isError: budgetUtilError, refetch: budgetUtilRefetch } = useProjectBudget(project.id);
  const activeBudget = derivedBudget ?? 0;
  const { data: projectFinances } = useProjectFinances(project.id);
  const actuals = ledgerBasis === 'erp' && !may('view', 'salesInvoice') ? undefined : projectFinances?.actuals;
  const moneyPosition = buildProjectMoneyPosition({ ledgerBasis,
    committedSpend, commitmentPending, commitmentError, projectCurrency: project.currency, actuals,
    contractValue: project.contract_value, activeBudget });
  const actualPosition = moneyPosition.actual;
  const actualSpend = moneyPosition.comparableActual;
  const actualSpendLabel = moneyPosition.headlineState === 'available' && actualPosition.amount !== null && actualPosition.currency
    ? formatExactMoney(actualPosition.amount, actualPosition.currency, i18n.language) ?? t('uxs01.actualUnavailable', 'Unavailable')
    : moneyPosition.headlineState === 'loading'
      ? t('uxs01.actualLoading', 'Loading Actual…')
      : moneyPosition.headlineState === 'partial'
        ? t('uxs01.actualPartial', 'Incomplete — see spending details')
        : t('uxs01.actualUnavailable', 'Unavailable');
  const actualCoverage = moneyPosition.coverage.kind === 'pmo'
    ? t('uxs01.pmoCoverage', 'Committed PMO purchase orders')
    : moneyPosition.coverage.kind === 'complete'
      ? t('uxs01.completeCoverage', 'Complete category coverage')
      : moneyPosition.coverage.kind === 'partial'
        ? t('uxs01.partialCoverage', 'Partial coverage · {{mapped}} of {{total}} categories recorded', { mapped: moneyPosition.coverage.mapped, total: moneyPosition.coverage.total })
        : t('uxs01.coverageUnavailable', 'Spending coverage unavailable');
  const budgetUtilPctValue = moneyPosition.spendPercent;
  // The risk gate consumes complete Actual (DD-MONEY-1) and the Active budget; missing Actuals
  // cannot be promoted to a zero-cost, low-risk result.
  const budgetUtil = isMoneyAtRisk({
    status: project.status as string, budget: activeBudget,
    budgetCurrency: projectFinances?.budget?.currency ?? project.currency, projectCurrency: project.currency,
    spent: actualSpend, actualCurrency: actualPosition.currency,
    actualComplete: actualPosition.complete,
  }) ? budgetUtilPctValue : null;

  // D15: finance summary tile data (only computed when showFinanceSummary is true).
  const contractAfterCost = moneyPosition.contractAfterCost;
  const contractAfterCostTone = moneyPosition.contractAfterCostTone;
  const contractAfterCostLabel = contractAfterCost === null
    ? t('uxs01.actualUnavailable', 'Unavailable')
    : formatSignedExactMoney(contractAfterCost, project.currency, i18n.language) ?? t('uxs01.actualUnavailable', 'Unavailable');
  const spendPctTile = moneyPosition.spendPercent;
  const financeTiles: StatTile[] = showFinanceSummary
    ? [
        {
          label: t('projectDetail.overview.finance.contract', 'Contract'),
          value: (
            <>
              <span>{project.contract_value == null ? t('uxs01.actualUnavailable', 'Unavailable') : formatCurrency(project.contract_value, project.currency)}</span>
              <FxEquivalent amount={project.contract_value} currency={project.currency} date={project.contract_date} />
            </>
          ),
          // OD-TAX-1 §2 — the delivery-role lens shows the same ceiling as the header strip, so it
          // states the same basis, read off this project's own row.
          sub: <TaxBasisLabel treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator} testId="overview-contract-tax-basis" />,
        },
        {
          label: t('uxs01.pmoPurchaseOrders', 'PMO purchase orders'),
          value: commitmentSource === 'pmo'
            ? commitmentPending
              ? t('uxs01.actualLoading', 'Loading Actual…')
              : commitmentError || committedSpend === undefined
                ? t('uxs01.actualUnavailable', 'Unavailable')
                : formatCurrency(committedSpend, project.currency)
            : commitmentSource === 'not-tracked'
              ? t('uxs01.notTrackedInPmo', 'Not tracked in PMO yet')
              : t('uxs01.actualUnavailable', 'Unavailable'),
        },
        {
          label: t('projectDetail.overview.finance.actual', 'Actual'),
          value: actualSpendLabel,
          sub: actualPosition.complete ? <>{actualCoverage}{actualPosition.asOf && <span className="block">{t('uxs01.updated', 'Updated {{date}}', { date: formatInstantDate(actualPosition.asOf) })}</span>}</> : undefined,
        },
        {
          label: t('uxs01.contractRemainingAfterCost', 'Contract remaining after cost'),
          value: contractAfterCostLabel,
          ...(contractAfterCostTone === undefined ? {} : { tone: contractAfterCostTone }),
        },
        {
          label: t('projectDetail.overview.finance.spend', 'Spend'),
          value: budgetUtilPending
            ? t('uxs01.budgetLoading', 'Loading budget…')
            : budgetUtilError
              ? t('uxs01.actualUnavailable', 'Unavailable')
              : activeBudget <= 0
                ? t('uxs01.noActiveBudget', 'No active budget')
                : spendPctTile === null
                  ? t('uxs01.actualUnavailable', 'Unavailable')
                  : `${spendPctTile}%`,
        },
      ]
    : [];

  // D15: financial-summary visibility — delivery lens only (on-hand ∪ internal projects).
  const group = projectStatusGroup(project.status as never);
  const isDelivery = showFinanceSummary && (group === 'onHand' || group === 'internal');
  const isOnHand = showFinanceSummary ? ON_HAND_STATUSES.includes(project.status as string) : false;

  // T14/T15 — Procurement summary (project-filtered server-side)
  const { data: projectProcData, isPending: procPending, isError: procError, refetch: procRefetch } = useProjectProcurements(project.id);
  const projectProc = useMemo(() => projectProcData ?? [], [projectProcData]);
  const procSummary = useMemo(() => summarizeProcurement(projectProc), [projectProc]);
  const top3Proc = useMemo(() => recentRequests(projectProc, 3), [projectProc]);

  // T16/T17 — Budget snapshot
  const { data: budgetVersions, isPending: budgetPending, isError: budgetError, refetch: budgetRefetch } = useBudgetVersions(project.id);
  const hasActiveBudget = budgetVersions?.some((version) => version.status === 'Active') ?? false;
  const snapshot = useMemo(
    () => actualSpend === null ? null : activeSnapshot(budgetVersions ?? [], actualSpend),
    [budgetVersions, actualSpend],
  );

  return (
    <div className="space-y-8">
      {/* Row 1. `[&>*]:min-w-0`: grid items default to min-width:auto, which lets a card
          whose min-content (a long title / unbroken number) exceeds the track refuse to
          shrink → the card bleeds ~14px past the viewport at 390px (AC-MOBILE-OVERFLOW-001). */}
      <div className="grid gap-6 [&>*]:min-w-0 lg:grid-cols-2">
        {showFinanceSummary && isDelivery && (
          <aside
            data-testid="financial-summary"
            aria-label={t('projectDetail.overview.finance.title', 'Financial summary')}
          >
            <h2 className="mb-3 text-[14px] font-semibold text-foreground">
              {t('projectDetail.overview.finance.title', 'Financial summary')}
            </h2>
            <StatTiles tiles={financeTiles} columns={5} variant="bare" className="mb-3" />
            <div
              data-testid="contract-value-sod"
              className="flex flex-wrap items-center gap-3 py-1"
            >
              <span className="flex items-center gap-2.5">
                <span className="text-[12.5px] font-semibold text-muted-foreground">
                  {t('projectDetail.overview.finance.contractValue', 'Contract value')}
                </span>
                <span className="text-[15px] font-bold tabular tracking-[-0.01em]">
                  {project.contract_value == null ? t('uxs01.actualUnavailable', 'Unavailable') : formatCurrency(project.contract_value, project.currency)}
                </span>
                <TaxBasisLabel
                  treatment={project.tax_treatment} taxRate={project.tax_rate} taxBaseNumerator={project.tax_base_numerator} taxBaseDenominator={project.tax_base_denominator}
                  testId="overview-contract-value-tax-basis"
                />
                {isOnHand && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                    <Icon name="lock" className="size-3" />
                    {t('projectDetail.overview.finance.readOnly', 'Read-only')}
                  </span>
                )}
              </span>
              {isOnHand && (
                <span className="basis-full text-[12px] text-muted-foreground">
                  {t(
                    'projectDetail.overview.finance.lockedNote',
                    'Once a project is won, the contract value is locked for your role. Only Executive or Finance can change it, and the change is recorded.',
                  )}
                </span>
              )}
            </div>
          </aside>
        )}

        <Card variant="bare">
          <CardHead>{t('projectDetail.overview.budgetUtil.title', 'Budget utilization')}</CardHead>
          {/* B-0.4: gate on useProjectBudget loading/error — mirror Budget-snapshot card.
              Pending/error must not collapse to "$0 of $0" (false-zero). */}
          {budgetUtilPending ? (
            <ListState variant="loading" rows={2} />
          ) : budgetUtilError ? (
            <ListState
              variant="error"
              title={t('projectDetail.overview.budgetUtil.error', "Couldn't load budget")}
              onRetry={() => budgetUtilRefetch()}
            />
          ) : (
            <CardPad className="flex flex-col gap-3">
              {activeBudget <= 0 ? <p className="text-sm text-muted-foreground">{t('uxs01.noActiveBudget', 'No active budget')}</p>
                : budgetUtilPctValue === null ? <p className="text-sm text-muted-foreground">{t('uxs01.actualUnavailable', 'Unavailable')}</p>
                  : <>
                <div className="text-[12px] text-muted-foreground">
                  <span className="font-semibold tabular text-foreground">{actualSpendLabel}</span>{' '}
                  {t('projectDetail.overview.budgetUtil.of', 'of')}{' '}
                  <span className="font-semibold tabular text-foreground">{formatCurrency(activeBudget, project.currency)}</span>{' '}
                  {t('uxs01.actualUsedAgainstBudget', 'recorded spending against the active budget')}
                </div>
                <ProgressBar
                  value={budgetUtilPctValue}
                  showValue
                  aria-label={`${t('uxs01.actualSpending', 'Actual spending')}: ${budgetUtilPctValue}% ${t('projectDetail.overview.budgetUtil.ofBudget', 'of budget')}`}
                />
              </>}
              {/* AC-W6-IXD-ATRISK (B-1): co-locate the budget-basis with the contract bar.
                  When at-risk, show the spent/budget figure + the "At risk" flag below the
                  contract bar (the I3 two-metric split: contract bar above, budget below).
                  The bar itself is NOT recolored — text-not-color per DESIGN.md. */}
              {budgetUtil !== null && (
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill variant="warn">{t('projectDetail.overview.budgetUtil.atRisk', 'At risk')}</StatusPill>
                  <span className="text-[12px] font-semibold tabular text-warning-foreground">
                    {budgetUtil}% {t('projectDetail.overview.budgetUtil.ofBudget', 'of budget')}
                  </span>
                </div>
              )}
            </CardPad>
          )}
        </Card>
      </div>

      {/* T18: Row 2 — Procurement summary + Budget snapshot */}
      {/* #566 / OD-CR-13: the contract drawdown, full width and above the procurement/budget
          detail. The PM manages by this number day one, so it is on the screen they land on
          rather than behind the Work orders tab — the tab is where they ACT on it. */}
      <ProjectDrawdown projectId={project.id} />

      {/* Keep the actionable work/phase context first on phones; finances follow the work-first
          surface rather than pushing the PM's primary delivery actions below the fold. */}
      {may('view', 'salesInvoice') && <ProjectFinancesSection project={project} />}

      <div data-testid="overview-row2" className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        {/* T14/T15 — Procurement summary card */}
        <Card variant="bare">
          <CardHead>{t('projectDetail.overview.procSummary.title', 'Procurement summary')}</CardHead>
          {procPending ? (
            <ListState variant="loading" rows={3} />
          ) : procError ? (
            <ListState
              variant="error"
              title={t('projectDetail.overview.procSummary.error', "Couldn't load procurement")}
              onRetry={() => procRefetch()}
            />
          ) : projectProc.length === 0 ? (
            <ListState
              variant="empty"
              icon="inbox"
              title={t(
                'projectDetail.overview.procSummary.empty.title',
                'No purchase requests for this project yet',
              )}
              sub={t(
                'projectDetail.overview.procSummary.empty.sub',
                'Requests raised against this project will appear here.',
              )}
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
              <div className="text-[12px] text-muted-foreground">
                {/* #571 — one sentence; the styled amount is a placeholder a translator moves. */}
                <Trans
                  i18nKey="uxs01.totalRequestValueAcross"
                  defaults="Total request value: <amount>{{amount}}</amount> across {{n}} {{unit}}"
                  values={{
                    amount: formatCurrency(procSummary.committedTotal, project.currency),
                    n: String(procSummary.count),
                    unit:
                      procSummary.count === 1
                        ? t('projectDetail.overview.procSummary.requestOne', 'request')
                        : t('projectDetail.overview.procSummary.requestOther', 'requests'),
                  }}
                  components={{
                    amount: <span className="font-semibold tabular text-foreground text-[14px]" />,
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
                            <span className="truncate text-[13px] font-semibold">{pr.title}</span>
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
                        <span className="shrink-0 text-[13px] font-semibold tabular text-foreground">
                          {formatCurrency(Number(pr.total_value), project.currency)}
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
                  className="text-[12px] font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring self-start"
                >
                  {t('projectDetail.overview.procSummary.viewAll', 'View all procurement')}
                </button>
              )}
            </CardPad>
          )}
        </Card>

        {/* T16/T17 — Budget snapshot card */}
        <Card variant="bare">
          <CardHead>{t('projectDetail.overview.budgetSnapshot.title', 'Budget snapshot')}</CardHead>
          {budgetPending ? (
            <ListState variant="loading" rows={3} />
          ) : budgetError ? (
            <ListState
              variant="error"
              title={t('projectDetail.overview.budgetSnapshot.error', "Couldn't load budget")}
              onRetry={() => budgetRefetch()}
            />
          ) : !snapshot ? (
            <ListState
              variant="empty"
              icon="inbox"
              title={hasActiveBudget ? t('uxs01.actualUnavailable', 'Unavailable') : t('uxs01.noActiveBudget', 'No active budget')}
              sub={hasActiveBudget
                ? t('uxs01.budgetActualUnavailable', 'Actual spending is incomplete, so it cannot be compared with this budget.')
                : t('projectDetail.overview.budgetSnapshot.empty.sub', 'Activate a budget version on the Budget tab to see a snapshot here.')}
            />
          ) : (
            <CardPad className="flex flex-col gap-3">
              {/* Budget totals */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {t('projectDetail.overview.budgetSnapshot.activeBudget', 'Active budget')}
                  </dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular">{formatCurrency(snapshot.activeTotal, project.currency)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {t('projectDetail.overview.budgetSnapshot.actualSpent', 'Actual spent')}
                  </dt>
                  <dd className="mt-0.5 text-[15px] font-bold tabular">{formatCurrency(snapshot.spent, project.currency)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    {t('uxs01.budgetPosition', 'Budget position')}
                  </dt>
                  <dd
                    data-testid="budget-variance"
                    className={`mt-0.5 text-[15px] font-bold tabular${snapshot.variance > 0 ? ' text-destructive-text' : ''}`}
                  >
                    {snapshot.variance > 0
                      ? t('uxs01.overBudgetBy', 'Over budget by {{amount}}', { amount: formatCurrency(snapshot.variance, project.currency) })
                      : snapshot.variance < 0
                        ? t('uxs01.budgetRemaining', 'Budget remaining {{amount}}', { amount: formatCurrency(Math.abs(snapshot.variance), project.currency) })
                        : t('uxs01.onBudget', 'On budget')}
                  </dd>
                </div>
              </dl>

              {/* Category breakdown bars */}
              {snapshot.byCategory.length > 0 && (
                <div
                  role="group"
                  aria-label={t('projectDetail.overview.budgetSnapshot.byCategoryLabel', 'Budget by category')}
                  className="flex flex-col gap-0.5 pt-1"
                >
                  <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-1">
                    {t('projectDetail.overview.budgetSnapshot.byCategory', 'By category')}
                  </div>
                  {snapshot.byCategory.map((cat) => (
                    <HoursBar
                      key={cat.category}
                      label={cat.category}
                      code={null}
                      hours={cat.amount}
                      maxHours={snapshot.activeTotal}
                      // Budget figures are money — currency-format them (reusing
                      // the Budget tab's formatter) so they never render "2000000h".
                      formatValue={(v) => formatCurrency(v, project.currency)}
                    />
                  ))}
                </div>
              )}

              {/* Footer link */}
              {setTab && (
                <button
                  type="button"
                  onClick={() => setTab('budget')}
                  className="text-[12px] font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring self-start"
                >
                  {t('projectDetail.overview.budgetSnapshot.openBudgetTab', 'Open Budget tab')}
                </button>
              )}
            </CardPad>
          )}
        </Card>
      </div>
    </div>
  );
};

export default OverviewTab;
