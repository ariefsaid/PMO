import FxEquivalent from '@/src/components/fx/FxEquivalent';
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Icon, ListState, ProgressBar, TaxBasisLabel, Tooltip } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useProjectCommittedSpend } from '@/src/hooks/useProcurements';
import { useTasks } from '@/src/hooks/useTasks';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useMilestones } from '@/src/hooks/useMilestones';
import { formatNumberWhole } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { deriveMargin, formatExactMoney } from '@/src/lib/projectFinances';
import MilestoneStrip from './MilestoneStrip';
import { useBudgetPosition } from './useProjectPosition';
import { summarizeInvoiceSettlement } from './ContractCascade';
import ProjectProfitLossSection from './ProjectProfitLossSection';
import { ProjectFinancesSection } from './ProjectFinancesSection';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';

const ProjectGantt = React.lazy(() => import('./ProjectGantt'));

/** Whole units, no currency symbol: the block heading names the currency once. */
const whole = (value: number) => formatNumberWhole(value);
const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** The one style for an in-block action: a quiet text action on the heading row, 44px tap area. */
export const BlockAction: React.FC<{ onClick?: () => void; to?: string; children: React.ReactNode; expanded?: boolean; className?: string }> = ({ onClick, to, children, expanded, className }) => {
  const cls = cn('touch-target inline-flex items-center text-xs font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className);
  return to
    ? <Link to={to} className={cls}>{children}</Link>
    : <button type="button" onClick={onClick} aria-expanded={expanded} className={cls}>{children}</button>;
};

/** Block chrome: heading, its unit/basis once, an optional action on the same baseline. */
const Block: React.FC<{ id: string; title: string; unit?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }> = ({ id, title, unit, action, children }) => (
  <section aria-labelledby={id} className="min-w-0">
    <div className="mb-4 flex min-h-6 flex-wrap items-baseline gap-x-2">
      <h2 id={id} className="text-sm font-semibold text-foreground">{title}</h2>
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      {action && <span className="ml-auto">{action}</span>}
    </div>
    {children}
  </section>
);

const Headline: React.FC<{ tone?: 'danger'; tooltip?: string; children: React.ReactNode }> = ({ tone, tooltip, children }) => (
  <p className={cn('text-lg font-semibold leading-tight tabular-nums sm:text-xl', tone === 'danger' ? 'text-destructive-text' : 'text-foreground')}>
    {tooltip ? <Tooltip content={tooltip}><span tabIndex={0}>{children}</span></Tooltip> : children}
  </p>
);
const Sub: React.FC<{ tooltip?: string; children: React.ReactNode }> = ({ tooltip, children }) => (
  <p className="mt-1 text-xs tabular-nums text-muted-foreground">{tooltip ? <Tooltip content={tooltip}><span tabIndex={0}>{children}</span></Tooltip> : children}</p>
);
const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="mt-4 text-xs text-muted-foreground">{children}</p>;
const FixLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className="font-semibold text-primary-text hover:underline">{children}</Link>
);

/* ── Money: how much of the contract have we billed and collected? ─────────────────────────── */
export const MoneyBlock: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t, i18n } = useTranslation('project');
  const [financeDetailsOpen, setFinanceDetailsOpen] = useState(false);
  const q = useProjectFinances(project.id);
  const may = usePermission();
  const canViewMoney = may('view', 'salesInvoice');
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  const budget = useBudgetPosition(project);
  const unit = (
    <>
      {project.currency}
      {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
    </>
  );
  const title = t('projectDetail.money.positionTitle', 'Money position');
  if (q.isPending || boq.isPending || billing.isPending) return <Block id="pd-money" title={title} unit={unit}><ListState variant="loading" rows={4} /></Block>;
  if (q.isError || !q.data || boq.isError || billing.isError || !billing.data) {
    return <Block id="pd-money" title={title}><ListState variant="error" title={t('projectDetail.money.error', "Couldn't load the money position")} onRetry={() => { void q.refetch(); void boq.refetch(); void billing.refetch(); }} /></Block>;
  }

  const data = q.data;
  const boqItems = boq.data ?? [];
  const hasBoq = boqItems.length > 0;
  const rates = new Map(boqItems.map((item) => [item.id, Number(item.rate)]));
  const contractValue = hasBoq
    ? boqItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.rate), 0)
    : project.contract_value;
  const allocations = billing.data.contractLines.flatMap((line) => line.allocations);
  const ordered = hasBoq
    ? allocations.reduce((sum, allocation) => sum + allocation.quantity * (rates.get(allocation.boqItemId) ?? 0), 0)
    : null;
  const delivered = hasBoq
    ? allocations.reduce((sum, allocation) => sum + (allocation.acceptedQuantity ?? 0) * (rates.get(allocation.boqItemId) ?? 0), 0)
    : null;
  const invoiceRows = (invoices.data ?? []).filter((invoice) => invoice.currency === project.currency);
  const settlement = summarizeInvoiceSettlement(invoiceRows.map((invoice) => ({
    status: invoice.status,
    amount: invoice.amount,
    erp_outstanding_amount: invoice.erp_outstanding_amount,
  })));
  const invoiced = !invoices.isPending && !invoices.isError ? settlement.invoiced : null;
  const paid = !invoices.isPending && !invoices.isError && settlement.balancesKnown ? settlement.paid : null;
  const cash = data.cash_received;
  const cashReceived = cash?.state === 'known'
    ? cash.buckets.filter((bucket) => bucket.currency === project.currency).reduce((sum, bucket) => sum + Number(bucket.amount), 0)
    : null;
  const sameCurrencyInvoices = data.invoices.filter((bucket) => bucket.currency === project.currency);
  const marginBucket = sameCurrencyInvoices[0];
  const margin = marginBucket && data.actuals ? deriveMargin(marginBucket, data.actuals) : null;
  const moneyText = (value: number | null) => value === null ? t('projectDetail.money.unavailable', 'Unavailable') : whole(value);
  const explain = (content: string, value: React.ReactNode) => (
    <Tooltip content={content}><span tabIndex={0} className="font-semibold tabular-nums text-foreground">{value}</span></Tooltip>
  );
  const steps: Array<{ label: string; value: number | null; source: string }> = [
    { label: t('projectDetail.money.contract', 'Contract'), value: contractValue, source: hasBoq
      ? t('projectDetail.money.contractSourceBoq', 'Sum of contract quantities multiplied by unit rates from the project BoQ.')
      : t('projectDetail.money.contractSourceRecord', 'Approved contract value from the project record.') },
    { label: t('projectDetail.money.ordered', 'Ordered'), value: ordered, source: t('projectDetail.money.orderedSource', 'Sum of issued work-order allocations multiplied by BoQ unit rates.') },
    { label: t('projectDetail.money.delivered', 'Delivered'), value: delivered, source: t('projectDetail.money.deliveredSource', 'Sum of accepted quantities multiplied by BoQ unit rates.') },
    { label: t('projectDetail.money.invoiced', 'Invoiced'), value: invoiced, source: t('projectDetail.money.invoicedSource', 'Sum of non-draft, non-cancelled invoices in the project currency.') },
    { label: t('projectDetail.money.paid', 'Paid'), value: paid, source: t('projectDetail.money.paidSource', 'Invoice amount less accounting outstanding balance; this is settlement, not receipt cash.') },
  ];
  const budgetPercent = budget.budget > 0 && budget.spent !== null ? pctOf(budget.spent, budget.budget) : null;
  const marginValue = margin?.amount === null || !margin ? t('projectDetail.money.unavailable', 'Unavailable') : formatExactMoney(margin.amount, project.currency, i18n.language) ?? t('projectDetail.money.unavailable', 'Unavailable');
  const marginReason = margin?.reason === 'different-currencies' ? t('projectDetail.money.marginDifferentCurrency', 'Actual spending and billed work use different currencies.')
    : margin?.reason === 'work-unavailable' ? t('projectDetail.money.marginWorkUnavailable', 'Billed-work revenue is incomplete.')
      : margin?.reason === 'restricted-rows' ? t('projectDetail.money.marginRestricted', 'Actual spending excludes restricted rows.')
        : margin?.reason === 'actuals-unavailable' ? t('projectDetail.money.marginActualsUnavailable', 'Complete actual spending is not available yet.')
          : t('projectDetail.money.marginSource', 'Billed-work revenue less complete recorded spending in the same currency.');

  return (
    <Block id="pd-money" title={title} unit={unit}>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 xl:grid-cols-5">
        {steps.map((step) => (
          <div key={step.label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{step.label}</dt>
            <dd className="mt-1 break-words text-sm font-semibold tabular-nums leading-tight text-foreground">
              {explain(step.source, step.value === null ? moneyText(null) : whole(step.value))}
            </dd>
            {step.label === t('projectDetail.money.contract', 'Contract') && contractValue !== null && (
              <dd className="mt-1"><FxEquivalent amount={contractValue} currency={project.currency} date={project.contract_date} compact /></dd>
            )}
            {step.value !== null && contractValue !== null && contractValue > 0 && (
              <dd className="mt-2">
                <Tooltip content={step.source}>
                  <span tabIndex={0} className="block">
                    <ProgressBar value={pctOf(step.value, contractValue)} tone="neutral" widthless aria-label={t('projectDetail.money.stageAria', '{{label}} is {{percent}}% of contract', { label: step.label, percent: pctOf(step.value, contractValue) })} />
                  </span>
                </Tooltip>
              </dd>
            )}
          </div>
        ))}
      </dl>
      {!hasBoq && <Note>{t('projectDetail.money.noBoq', 'Ordered and delivered values are not tracked until the project has a BoQ.')}</Note>}
      {invoices.isError && <Note>{t('projectDetail.money.invoiceError', "Couldn't load invoice settlement.")} <Button variant="ghost" size="sm" onClick={() => void invoices.refetch()}>{t('common.retry', 'Retry')}</Button></Note>}
      {cashReceived === null && (
        <Note>
          {t('projectDetail.money.cashUnavailable', 'Receipt-backed cash is not available yet.')}{' '}
          {cash?.state === 'known' ? null : <FixLink to="/incoming-payments">{t('projectDetail.money.matchPayments', 'Match payments')}</FixLink>}
        </Note>
      )}
      {cashReceived !== null && paid !== null && paid > cashReceived && (
        <Note>
          {t('projectDetail.money.paidNotReceived', '{{amount}} is settled in accounting but no receipt is matched to it yet.', { amount: whole(paid - cashReceived) })}{' '}
          <FixLink to="/incoming-payments">{t('projectDetail.money.matchPayments', 'Match payments')}</FixLink>
        </Note>
      )}
      <dl className="mt-6 grid min-w-0 gap-4 border-t border-border/70 pt-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('projectDetail.money.spentBudget', 'Spent vs budget')}</dt>
          <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">
            {!budget.hasBudget
              ? t('projectDetail.money.noActiveBudget', 'No active budget')
              : budget.spent === null
                ? explain(t('projectDetail.money.spentSourceUnknown', 'Actual spending needs complete mapped category data; budget comes from the active project budget.'), `${t('projectDetail.money.spent', 'Spent')} ${t('projectDetail.money.unavailable', 'Unavailable')} · ${t('projectDetail.money.budget', 'Budget')} ${whole(budget.budget)}`)
              : explain(t('projectDetail.money.spentSource', 'Complete mapped actual spending compared with the active project budget.'), `${whole(budget.spent)} / ${whole(budget.budget)}`)}
          </dd>
          {budgetPercent !== null && <dd><Tooltip content={t('projectDetail.money.spentSource', 'Complete mapped actual spending compared with the active project budget.')}>
            <span tabIndex={0} className="mt-2 block"><ProgressBar value={budgetPercent} widthless className="w-full" aria-label={t('projectDetail.money.budgetUse', 'Budget use {{percent}}%', { percent: budgetPercent })} /></span>
          </Tooltip></dd>}
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('projectDetail.money.grossMargin', 'Gross margin')}</dt>
          <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">{explain(marginReason, marginValue)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">{t('projectDetail.money.cashReceived', 'Cash received')}</dt>
          <dd className="mt-1 break-words text-sm font-semibold tabular-nums text-foreground">{explain(
            t('projectDetail.money.cashSource', 'Receipt cash allocated to invoices for this project; separate from invoice settlement.'),
            cashReceived === null ? t('projectDetail.money.unavailable', 'Unavailable') : whole(cashReceived),
          )}</dd>
        </div>
      </dl>
      <div className="mt-5 border-t border-border/70 pt-3" data-testid="money-position-details">
        <button type="button" aria-expanded={financeDetailsOpen} onClick={() => setFinanceDetailsOpen((open) => !open)}
          className="touch-target inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">
          <Icon name="chev" className={`size-3.5 transition-transform duration-100 motion-reduce:transition-none ${financeDetailsOpen ? 'rotate-90' : ''}`} />
          {t('projectDetail.money.details', 'Details')}
        </button>
        {financeDetailsOpen && <div className="space-y-4 pt-4"><ProjectFinancesSection project={project} /></div>}
      </div>
      <div className="mt-6 border-t border-border/70 pt-4"><ProjectProfitLossSection projectId={project.id} /></div>
    </Block>
  );
};

/* ── Cost: are we spending within budget, and where not? ─────────────────────────────────── */
const CostUnit: React.FC<{ project: ProjectWithRefs }> = ({ project }) => (
  <>
    {project.currency}
    {project.tax_treatment && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-xs text-muted-foreground" /></>}
  </>
);

const EstimatedBudgetBlock: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const amount = project.budget;
  return (
    <Block id="pd-cost" title={t('projectDetail.cost.estimateTitle', 'Budget')} unit={<CostUnit project={project} />}>
      <Headline tooltip={t('projectDetail.cost.estimateTooltip', 'Estimated budget from the project record; not an active budget version.')}>{amount == null
        ? t('projectDetail.cost.noEstimate', 'No estimated budget yet')
        : t('projectDetail.cost.estimated', 'Estimated budget {{amount}}', { amount: whole(Number(amount)) })}</Headline>
    </Block>
  );
};

export const CostBlock: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void; isPipeline?: boolean }> = ({ project, onOpenBudget, isPipeline = false }) => (
  isPipeline ? <EstimatedBudgetBlock project={project} /> : <ActiveCostBlock project={project} onOpenBudget={onOpenBudget} />
);

const ActiveCostBlock: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void }> = ({ project, onOpenBudget }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const canFixSetup = may('manage', 'orgAccounting');
  const pos = useBudgetPosition(project);
  const committed = useProjectCommittedSpend(may('view', 'procurement') ? project.id : null, may('view', 'procurement'));
  const label = (c: string) => budgetCategoryLabel(c, t);
  const title = t('projectDetail.cost.title', 'Budget vs actual');
  const action = onOpenBudget && <BlockAction onClick={onOpenBudget}>{t('projectDetail.cost.openBudgetArea', 'Open budget')}</BlockAction>;

  if (pos.isPending) return <Block id="pd-cost" title={title}><ListState variant="loading" rows={4} /></Block>;
  if (pos.isError) {
    return <Block id="pd-cost" title={title}><ListState variant="error" title={t('projectDetail.cost.error', "Couldn't load the budget")} onRetry={() => void pos.refetch()} /></Block>;
  }
  if (!pos.hasBudget) {
    return (
      <Block id="pd-cost" title={title} action={action}>
        <p className="text-sm text-muted-foreground">{t('projectDetail.cost.noBudget', 'No active budget yet, so spending can’t be compared.')}</p>
      </Block>
    );
  }
  const worst = pos.overRows[0];
  const summaryTooltip = t('projectDetail.cost.summaryTooltip', 'Compares mapped actual spending with the active project budget. Source: active budget categories and project finance records.');
  const rows = pos.rows.slice().sort((a, b) => {
    if (a.actual === null) return b.actual === null ? label(a.category).localeCompare(label(b.category)) : 1;
    if (b.actual === null) return -1;
    const aOver = a.actual > a.budget ? 1 : 0;
    const bOver = b.actual > b.budget ? 1 : 0;
    if (aOver !== bOver) return bOver - aOver;
    if (aOver && bOver) return (b.actual! - b.budget) - (a.actual! - a.budget);
    const aUse = a.budget > 0 ? a.actual / a.budget : a.actual > 0 ? Number.POSITIVE_INFINITY : 0;
    const bUse = b.budget > 0 ? b.actual / b.budget : b.actual > 0 ? Number.POSITIVE_INFINITY : 0;
    return bUse - aUse;
  });
  const committedFigure = committed.commitmentSource === 'pmo' && committed.data !== undefined ? committed.data : null;
  const hasComparisons = !pos.canSeeActual || pos.rows.length > 0;

  const answer = !pos.canSeeActual || pos.spent === null ? (
    <Headline tooltip={summaryTooltip}>{t('projectDetail.cost.budgetOnly', 'Budget {{budget}}', { budget: whole(pos.budget) })}</Headline>
  ) : pos.projectOver !== null ? (
    <>
      <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.projectOver', '{{amount}} over budget', { amount: whole(pos.projectOver) })}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.projectOverSub', 'Spent {{spent}} of {{budget}}', { spent: whole(pos.spent!), budget: whole(pos.budget) })}
        {worst && <> · {t('projectDetail.cost.mostly', 'mostly {{category}}', { category: label(worst.category) })}</>}</Sub>
    </>
  ) : worst ? (
    <>
      <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.categoryOver', '{{category}} is {{amount}} over budget', { category: label(worst.category), amount: whole(worst.actual! - worst.budget) })}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.categoryOverSub', 'Spent {{spent}} of its {{budget}} budget', { spent: whole(worst.actual!), budget: whole(worst.budget) })}</Sub>
    </>
  ) : pos.spent !== null ? (
    <>
      <Headline tooltip={summaryTooltip}>{t('projectDetail.cost.within', 'Within budget')}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.withinSub', 'Spent {{spent}} of {{budget}}', { spent: whole(pos.spent), budget: whole(pos.budget) })}</Sub>
    </>
  ) : null;

  const usedPercent = pos.budget > 0 && pos.spent !== null ? pctOf(pos.spent, pos.budget) : null;
  const remaining = pos.spent === null ? null : pos.budget - pos.spent;
  const atRisk = isMoneyAtRisk({
    status: project.status as string,
    budget: pos.budget,
    budgetCurrency: project.currency,
    projectCurrency: project.currency,
    spent: pos.spent,
    actualCurrency: pos.spent === null ? null : project.currency,
    actualComplete: pos.spent !== null,
  });

  return (
    <Block id="pd-cost" title={title} unit={<CostUnit project={project} />} action={action}>
      {answer}
      {usedPercent !== null && <Sub>
        {t('projectDetail.cost.snapshotUse', '{{percent}}% used', { percent: usedPercent })}
        {remaining !== null && <> · {remaining < 0
          ? t('projectDetail.cost.snapshotOver', '{{amount}} over budget', { amount: whole(Math.abs(remaining)) })
          : t('projectDetail.cost.snapshotRemaining', '{{amount}} remaining', { amount: whole(remaining) })}</>}
        {atRisk && <span className="ml-2 font-semibold text-warning-foreground">{t('projectDetail.cost.atRisk', 'At risk')}</span>}
      </Sub>}
      {pos.actualsPending && <Note>{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</Note>}
      {pos.actualsError && <Note>{t('projectDetail.cost.spendingError', "Couldn't check spending")} <Button variant="ghost" size="sm" onClick={() => void pos.refetchActuals()}>{t('common.retry', 'Retry')}</Button></Note>}
      {pos.canSeeActual && pos.spent === null && !pos.actualsPending && !pos.actualsError && (
        <Note>
          {t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")}{' '}
          {canFixSetup
            ? <FixLink to="/administration/accounting#budget-account-map">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</FixLink>
            : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}
        </Note>
      )}
      {hasComparisons && committedFigure !== null && <Sub tooltip={t('projectDetail.cost.committedTooltip', 'Sum of project purchase orders in the commitment states shown in Procurement.')}>{t('projectDetail.cost.committed', 'Plus {{amount}} committed in purchase orders', { amount: whole(committedFigure) })}</Sub>}
      {hasComparisons && rows.length > 0 && (
        <ul className="mt-6 flex min-w-0 flex-col border-y border-border/70">
          {rows.map((r) => {
            const over = r.actual !== null && r.actual > r.budget;
            const pct = r.actual === null ? null : r.budget > 0 ? pctOf(r.actual, r.budget) : r.actual > 0 ? 101 : 0;
            const detail = t('projectDetail.cost.categoryTooltip', 'Active budget and mapped actual spending for this category. Source: the active budget and project finance records.');
            return (
              <li key={r.category} className="border-b border-border/70 last:border-b-0">
                <Tooltip content={detail} className="w-full">
                  <Link to={`/projects/${project.id}/budget`} onClick={onOpenBudget ? (event) => { event.preventDefault(); onOpenBudget(); } : undefined}
                    aria-label={t('projectDetail.cost.openCategory', 'Open {{category}} in Budget', { category: label(r.category) })}
                    className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(8rem,0.8fr)_minmax(5rem,auto)_minmax(5rem,1fr)]">
                    <span className="truncate text-sm font-medium text-foreground">{label(r.category)}</span>
                    <span className={cn('text-right text-xs tabular-nums sm:order-last', over ? 'font-semibold text-destructive-text' : 'text-muted-foreground')}>
                      {r.actual === null
                        ? t('projectDetail.cost.rowUnavailable', 'Actual unavailable · budget {{budget}}', { budget: whole(r.budget) })
                        : t('projectDetail.cost.rowSpent', '{{spent}} of {{budget}}', { spent: whole(r.actual), budget: whole(r.budget) })}
                    </span>
                    {pct !== null && <span className="col-span-2 w-full sm:col-span-1">
                      <ProgressBar value={pct} widthless className="w-full" aria-label={r.budget === 0 && r.actual! > 0
                        ? t('projectDetail.cost.categoryNoBudget', '{{category}} has spending with no budget', { category: label(r.category) })
                        : t('projectDetail.cost.categoryUse', '{{category}} uses {{percent}}% of budget', { category: label(r.category), percent: pct })} />
                    </span>}
                  </Link>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
};

/* ── Delivery: phase progress, dated task work, and phase planning ────────────────────────── */

export const DeliveryBlock: React.FC<{ projectId: string; isPipeline?: boolean; children?: React.ReactNode }> = ({ projectId, isPipeline = false, children }) => {
  const { t } = useTranslation('project');
  const title = t('projectDetail.delivery.timelineTitle', 'Phase timeline');
  if (isPipeline) {
    return <Block id="pd-delivery" title={title}><MilestoneStrip projectId={projectId} compactWhenEmpty /></Block>;
  }
  return <ActiveDeliveryBlock projectId={projectId} title={title}>{children}</ActiveDeliveryBlock>;
};

const ActiveDeliveryBlock: React.FC<{ projectId: string; title: string; children?: React.ReactNode }> = ({ projectId, title, children }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  const navigate = useNavigate();
  const [managing, setManaging] = useState(false);
  const q = useMilestones(projectId);
  const tasks = useTasks(projectId);
  const action = may('edit', 'project') && (
    <BlockAction onClick={() => setManaging((m) => !m)} expanded={managing}>
      {managing ? t('projectDetail.delivery.doneManaging', 'Done') : t('projectDetail.delivery.manage', 'Update phases')}
    </BlockAction>
  );
  if (managing) return <Block id="pd-delivery" title={title} action={action}><MilestoneStrip projectId={projectId} /></Block>;
  if (q.isPending || tasks.isPending) return <Block id="pd-delivery" title={title}><ListState variant="loading" rows={3} /></Block>;
  if (q.isError || tasks.isError) return <Block id="pd-delivery" title={title}><ListState variant="error" title={t('projectDetail.delivery.error', "Couldn't load the phase timeline")} onRetry={() => { void q.refetch(); void tasks.refetch(); }} /></Block>;
  const all = q.data ?? [];
  if (all.length === 0) {
    return (
      <Block id="pd-delivery" title={title} action={action}>
        <p className="text-sm text-muted-foreground">{t('projectDetail.delivery.empty', 'No phases yet. Add phases to track delivery progress.')}</p>
      </Block>
    );
  }
  const totalWeight = all.reduce((s, m) => s + m.weight, 0);
  const pct = totalWeight > 0 ? Math.round(all.reduce((s, m) => s + m.weight * m.effective_pct, 0) / totalWeight) : 0;
  return (
    <Block id="pd-delivery" title={title} action={action}>
      <Tooltip content={t('projectDetail.delivery.progressTooltip', 'Weighted average of phase completion using each phase weight; source: the project phase plan and linked task progress.')}>
        <span tabIndex={0}><Headline>{t('projectDetail.delivery.pct', '{{pct}}% delivered', { pct })}</Headline></span>
      </Tooltip>
      <div className="mt-3 space-y-1" data-testid="phase-read-details">
        <p className="text-xs text-muted-foreground">{t('projectDetail.milestones.currentPhaseLabel', 'Current phase')}: <span className="font-medium text-foreground">{all.find((milestone) => milestone.effective_pct < 100)?.name ?? t('projectDetail.milestones.noCurrentPhase', 'No active phase')}</span></p>
        <ul className="divide-y divide-border/70">
          {all.map((milestone) => {
            const phaseTasks = (tasks.data ?? []).filter((task) => task.milestone_id === milestone.id && !task.parent_task_id);
            const doneTasks = phaseTasks.filter((task) => task.status === 'Done').length;
            const blockingTasks = phaseTasks.filter((task) => task.status === 'Blocked');
            const weightShare = totalWeight > 0 ? Math.round((milestone.weight / totalWeight) * 100) : 0;
            return <li key={milestone.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-xs">
              <span className="font-medium text-foreground">{milestone.name}</span>
              <span className="text-muted-foreground">{t('projectDetail.milestones.weightShare', '{{pct}}% of project', { pct: String(weightShare) })}</span>
              <span className="text-muted-foreground">{t('projectDetail.milestones.taskCount', '{{done}} of {{total}} tasks', { done: doneTasks, total: phaseTasks.length || milestone.task_count })}</span>
              {blockingTasks.map((task) => <Link key={task.id} to={`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`} className="font-semibold text-primary-text hover:underline">{task.name}</Link>)}
            </li>;
          })}
        </ul>
      </div>
      <div className="mt-4">
        <React.Suspense fallback={<ListState variant="loading" rows={3} />}>
          <ProjectGantt
            tasks={tasks.data ?? []}
            milestones={all}
            onActivateTask={(task) => navigate(`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`)}
            onSwitchView={(view) => navigate(`/projects/${projectId}/tasks?view=${view}`)}
            rowMenu={(task) => [{
              label: t('projectDetail.delivery.openTaskAction', 'Open task'),
              onClick: () => navigate(`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`),
            }]}
          />
        </React.Suspense>
      </div>
      {children && <div className="mt-8">{children}</div>}
    </Block>
  );
};
