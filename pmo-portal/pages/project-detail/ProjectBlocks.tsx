import FxEquivalent from '@/src/components/fx/FxEquivalent';
import React, { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, Icon, ListState, ProgressBar, TaxBasisLabel, Tooltip, useFigureReport, type HiddenFigure } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useTasks } from '@/src/hooks/useTasks';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useMilestones } from '@/src/hooks/useMilestones';
import { completionPct, formatDay, formatDaysOverdue, formatTableMoney } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { deriveMargin } from '@/src/lib/projectFinances';
import MilestoneStrip from './MilestoneStrip';
import { useBudgetPosition } from '@/src/hooks/useProjectPosition';
import { summarizeInvoiceSettlement } from './ContractCascade';
import ProjectProfitLossSection from './ProjectProfitLossSection';
import { ProjectFinancesSection } from './ProjectFinancesSection';

/** Full whole-unit amount with its currency, right-aligned and tabular where it sits in a column (screen rules, Numbers). */
const moneyIn = (currency: string) => (value: number) => formatTableMoney(value, currency) ?? String(value);
const pctOf = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

/** The one style for an in-block action: a quiet text action on the heading row, 44px tap area. */
export const BlockAction: React.FC<{ onClick?: () => void; to?: string; children: React.ReactNode; expanded?: boolean; className?: string }> = ({ onClick, to, children, expanded, className }) => {
  const cls = cn('touch-target inline-flex items-center text-sm font-semibold text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className);
  return to
    ? <Link to={to} className={cls}>{children}</Link>
    : <button type="button" onClick={onClick} aria-expanded={expanded} className={cls}>{children}</button>;
};

/** Block chrome: heading, its unit/basis once, an optional action on the same baseline. */
export const Block: React.FC<{ id: string; title: string; unit?: React.ReactNode; action?: React.ReactNode; fillRow?: boolean; children: React.ReactNode }> = ({ id, title, unit, action, fillRow = false, children }) => (
  <section aria-labelledby={id} className={cn('min-w-0', fillRow && 'h-full')}>
    <Card className={fillRow ? 'flex h-full flex-col' : undefined}>
      <CardHead id={id} subline={unit} actions={action} className="pb-2">{title}</CardHead>
      <CardPad className={cn('pt-2', fillRow && 'flex flex-1 flex-col')}>{children}</CardPad>
    </Card>
  </section>
);

const Headline: React.FC<{ tone?: 'danger'; tooltip?: string; children: React.ReactNode }> = ({ tone, tooltip, children }) => (
  <p className={cn('text-lg font-semibold leading-tight tabular-nums sm:text-xl', tone === 'danger' ? 'text-destructive-text' : 'text-foreground')}>
    {tooltip ? <Tooltip content={tooltip}><span tabIndex={0}>{children}</span></Tooltip> : children}
  </p>
);
const Sub: React.FC<{ tooltip?: string; children: React.ReactNode }> = ({ tooltip, children }) => (
  <p className="mt-1 text-sm tabular-nums text-muted-foreground">{tooltip ? <Tooltip content={tooltip}><span tabIndex={0}>{children}</span></Tooltip> : children}</p>
);
const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => <p className="mt-4 text-sm text-muted-foreground">{children}</p>;
const FixLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className="font-semibold text-primary-text hover:underline">{children}</Link>
);

const MoneyHiddenFigures: React.FC<{ figures: HiddenFigure[] }> = ({ figures }) => {
  useFigureReport(figures);
  return null;
};

/* ── Money: how much of the contract have we billed and collected? ─────────────────────────── */

const MoneyBlockView: React.FC<{ project: ProjectWithRefs; fillRow?: boolean }> = ({ project, fillRow = false }) => {
  const { t } = useTranslation('project');
  const whole = moneyIn(project.currency);
  const [financeDetailsOpen, setFinanceDetailsOpen] = useState(false);
  const q = useProjectFinances(project.id);
  const may = usePermission();
  const canViewMoney = may('view', 'salesInvoice');
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  const unit = (
    <>
      {project.currency}
      {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-sm text-muted-foreground" /></>}
    </>
  );
  const title = t('projectDetail.money.positionTitle', 'Money position');
  if (q.isPending || boq.isPending || billing.isPending) return <Block id="pd-money" title={title} unit={unit} fillRow={fillRow}><ListState variant="loading" rows={4} /></Block>;
  if (q.isError || !q.data || boq.isError || billing.isError || !billing.data) {
    return <Block id="pd-money" title={title} fillRow={fillRow}><ListState variant="error" title={t('projectDetail.money.error', "Couldn't load the money position")} onRetry={() => { void q.refetch(); void boq.refetch(); void billing.refetch(); }} /></Block>;
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
  const invoicesKnown = !invoices.isPending && !invoices.isError;
  const invoiceRows = (invoices.data ?? []).filter((invoice) => invoice.currency === project.currency);
  const settlement = summarizeInvoiceSettlement(invoiceRows.map((invoice) => ({
    status: invoice.status,
    amount: invoice.amount,
    erp_outstanding_amount: invoice.erp_outstanding_amount,
  })));
  const invoiced = invoicesKnown ? settlement.invoiced : null;
  const paid = invoicesKnown && settlement.balancesKnown ? settlement.paid : null;
  const cash = data.cash_received;
  const cashSum = cash?.state === 'known'
    ? cash.buckets.filter((bucket) => bucket.currency === project.currency).reduce((sum, bucket) => sum + Number(bucket.amount), 0)
    : null;
  // Zero received next to invoices is more likely receipts not synced yet than a real zero: unknown never reads as 0.
  const cashUnconfirmed = cashSum === 0 && (invoiced ?? 0) > 0;
  const cashReceived = cashUnconfirmed ? null : cashSum;
  const marginBucket = data.invoices.find((bucket) => bucket.currency === project.currency);
  const margin = marginBucket && data.actuals ? deriveMargin(marginBucket, data.actuals) : null;
  const marginAmount = margin && margin.reason === null && margin.amount !== null ? Number(margin.amount) : null;
  const explain = (content: string, value: React.ReactNode, className = 'font-semibold tabular-nums text-foreground') => (
    <Tooltip content={content}><span tabIndex={0} className={className}>{value}</span></Tooltip>
  );
  // C4: a figure the system cannot know is left out of the strip; the reason is said once below it.
  const steps = [
    { key: 'contract', label: t('projectDetail.money.contract', 'Contract'), value: contractValue, source: hasBoq
      ? t('projectDetail.money.contractSourceBoq', 'Sum of contract quantities multiplied by unit rates from the project BoQ.')
      : t('projectDetail.money.contractSourceRecord', 'Approved contract value from the project record.') },
    { key: 'ordered', label: t('projectDetail.money.ordered', 'Ordered'), value: ordered, source: t('projectDetail.money.orderedSource', 'Sum of issued work-order allocations multiplied by BoQ unit rates.') },
    { key: 'delivered', label: t('projectDetail.money.delivered', 'Delivered'), value: delivered, source: t('projectDetail.money.deliveredSource', 'Sum of accepted quantities multiplied by BoQ unit rates.') },
    { key: 'invoiced', label: t('projectDetail.money.invoiced', 'Invoiced'), value: invoiced, source: t('projectDetail.money.invoicedSource', 'Sum of non-draft, non-cancelled invoices in the project currency.') },
    { key: 'paid', label: t('projectDetail.money.paid', 'Paid'), value: paid, source: t('projectDetail.money.paidSource', 'Invoice amount less accounting outstanding balance; this is settlement, not receipt cash.') },
  ].filter((step): step is { key: string; label: string; value: number; source: string } => step.value !== null);
  const stepLabels = { ordered: t('projectDetail.money.ordered', 'Ordered'), delivered: t('projectDetail.money.delivered', 'Delivered'), invoiced: t('projectDetail.money.invoiced', 'Invoiced'), paid: t('projectDetail.money.paid', 'Paid') };
  const marginHiddenReason = margin?.reason === 'different-currencies'
    ? t('projectDetail.money.marginOutCurrency', 'Gross margin is left out because spending and billed work use different currencies.')
    : margin?.reason === 'work-unavailable'
      ? t('projectDetail.money.marginOutWork', 'Gross margin is left out until billed-work revenue is complete.')
      : margin?.reason === 'restricted-rows'
        ? t('projectDetail.money.marginOutRestricted', 'Gross margin is left out because spending excludes restricted rows.')
        : margin?.reason === 'actuals-unavailable'
          ? t('projectDetail.money.marginOutActuals', 'Gross margin is left out until spending is linked for every budget category.')
          : t('projectDetail.money.marginOutNoInvoices', 'Gross margin starts with the first invoice in the project currency.');
  const hidden: HiddenFigure[] = [
    ...(contractValue === null ? [{ label: t('projectDetail.money.contract', 'Contract'), reason: t('projectDetail.money.contractUnavailable', 'Contract value is not recorded.') }] : []),
    ...(ordered === null ? [{ label: stepLabels.ordered, reason: t('projectDetail.money.noBoq', 'Ordered and delivered values are not tracked until the project has a BoQ.') }] : []),
    ...(delivered === null ? [{ label: stepLabels.delivered, reason: t('projectDetail.money.noBoq', 'Ordered and delivered values are not tracked until the project has a BoQ.') }] : []),
    ...(invoiced === null && !invoices.isPending ? [{ label: stepLabels.invoiced, reason: invoices.isError
      ? t('projectDetail.money.invoiceError', "Couldn't load invoice settlement.")
      : t('projectDetail.money.invoicedOut', 'Invoiced is left out until every invoice amount is known.') }] : []),
    ...(paid === null && !invoices.isPending ? [{ label: stepLabels.paid, reason: invoices.isError
      ? t('projectDetail.money.invoiceError', "Couldn't load invoice settlement.")
      : t('projectDetail.money.paidOut', 'Paid is left out until every invoice balance is known.') }] : []),
    ...(marginAmount === null ? [{ label: t('projectDetail.money.grossMargin', 'Gross margin'), reason: marginHiddenReason }] : []),
    ...(cashReceived === null ? [{
      label: cashUnconfirmed
        ? t('projectDetail.money.cashUnmatchedShort', 'Cash received (no receipt matched yet)')
        : cash?.state === 'incomplete'
          ? t('projectDetail.money.cashIncompleteShort', 'Cash received (receipts not allocated to invoices)')
          : cash?.state === 'unavailable' && cash.reason === 'invalid-reading'
            ? t('projectDetail.money.cashInvalidShort', 'Cash received (receipt reading not verified)')
            : t('projectDetail.money.cashReceived', 'Cash received'),
      reason: cashUnconfirmed
        ? t('projectDetail.money.cashUnmatchedShort', 'Cash received (no receipt matched yet)')
        : cash?.state === 'incomplete'
          ? t('projectDetail.money.cashIncompleteShort', 'Cash received (receipts not allocated to invoices)')
          : cash?.state === 'unavailable' && cash.reason === 'invalid-reading'
            ? t('projectDetail.money.cashInvalidShort', 'Cash received (receipt reading not verified)')
            : t('projectDetail.money.cashUnavailable', 'Receipt-backed cash is not available yet.'),
      link: { to: '/finance/receivables?view=payments', label: t('projectDetail.money.matchPayments', 'Match payments') },
    }] : []),
  ];
  const share = (value: number | null) => value !== null && contractValue !== null && contractValue > 0 ? pctOf(value, contractValue) : null;
  const invoicedShare = share(invoiced);
  const paidShare = share(paid);

  return (
    <Block id="pd-money" title={title} unit={unit} fillRow={fillRow}>
      <MoneyHiddenFigures figures={hidden} />
      {/* L5: the block's one answer leads, biggest — how much of the contract is billed, then collected. */}
      {invoicedShare !== null && (
        <p className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {explain(t('projectDetail.money.leadTooltip', 'Invoiced amount as a share of the contract. Source: non-draft, non-cancelled invoices in the project currency.'),
            t('projectDetail.money.leadInvoiced', '{{percent}}% invoiced', { percent: invoicedShare }),
            'text-2xl font-semibold leading-tight tabular-nums text-foreground')}
          {paidShare !== null && <span className="text-sm tabular-nums text-muted-foreground">{t('projectDetail.money.leadPaid', '{{percent}}% paid', { percent: paidShare })}</span>}
          {cashReceived !== null && <span data-testid="money-lead-cash" className="text-lg font-semibold tabular-nums text-foreground">{t('projectDetail.money.cashLead', 'Received {{amount}}', { amount: whole(cashReceived) })}</span>}
        </p>
      )}
      <dl className={cn('grid min-w-0 gap-y-2', fillRow && 'flex-1')} style={fillRow ? { gridTemplateRows: `repeat(${steps.length}, minmax(min-content, 1fr))` } : undefined} aria-label={t('projectDetail.money.cascadeLabel', 'Contract to payment')}>
        {steps.map((step) => {
          const percent = share(step.value);
          return (
            <div key={step.key} className="grid min-w-0 grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3">
              <dt className="text-sm text-muted-foreground">{step.label}</dt>
              <dd className="min-w-0">
                {percent !== null && (step.key === 'invoiced' || step.key === 'paid') && <ProgressBar value={percent} tone={step.key === 'invoiced' ? 'primary' : 'success'} widthless className="w-full" aria-label={t('projectDetail.money.stageAria', '{{label}} is {{percent}}% of contract', { label: step.label, percent })} />}
              </dd>
              <dd className="text-right text-sm">
                {step.key === 'contract'
                  ? <span data-testid="contract-value-amount">{explain(step.source, whole(step.value))}</span>
                  : explain(step.source, whole(step.value))}
              </dd>
              {step.key === 'contract' && contractValue !== null && (
                <dd className="col-span-2 col-start-2 text-right"><FxEquivalent amount={contractValue} currency={project.currency} date={project.contract_date} compact /></dd>
              )}
            </div>
          );
        })}
      </dl>
      {marginAmount !== null && (
        <dl className="mt-4 flex min-w-0 flex-wrap gap-x-8 gap-y-3 border-t border-border/70 pt-3">
          {marginAmount !== null && (
            <div className="min-w-0">
              <dt className="text-sm text-muted-foreground">{t('projectDetail.money.grossMargin', 'Gross margin')}</dt>
              <dd className={cn('mt-0.5 text-sm', marginAmount < 0 && '[&>span]:text-destructive-text')}>{explain(t('projectDetail.money.marginSource', 'Billed-work revenue less complete recorded spending in the same currency.'), whole(marginAmount))}</dd>
            </div>
          )}
        </dl>
      )}
      {invoices.isError && <Note>{t('projectDetail.money.invoiceError', "Couldn't load invoice settlement.")} <Button variant="ghost" size="sm" onClick={() => void invoices.refetch()}>{t('common.retry', 'Retry')}</Button></Note>}
      {cashReceived !== null && paid !== null && paid > cashReceived && (
        <Note>
          {t('projectDetail.money.paidNotReceived', '{{amount}} is settled in accounting but no receipt is matched to it yet.', { amount: whole(paid - cashReceived) })}{' '}
          <FixLink to="/finance/receivables?view=payments">{t('projectDetail.money.matchPayments', 'Match payments')}</FixLink>
        </Note>
      )}
      <div className="mt-5 border-t border-border/70 pt-3" data-testid="money-position-details">
        <button type="button" aria-expanded={financeDetailsOpen} onClick={() => setFinanceDetailsOpen((open) => !open)}
          className="touch-target inline-flex items-center gap-2 cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
          <Icon name="chev" className={`size-3.5 transition-transform duration-100 motion-reduce:transition-none ${financeDetailsOpen ? 'rotate-90' : ''}`} />
          {t('projectDetail.money.details', 'Details')}
        </button>
        {financeDetailsOpen && <div className="space-y-4 pt-4"><ProjectFinancesSection project={project} /></div>}
      </div>
      <ProjectProfitLossSection projectId={project.id} />
    </Block>
  );
};

/* ── Cost: are we spending within budget, and where not? ─────────────────────────────────── */
const CostUnit: React.FC<{ project: ProjectWithRefs }> = ({ project }) => (
  <>
    {project.currency}
    {project.tax_treatment && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-sm text-muted-foreground" /></>}
  </>
);

const EstimatedBudgetBlock: React.FC<{ project: ProjectWithRefs }> = ({ project }) => {
  const { t } = useTranslation('project');
  const whole = moneyIn(project.currency);
  const amount = project.budget;
  return (
    <Block id="pd-cost" title={t('projectDetail.cost.estimateTitle', 'Budget')} unit={<CostUnit project={project} />}>
      <Headline tooltip={t('projectDetail.cost.estimateTooltip', 'Estimated budget from the project record; not an active budget version.')}>{amount == null
        ? t('projectDetail.cost.noEstimate', 'No estimated budget yet')
        : t('projectDetail.cost.estimated', 'Estimated budget {{amount}}', { amount: whole(Number(amount)) })}</Headline>
    </Block>
  );
};

const CostBlockView: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void; isPipeline?: boolean }> = ({ project, onOpenBudget, isPipeline = false }) => (
  isPipeline ? <EstimatedBudgetBlock project={project} /> : <ActiveCostBlock project={project} onOpenBudget={onOpenBudget} />
);

const ActiveCostBlock: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void }> = ({ project, onOpenBudget }) => {
  const { t } = useTranslation('project');
  const whole = moneyIn(project.currency);
  const may = usePermission();
  const canFixSetup = may('manage', 'orgAccounting');
  const pos = useBudgetPosition(project);
  const label = (c: string) => budgetCategoryLabel(c, t);
  const title = t('projectDetail.cost.title', 'Budget');
  // No spending to compare: the page's one hidden-figures line says so; the card does not repeat it.
  const spendingUnlinked = pos.hasBudget && pos.canSeeActual && pos.spent === null && !pos.currencyDiffers && !pos.actualsPending && !pos.actualsError;
  const inFigureScope = useFigureReport(spendingUnlinked
    ? [{
      label: t('projectDetail.budget.spent', 'Spent'),
      reason: t('projectDetail.cost.hiddenSpending', 'spending is not linked'),
      link: canFixSetup ? { to: '/administration/accounting#budget-account-map', label: t('projectDetail.cost.setUp', 'Set up') } : undefined,
    }]
    : []);
  const action = onOpenBudget && <BlockAction onClick={onOpenBudget}>{t('projectDetail.cost.openBudgetArea', 'Open budget')}</BlockAction>;

  if (pos.isPending || pos.budgetPositionPending) return <Block id="pd-cost" title={title}><ListState variant="loading" rows={4} /></Block>;
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
  const summaryTooltip = pos.ledgerBasis === 'pmo'
    ? t('projectDetail.cost.summaryTooltip', 'Project budget used is spent plus open orders divided by the active budget, before tax. Spent and category detail are shown separately.')
    : t('projectDetail.cost.summaryTooltipLedger', 'Project budget used is ledger spending divided by the active budget, before tax. Spent and category detail are shown separately.');
  const noActuals = pos.rows.every((row) => row.actual === null);
  const rows = pos.rows.slice().sort((a, b) => {
    // Nothing spent to compare: the rows are a comparison across categories, largest budget first.
    if (noActuals) return b.budget - a.budget;
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
  const committedFigure = pos.openCommitment === null ? null : Number(pos.openCommitment);
  const maxBudget = Math.max(0, ...pos.rows.map((row) => row.budget));
  const usedPercent = pos.usedPercent;
  const remaining = !pos.budgetComparisonKnown || pos.consumptionVariance === null ? null : -Number(pos.consumptionVariance);
  // Spending and open-order consumption can cross the budget at different times; name each measure explicitly.
  const overOnceCommitted = pos.ledgerBasis === 'pmo' && remaining !== null && remaining < 0 && pos.projectOver === null && !worst;

  const answer = !pos.canSeeActual || pos.spent === null || !pos.budgetComparisonKnown ? (
    <Headline tooltip={summaryTooltip}>{t('projectDetail.cost.budgetOnly', 'Budget {{budget}}', { budget: whole(pos.budget) })}</Headline>
  ) : pos.projectOver !== null ? (
    <>
      <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.projectOver', '{{amount}} over on spending', { amount: whole(pos.projectOver) })}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.projectOverSub', 'Spent {{spent}} of {{budget}} before tax', { spent: whole(pos.spent!), budget: whole(pos.budget) })}
        {worst && <> · {t('projectDetail.cost.mostly', 'mostly {{category}}', { category: label(worst.category) })}</>}</Sub>
    </>
  ) : worst ? (
    <>
      <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.categoryOver', '{{category}} is {{amount}} over on spending', { category: label(worst.category), amount: whole(worst.actual! - worst.budget) })}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.categoryOverSub', 'Spent {{spent}} of its {{budget}} budget before tax', { spent: whole(worst.actual!), budget: whole(worst.budget) })}</Sub>
    </>
  ) : pos.spent !== null ? (
    <>
      <Headline tooltip={summaryTooltip}>{overOnceCommitted
        ? t('projectDetail.cost.withinOnSpend', 'Within budget on spend')
        : t('projectDetail.cost.within', 'Within budget')}</Headline>
      <Sub tooltip={summaryTooltip}>{t('projectDetail.cost.withinSub', 'Spent {{spent}} of {{budget}} before tax', { spent: whole(pos.spent), budget: whole(pos.budget) })}</Sub>
    </>
  ) : null;

  const atRisk = pos.atRisk;

  return (
    <Block id="pd-cost" title={title} unit={<CostUnit project={project} />} action={action}>
      {answer}
      {usedPercent !== null && <Sub>
        {t('projectDetail.cost.snapshotUse', 'Budget used before tax: {{percent}}%', { percent: usedPercent })}
        {remaining !== null && <> · {remaining < 0
          ? pos.ledgerBasis === 'pmo'
            ? t('projectDetail.cost.snapshotOverOnCommitments', '{{amount}} over after open orders', { amount: whole(Math.abs(remaining)) })
            : t('projectDetail.cost.snapshotOverSpend', '{{amount}} over on spending', { amount: whole(Math.abs(remaining)) })
          : t('projectDetail.cost.snapshotRemaining', '{{amount}} remaining', { amount: whole(remaining) })}</>}
        {atRisk && <span className="ml-2 font-semibold text-warning-foreground">{t('projectDetail.cost.atRisk', 'At risk')}</span>}
      </Sub>}
      {pos.actualsPending && <Note>{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</Note>}
      {pos.actualsError && <Note>{t('projectDetail.cost.spendingError', "Couldn't check spending")} <Button variant="ghost" size="sm" onClick={() => void pos.refetchActuals()}>{t('common.retry', 'Retry')}</Button></Note>}
      {pos.budgetPositionError && <Note>{t('projectDetail.cost.spendingError', "Couldn't check spending")} <Button variant="ghost" size="sm" onClick={() => void pos.refetchActuals()}>{t('common.retry', 'Retry')}</Button></Note>}
      {pos.unknown > 0 && pos.spent !== null && <Note>{t('projectDetail.budget.uncategorizedTotalKnown', 'Project spending is known; some category amounts are not mapped.')}</Note>}
      {pos.canSeeActual && pos.currencyDiffers && !pos.actualsPending && !pos.actualsError && (
        <Note>{t('projectDetail.cost.currencyDiffers', 'Spending is recorded in {{currency}}, not the project currency, so it is not compared with the budget.', { currency: pos.spendCurrency })}</Note>
      )}
      {spendingUnlinked && !inFigureScope && (
        <Note>
          {t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")}{' '}
          {canFixSetup
            ? <FixLink to="/administration/accounting#budget-account-map">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</FixLink>
            : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}
        </Note>
      )}
      {committedFigure !== null && <Sub tooltip={t('projectDetail.cost.committedTooltip', 'Open purchase orders included once in project budget consumption, before tax.')}>{t('projectDetail.cost.committed', 'Open orders: {{amount}}', { amount: whole(committedFigure) })}</Sub>}
      {rows.length > 0 && (
        <ul className="mt-6 flex min-w-0 flex-col">
          {rows.map((r) => {
            const over = r.actual !== null && r.actual > r.budget;
            const pct = r.actual === null ? null : r.budget > 0 ? pctOf(r.actual, r.budget) : r.actual > 0 ? 101 : 0;
            const detail = t('projectDetail.cost.categoryTooltip', 'Active category budget and mapped spending before tax. Source: the active budget and project finance records.');
            return (
              <li key={r.category} className="border-b border-border/70 last:border-b-0">
                <Tooltip content={detail} block>
                  <Link to={`/projects/${project.id}/budget`} onClick={onOpenBudget ? (event) => { event.preventDefault(); onOpenBudget(); } : undefined}
                    aria-label={t('projectDetail.cost.openCategory', 'Open {{category}} in Budget', { category: label(r.category) })}
                    className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[minmax(8rem,0.8fr)_minmax(5rem,auto)_minmax(5rem,1fr)]">
                    <span className="truncate text-sm font-medium text-foreground">{label(r.category)}</span>
                    <span className={cn('text-right text-sm tabular-nums sm:order-last', over ? 'font-semibold text-destructive-text' : 'text-muted-foreground')}>
                      {r.actual === null
                        ? whole(r.budget)
                        : t('projectDetail.cost.rowSpent', '{{spent}} of {{budget}} before tax', { spent: whole(r.actual), budget: whole(r.budget) })}
                    </span>
                    {pct === null && maxBudget > 0 && <span aria-hidden="true" data-testid="category-budget-bar" className="col-span-2 h-1.5 w-full rounded-full bg-secondary sm:col-span-1">
                      <span className="block h-full rounded-full bg-muted-foreground/60" style={{ width: `${Math.round((r.budget / maxBudget) * 100)}%` }} />
                    </span>}
                    {pct !== null && <span className="col-span-2 w-full sm:col-span-1">
                      <ProgressBar value={pct} widthless className="w-full" aria-label={r.budget === 0 && r.actual! > 0
                        ? t('projectDetail.cost.categoryNoBudget', '{{category}} has spending with no budget', { category: label(r.category) })
                        : t('projectDetail.cost.categoryUse', '{{category}} uses {{percent}}% of its budget before tax', { category: label(r.category), percent: pct })} />
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

const DeliveryBlockView: React.FC<{ projectId: string; isPipeline?: boolean; children?: React.ReactNode }> = ({ projectId, isPipeline = false, children }) => {
  const { t } = useTranslation('project');
  const title = t('projectDetail.delivery.timelineTitle', 'Phase timeline');
  if (isPipeline) {
    return <Block id="pd-delivery" title={title}><MilestoneStrip projectId={projectId} compactWhenEmpty /></Block>;
  }
  return <ActiveDeliveryBlock projectId={projectId} title={title}>{children}</ActiveDeliveryBlock>;
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const ActiveDeliveryBlock: React.FC<{ projectId: string; title: string; children?: React.ReactNode }> = ({ projectId, title, children }) => {
  const { t } = useTranslation('project');
  const { t: tStatus } = useTranslation('status');
  const may = usePermission();
  const [managing, setManaging] = useState(false);
  const q = useMilestones(projectId);
  const tasks = useTasks(projectId);
  const manage = may('edit', 'project') && (
    <BlockAction onClick={() => setManaging((m) => !m)} expanded={managing}>
      {managing ? t('projectDetail.delivery.doneManaging', 'Done') : t('projectDetail.delivery.manage', 'Update phases')}
    </BlockAction>
  );
  // L10: the task Gantt lives on Tasks › Timeline; the Overview keeps phases and links there.
  const action = (
    <span className="flex items-center gap-x-4">
      <BlockAction to={`/projects/${projectId}/tasks?view=timeline`}>{t('projectDetail.delivery.openTimeline', 'Open timeline')}</BlockAction>
      {manage}
    </span>
  );
  if (managing) return <Block id="pd-delivery" title={title} action={manage}><MilestoneStrip projectId={projectId} /></Block>;
  if (q.isPending || tasks.isPending) return <Block id="pd-delivery" title={title}><ListState variant="loading" rows={3} /></Block>;
  if (q.isError || tasks.isError) return <Block id="pd-delivery" title={title}><ListState variant="error" title={t('projectDetail.delivery.error', "Couldn't load the phase timeline")} onRetry={() => { void q.refetch(); void tasks.refetch(); }} /></Block>;
  const all = q.data ?? [];
  if (all.length === 0) {
    return (
      <Block id="pd-delivery" title={title} action={manage}>
        <p className="text-sm text-muted-foreground">{t('projectDetail.delivery.empty', 'No phases yet. Add phases to track delivery progress.')}</p>
        {children && <div className="mt-8">{children}</div>}
      </Block>
    );
  }
  const today = todayIso();
  const totalWeight = all.reduce((s, m) => s + m.weight, 0);
  const current = all.find((milestone) => milestone.effective_pct < 100);
  const donePhases = all.filter((milestone) => milestone.effective_pct >= 100).length;
  const phasesDone = t('projectDetail.delivery.phasesDone', '{{done}} of {{total}} phases complete', { done: donePhases, total: all.length });
  return (
    <Block id="pd-delivery" title={title} action={action}>
      <div data-testid="phase-read-details">
        {/* The weighted % lives once, in the header facts; this block answers "which phase are we in?". */}
        <Headline tooltip={t('projectDetail.delivery.currentTooltip', 'The first phase in plan order that is not complete. Source: the project phase plan and linked task progress.')}>
          {current?.name ?? t('projectDetail.delivery.allPhasesDone', 'All phases complete')}
        </Headline>
        <Sub>{current ? <>{t('projectDetail.milestones.currentPhaseLabel', 'Current phase')} · {phasesDone}</> : phasesDone}</Sub>
        <ul className="mt-4 divide-y divide-border/70">
          {all.map((milestone) => {
            const phaseTasks = (tasks.data ?? []).filter((task) => task.milestone_id === milestone.id && !task.parent_task_id);
            const doneTasks = phaseTasks.filter((task) => task.status === 'Done').length;
            const blockingTasks = phaseTasks.filter((task) => task.status === 'Blocked');
            const weightShare = totalWeight > 0 ? Math.round((milestone.weight / totalWeight) * 100) : 0;
            const pct = completionPct(milestone.effective_pct);
            const started = milestone.effective_pct > 0 || milestone.task_count > 0;
            const overdue = Boolean(milestone.target_date && milestone.target_date < today && milestone.effective_pct < 100 && started);
            const lateText = overdue ? formatDaysOverdue(milestone.target_date, tStatus) : null;
            return (
              <li key={milestone.id} className="grid min-w-0 items-center gap-x-4 gap-y-1 py-2.5 md:grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)_12rem]">
                <span className={cn('min-w-0 break-words text-sm text-foreground', milestone.id === current?.id ? 'font-semibold' : 'font-medium')}>{milestone.name}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {milestone.target_date && (overdue
                    ? <span className="font-medium text-destructive-text">{lateText} · {formatDay(milestone.target_date)}</span>
                    : <span>{t('projectDetail.delivery.phaseTarget', 'Target {{date}}', { date: formatDay(milestone.target_date) })}</span>)}
                  <span>{t('projectDetail.milestones.weightShare', '{{pct}}% of project', { pct: String(weightShare) })}</span>
                  <span>{t('projectDetail.milestones.taskCount', '{{done}} of {{total}} tasks', { done: doneTasks, total: phaseTasks.length || milestone.task_count })}</span>
                  {blockingTasks.map((task) => <Link key={task.id} to={`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`} className="font-semibold text-primary-text hover:underline">{task.name}</Link>)}
                </span>
                {/* N3: a block tooltip trigger spans the row, so the bar keeps its full track on phone (it collapsed to the label). */}
                <Tooltip block content={t('projectDetail.delivery.phaseProgressTooltip', 'Manual phase progress when set; otherwise done phase tasks divided by the phase task count. Source: the project phase plan.')}>
                  <span tabIndex={0} className="flex w-full min-w-0">
                    {/* Delivery progress stays primary until the phase is complete, then success. */}
                    <ProgressBar value={pct} tone={milestone.effective_pct >= 100 ? 'success' : 'primary'} showValue widthless className="w-full"
                      aria-label={t('projectDetail.delivery.phaseProgressAria', '{{name}} {{pct}}% complete', { name: milestone.name, pct })} />
                  </span>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      </div>
      {children && <div className="mt-8">{children}</div>}
    </Block>
  );
};

// The Overview re-renders on each attention-query settle; these blocks read their own data, so a re-render
// that changes none of their props skips them.
export const MoneyBlock = React.memo(MoneyBlockView);
export const CostBlock = React.memo(CostBlockView);
export const DeliveryBlock = React.memo(DeliveryBlockView);
