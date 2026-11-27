import FxEquivalent from '@/src/components/fx/FxEquivalent';
import { useMayViewProjectMoney } from '@/src/hooks/useProjectMoneyScope';
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, FigureHiddenLine, Icon, ListState, ProgressBar, RecordSection, TaxBasisLabel, Tooltip, useFigureReport, type HiddenFigure } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import { FigureContent } from '@/src/components/ui/FigureContent';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { useTasks } from '@/src/hooks/useTasks';
import { useBoqItems, useProjectBilling } from '@/src/hooks/useProgressBilling';
import { useSalesInvoices } from '@/src/hooks/useRevenue';
import { useMilestones } from '@/src/hooks/useMilestones';
import { completionPct, formatDayYear, daysOverdue, formatTableMoney, formatTileMoney } from '@/src/lib/format';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { isTaxTreatment } from '@/src/lib/taxTreatment';
import { budgetLeftAfterOrders, deriveMargin } from '@/src/lib/projectFinances';
import { isMoneyAtRisk } from '@/src/lib/dashboardConstants';
import { useProjectCommittedSpend, useProjectProcurements } from '@/src/hooks/useProcurements';
import { buildBudgetSummaryRows, resolveProjectCommitment, uncategorizedSpendNote } from '@/src/lib/budget/budgetModel';
import MilestoneStrip from './MilestoneStrip';
import { useBudgetPosition } from '@/src/hooks/useProjectPosition';
import { settlementFromFinanceBuckets, settlementIn } from '@/src/lib/invoiceSettlement';
import ProjectProfitLossSection from './ProjectProfitLossSection';
import { ProjectFinancesSection } from './ProjectFinancesSection';
import { countedTasks } from '@/src/lib/tasks/taskTree';
import { taskMilestoneIds } from '@/src/lib/delivery/milestoneRollup';

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
  <RecordSection headingId={id} title={title} subline={unit} actions={action} className={cn('min-w-0', fillRow && 'flex h-full flex-col')} bodyClassName={fillRow ? 'flex flex-1 flex-col' : undefined}>
    {children}
  </RecordSection>
);

const Headline: React.FC<{ tone?: 'danger'; tooltip?: string; children: React.ReactNode }> = ({ tone, tooltip, children }) => (
  <p className={cn('text-group font-semibold leading-tight tabular-nums', tone === 'danger' ? 'text-destructive-text' : 'text-foreground')}>
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


/* ── Money: how much of the contract have we billed and collected? ─────────────────────────── */

const MoneyBlockView: React.FC<{ project: ProjectWithRefs; fillRow?: boolean; /** One line at the panel foot (the empty billing milestones). */ footer?: React.ReactNode }> = ({ project, fillRow = false, footer }) => {
  const { t } = useTranslation('project');
  const whole = moneyIn(project.currency);
  const [financeDetailsOpen, setFinanceDetailsOpen] = useState(false);
  const q = useProjectFinances(project.id);
  const may = usePermission();
  const canViewMoney = useMayViewProjectMoney();
  const boq = useBoqItems(project.id);
  const billing = useProjectBilling(project.id);
  const invoices = useSalesInvoices(project.id, { enabled: canViewMoney });
  // Spent closes the row (contracted, billed, paid, spent): the same read the Budget panel below uses, so the two agree.
  const pos = useBudgetPosition(project, true, { refetchOnMount: false });
  const unit = (
    <>
      {project.currency}
      {isTaxTreatment(project.tax_treatment) && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="inline text-sm text-muted-foreground" /></>}
    </>
  );
  const title = t('projectDetail.money.positionTitle', 'Money position');
  if (q.isPending || boq.isPending || billing.isPending) return <Block id="pd-money" title={title} unit={unit} fillRow={fillRow}><ListState variant="loading" rows={4} /></Block>;
  if (q.isError || !q.data || boq.isError || billing.isError || !billing.data) {
    return <Block id="pd-money" title={title} unit={unit} fillRow={fillRow}><ListState variant="error" title={t('projectDetail.money.error', "Couldn't load the money position")} onRetry={() => { void q.refetch(); void boq.refetch(); void billing.refetch(); }} /></Block>;
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
  // #2204: Invoiced and Paid read the server projection's per-currency bucket on the gross (incl. tax) basis, so
  // Paid + outstanding = Invoiced. A second or other currency is unknown, never the project-currency subset.
  const settlementReading = settlementFromFinanceBuckets(data.invoices);
  const settlement = settlementReading ? settlementIn(settlementReading, project.currency) : null;
  const settlementCurrencyUnknown = settlementReading !== null && settlement === null;
  const invoiced = settlement?.gross ?? null;
  const paid = settlement?.settled ?? null;
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
    { key: 'ordered', label: t('projectDetail.money.ordered', 'In work orders'), value: ordered, source: t('projectDetail.money.orderedSource', 'Sum of issued work-order allocations multiplied by BoQ unit rates.') },
    { key: 'delivered', label: t('projectDetail.money.delivered', 'Delivered'), value: delivered, source: t('projectDetail.money.deliveredSource', 'Sum of accepted quantities multiplied by BoQ unit rates.') },
    { key: 'invoiced', label: t('projectDetail.money.invoiced', 'Invoiced'), value: invoiced, source: t('projectDetail.money.invoicedSource', 'Sum of non-draft, non-cancelled invoices in the project currency, including tax.') },
    { key: 'paid', label: t('projectDetail.money.paid', 'Paid'), value: paid, source: t('projectDetail.money.paidSource', 'Invoice amount including tax, less accounting outstanding balance; this is settlement, not receipt cash.') },
  ].filter((step): step is { key: string; label: string; value: number; source: string } => step.value !== null);
  const stepLabels = { ordered: t('projectDetail.money.ordered', 'In work orders'), delivered: t('projectDetail.money.delivered', 'Delivered'), invoiced: t('projectDetail.money.invoiced', 'Invoiced'), paid: t('projectDetail.money.paid', 'Paid') };
  const marginHiddenReason = margin?.reason === 'different-currencies'
    ? t('projectDetail.money.marginOutCurrency', 'Gross margin is left out because spending and billed work use different currencies.')
    : margin?.reason === 'work-unavailable'
      ? t('projectDetail.money.marginOutWork', 'Gross margin is left out until billed-work revenue is complete.')
      : margin?.reason === 'restricted-rows'
        ? t('projectDetail.money.marginOutRestricted', 'Gross margin is hidden because some spending is restricted.')
        : margin?.reason === 'actuals-unavailable'
          ? t('projectDetail.money.marginOutActuals', 'Gross margin is left out until spending is linked for every budget category.')
          : t('projectDetail.money.marginOutNoInvoices', 'Gross margin starts with the first invoice in the project currency.');
  const hidden: HiddenFigure[] = [
    ...(contractValue === null ? [{ label: t('projectDetail.money.contract', 'Contract'), reason: t('projectDetail.money.contractUnavailable', 'Contract value is not recorded.') }] : []),
    ...(ordered === null ? [{ label: stepLabels.ordered, reason: t('projectDetail.money.noBoq', 'Ordered and delivered values are not tracked until the project has a BoQ.') }] : []),
    ...(delivered === null ? [{ label: stepLabels.delivered, reason: t('projectDetail.money.noBoq', 'Ordered and delivered values are not tracked until the project has a BoQ.') }] : []),
    ...(settlementCurrencyUnknown
      ? [{ label: t('projectDetail.money.invoicedAndPaid', 'Invoiced and paid'), reason: t('projectDetail.money.settlementCurrencyOut', 'Invoiced and paid are left out because the invoices are not all in the project currency.') }]
      : [
        ...(invoiced === null ? [{ label: stepLabels.invoiced, reason: t('projectDetail.money.invoicedOut', 'Invoiced is left out until every invoice amount is known.') }] : []),
        ...(paid === null ? [{ label: stepLabels.paid, reason: t('projectDetail.money.paidOut', 'Paid is left out until every invoice balance is known.') }] : []),
      ]),
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
      // Walk G9: the fix lives on Receivables, so only a role Finance admits is sent there.
      link: may('view', 'finance') ? { to: '/finance/receivables?view=payments', label: t('projectDetail.money.matchPayments', 'Match payments') } : undefined,
    }] : []),
  ];
  const share = (value: number | null) => value !== null && contractValue !== null && contractValue > 0 ? pctOf(value, contractValue) : null;
  const tile = (value: number) => formatTileMoney(value, project.currency) ?? whole(value);
  // Cash received is a figure of its own (receipts), so it joins the strip after Paid.
  const spentKnown = pos.canSeeActual && !pos.isPending && !pos.isError && pos.spent !== null;
  const figures = [
    ...steps,
    // Received qualifies Paid (settled in accounting vs cash matched), so it is Paid's caption; its own figure only when Paid is unknown.
    ...(cashReceived === null || paid !== null ? [] : [{
      key: 'received', label: t('projectDetail.money.cashReceivedFigure', 'Received'), value: cashReceived,
      source: t('projectDetail.money.cashReceivedSource', 'Customer receipts matched to this project’s invoices.'),
    }]),
    ...(spentKnown ? [{
      key: 'spent', label: t('projectDetail.budget.spent', 'Spent'), value: pos.spent as number,
      source: t('projectDetail.cost.summaryTooltip', 'Spent as a share of budget, before tax.'),
    }] : []),
  ];

  return (
    <Block id="pd-money" title={title} unit={unit} fillRow={fillRow}>
      {/* The client's money as one row of figures, contract first: label over figure, its share of the contract
          under it, so each amount sits with its name (no label-to-amount gap across the panel). Tiles carry
          2–3 significant digits; the exact amount is the hover title and the screen-reader text. */}
      <div className="@container min-w-0">
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-5 @lg:grid-cols-4 @lg:gap-x-6" aria-label={t('projectDetail.money.cascadeLabel', 'Contract to payment')}>
        {[...figures.filter((step) => step.key === 'contract' || step.key === 'spent'), ...figures.filter((step) => step.key !== 'contract' && step.key !== 'spent')].map((step) => {
          // A share under a zero says nothing; known zeros keep their figure but lose the caption.
          const pct = step.key === 'contract' || step.key === 'received' || step.key === 'spent' || step.value === 0 ? null : share(step.value);
          const budgetCaption = step.key === 'spent' && pos.hasBudget && pos.budgetComparisonKnown && pos.budget !== null
            ? t('projectDetail.money.ofBudget', 'of {{amount}} budget', { amount: tile(Number(pos.budget)) }) : null;
          return (
            // relative: the exact amount's screen-reader copy (sr-only, absolutely placed) stays inside its tile.
            <div key={step.key} data-testid={step.key === 'received' ? 'money-lead-cash' : undefined} className={cn("relative min-w-0", (step.key === 'contract' || step.key === 'spent') && '@lg:col-span-2')}>
              <dt className="text-control font-medium text-foreground">{explain(step.source, step.label, 'text-foreground')}</dt>
              <dd className={cn('mt-1 whitespace-nowrap font-semibold leading-tight tabular-nums', (step.key === 'contract' || step.key === 'spent') ? 'text-metric' : 'text-lg', step.value === 0 && step.key !== 'contract' ? 'text-muted-foreground' : 'text-foreground')} data-testid={step.key === 'contract' ? 'contract-value-amount' : undefined}>
                <FigureContent value={tile(step.value)} exactValue={whole(step.value)} />
              </dd>
              {pct !== null && <dd className="mt-1 text-control tabular-nums text-muted-foreground">{t('projectDetail.money.shareOfContract', '{{percent}}% of contract', { percent: pct })}</dd>}
              {step.key === 'paid' && cashReceived !== null && <dd data-testid="money-lead-cash" className="mt-1 text-control tabular-nums text-muted-foreground">{t('projectDetail.money.receivedCaption', 'Received {{amount}}', { amount: tile(cashReceived) })}</dd>}
              {budgetCaption && <dd className="mt-1 text-control tabular-nums text-muted-foreground">{budgetCaption}</dd>}
              {step.key === 'contract' && <dd className="mt-1"><FxEquivalent amount={step.value} currency={project.currency} date={project.contract_date} compact /></dd>}
            </div>
          );
        })}
      </dl>
      </div>
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
      {/* The figures this panel cannot compute yet are named here, beside the ones it shows. */}
      {hidden.length > 0 && <FigureHiddenLine compact figures={hidden.map((figure) => ({ ...figure, label: figure.label.replace(/\s*\(.*\)$/u, '') }))} className="mt-4 text-control text-muted-foreground" />}
      {/* Details and the empty-milestones line share one row on the panel foot (margin-top:auto beside a taller Needs attention). */}
      <div aria-hidden="true" className="h-4 shrink-0" />
      <div className={cn('flex flex-wrap items-center justify-between gap-x-4 border-t border-border/70 pt-3', fillRow && 'mt-auto')} data-testid="money-position-details">
        <button type="button" aria-expanded={financeDetailsOpen} onClick={() => setFinanceDetailsOpen((open) => !open)}
          className="touch-target inline-flex items-center gap-2 cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground">
          <Icon name="chev" className={`size-3.5 transition-transform motion-reduce:transition-none ${financeDetailsOpen ? 'rotate-90' : ''}`} />
          {t('projectDetail.money.details', 'Details')}
        </button>
        {footer}
        {financeDetailsOpen && <div className="basis-full space-y-4 pt-4"><ProjectFinancesSection project={project} /></div>}
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

const CostBlockView: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void; isPipeline?: boolean; showUnit?: boolean }> = ({ project, onOpenBudget, isPipeline = false, showUnit = true }) => (
  isPipeline ? <EstimatedBudgetBlock project={project} /> : <ActiveCostBlock project={project} onOpenBudget={onOpenBudget} showUnit={showUnit} />
);

const ActiveCostBlock: React.FC<{ project: ProjectWithRefs; onOpenBudget?: () => void; showUnit?: boolean }> = ({ project, onOpenBudget, showUnit = true }) => {
  const { t } = useTranslation('project');
  const whole = moneyIn(project.currency);
  const may = usePermission();
  const canFixSetup = may('manage', 'orgAccounting');
  const pos = useBudgetPosition(project, true, { refetchOnMount: false });
  const canReadProcurements = may('view', 'procurement');
  const committed = useProjectCommittedSpend(canReadProcurements ? project.id : null, canReadProcurements);
  const procurements = useProjectProcurements(canReadProcurements ? project.id : null);
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
        <p data-empty="" className="text-sm text-muted-foreground">{t('projectDetail.cost.noBudget', 'No active budget yet, so spending can’t be compared.')}</p>
      </Block>
    );
  }
  const worst = pos.overRows[0];
  const summaryTooltip = pos.ledgerBasis === 'pmo'
    ? t('projectDetail.cost.summaryTooltip', 'Spent as a share of budget, before tax.')
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
  const fallbackRows = canReadProcurements && committed.commitmentSource === 'pmo' && !procurements.isPending && !procurements.isError
    ? buildBudgetSummaryRows({
      lines: pos.rows.map((row) => ({ category: row.category, description: null, budgeted_amount: row.budget })),
      actuals: pos.rows, procurements: procurements.data, canReadProcurements, currency: project.currency,
    }) : null;
  const committedFigure = resolveProjectCommitment(pos.openCommitment, fallbackRows);
  const maxBudget = Math.max(0, ...pos.rows.map((row) => row.budget));
  const budgetAvailable = pos.budgetAvailable ?? (pos.spent === null || pos.budgetComparisonKnown);
  const remaining = budgetLeftAfterOrders(pos.budgetComparisonKnown ? pos.budget : null, pos.spent, committedFigure);
  // The headline follows spending; open orders can separately cross the budget.
  const atRisk = isMoneyAtRisk({ status: project.status as string, budget: pos.budget, budgetCurrency: project.currency, projectCurrency: project.currency, spent: pos.spent, actualCurrency: pos.spent === null ? null : project.currency, actualComplete: pos.spent !== null });
  const overOnceCommitted = remaining !== null && remaining < 0 && pos.projectOver === null && !worst;
  const verdict = !pos.canSeeActual || pos.spent === null || !budgetAvailable ? null
    : pos.projectOver !== null ? <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.projectOver', '{{amount}} over budget', { amount: whole(pos.projectOver) })}</Headline>
      : worst ? <Headline tone="danger" tooltip={summaryTooltip}>{t('projectDetail.cost.categoryOver', '{{category}} is {{amount}} over budget', { category: label(worst.category), amount: whole(worst.actual! - worst.budget) })}</Headline>
        : <Headline tooltip={summaryTooltip}>{overOnceCommitted ? t('projectDetail.cost.withinOnSpend', 'Within budget on spend') : t('projectDetail.cost.within', 'Within budget')}</Headline>;

  const answer = pos.canSeeActual && pos.spent !== null && !budgetAvailable ? (
    <Sub>{t('projectDetail.cost.spentOnly', 'Spent {{spent}}', { spent: whole(pos.spent) })}</Sub>
  ) : !pos.canSeeActual || pos.spent === null ? (
    <Headline tooltip={summaryTooltip}>{t('projectDetail.cost.budgetOnly', 'Budget {{budget}}', { budget: whole(pos.budget) })}</Headline>
  ) : (
    <Sub tooltip={summaryTooltip}>
      {t('projectDetail.cost.withinSub', 'Spent {{spent}} of {{budget}}', { spent: whole(pos.spent), budget: whole(pos.budget) })}
      {atRisk && <span className="ml-2 font-semibold text-warning-foreground">{t('projectDetail.cost.atRisk', 'At risk')}</span>}
    </Sub>
  );

  return (
    <Block id="pd-cost" title={title} unit={showUnit ? <CostUnit project={project} /> : undefined} action={action}>
      {verdict}
      {answer}
      <Sub>
        {committedFigure === null
          ? t('projectDetail.cost.commitmentsUnknown', 'Open orders are unknown')
          : t('projectDetail.cost.committedInOrders', 'Committed {{amount}}', { amount: whole(committedFigure) })}
        {/* The unlinked note says why spending is missing; the clause would say it twice. */}
        {pos.spent === null && !(spendingUnlinked && !inFigureScope) && <> · {t('projectDetail.cost.spendingUnavailable', 'Spending is unavailable')}</>}
        {!budgetAvailable && <> · {t('projectDetail.cost.budgetUnavailable', 'Budget is unavailable for comparison')}</>}
        {pos.spent !== null && budgetAvailable && <> · {committedFigure === null || remaining === null
          ? t('projectDetail.cost.leftUnknown', 'Left after open orders is unknown')
          : remaining < 0
            ? overOnceCommitted
              ? t('projectDetail.cost.snapshotOverOnCommitments', '{{amount}} over once committed orders land', { amount: whole(Math.abs(remaining)) })
              : t('projectDetail.budget.overAfterOrdersAmount', '{{amount}} over after open orders', { amount: whole(Math.abs(remaining)) })
            : t('projectDetail.cost.leftAfterOrders', 'Left after open orders {{amount}}', { amount: whole(remaining) })}</>}
      </Sub>
      {pos.actualsPending && <Note>{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</Note>}
      {pos.actualsError && <Note>{t('projectDetail.cost.spendingError', "Couldn't check spending")} <Button variant="ghost" size="sm" onClick={() => void pos.refetchActuals()}>{t('common.retry', 'Retry')}</Button></Note>}
      {pos.budgetPositionError && <Note>{t('projectDetail.cost.spendingError', "Couldn't check spending")} <Button variant="ghost" size="sm" onClick={() => void pos.refetchActuals()}>{t('common.retry', 'Retry')}</Button></Note>}
      {pos.uncategorized && pos.spent !== null
        ? <Note>{uncategorizedSpendNote(pos.uncategorized.amount, pos.spendCurrency ?? project.currency, t)}</Note>
        : pos.unknown > 0 && pos.spent !== null && <Note>{t('projectDetail.budget.uncategorizedTotalKnown', 'Not split by category')}</Note>}
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
      {rows.length > 0 && (
        // One row grid with the Phase timeline: category, figure, then the bar column at the right edge.
        <div className="mt-5 text-sm">
          {/* Visual column heads; each row link already names its category and use for assistive tech. */}
          <div aria-hidden="true" className={cn(BUDGET_GRID, 'max-md:hidden border-b border-border/70 pb-2 text-control text-muted-foreground')}>
            <span>{t('projectDetail.cost.colCategory', 'Category')}</span>
            <span className="text-right">{noActuals ? t('projectDetail.cost.colBudget', 'Budget') : t('projectDetail.cost.colSpentOfBudget', 'Spent of budget')}</span>
            <span>{noActuals ? t('projectDetail.cost.colShare', 'Share of budget') : t('projectDetail.cost.colUsed', 'Used')}</span>
          </div>
          {rows.map((r) => {
            const over = r.actual !== null && r.actual > r.budget;
            const pct = r.actual === null ? null : r.budget > 0 ? pctOf(r.actual, r.budget) : r.actual > 0 ? 101 : 0;
            const detail = t('projectDetail.cost.categoryTooltip', 'Active category budget and mapped spending before tax. Source: the active budget and project finance records.');
            return (
              <div key={r.category} className="border-b border-border/70 last:border-b-0">
                <Tooltip content={detail} block>
                  <Link to={`/projects/${project.id}/budget`} onClick={onOpenBudget ? (event) => { event.preventDefault(); onOpenBudget(); } : undefined}
                    aria-label={t('projectDetail.cost.openCategory', 'Open {{category}} in Budget', { category: label(r.category) })}
                    className={cn(BUDGET_GRID, 'w-full py-2.5 hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
                    <span className="min-w-0 break-words font-normal text-foreground max-md:basis-full">{label(r.category)}</span>
                    <span className={cn('whitespace-nowrap text-right tabular-nums max-md:text-left', over ? 'font-medium text-destructive-text' : 'text-muted-foreground')}>
                      {r.actual === null
                        ? whole(r.budget)
                        : t('projectDetail.cost.rowSpent', '{{spent}} of {{budget}}', { spent: whole(r.actual), budget: whole(r.budget) })}
                    </span>
                    <span className="flex min-w-0 items-center max-md:min-w-32 max-md:flex-1">
                      {pct === null && maxBudget > 0 && <span aria-hidden="true" data-testid="category-budget-bar" className="h-1.5 w-full rounded-full bg-secondary">
                        <span className="block h-full rounded-full bg-mark-neutral/60" style={{ width: `${Math.round((r.budget / maxBudget) * 100)}%` }} />
                      </span>}
                      {pct !== null && <ProgressBar value={pct} showValue widthless className="w-full [&>span:last-child]:w-12" aria-label={r.budget === 0 && r.actual! > 0
                        ? t('projectDetail.cost.categoryNoBudget', '{{category}} has spending with no budget', { category: label(r.category) })
                        : t('projectDetail.cost.categoryUse', '{{category}} uses {{percent}}% of budget', { category: label(r.category), percent: pct })} />}
                    </span>
                  </Link>
                </Tooltip>
              </div>
            );
          })}
        </div>
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

/** The overview's shared row grid: the name column flexes, figure columns are fixed, and the bar column (10rem) ends every row on the panel inset. Literal strings so Tailwind sees them. */
const PHASE_GRID = 'grid min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-4 gap-y-1 md:grid-cols-[minmax(0,1fr)_7rem_6rem_4.5rem_5rem_10rem]';
// Phone: one wrapping line under the category, so the bar sits beside the figure only when both fit, never over it.
const BUDGET_GRID = 'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 md:grid md:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)_10rem]';

const ActiveDeliveryBlock: React.FC<{ projectId: string; title: string; children?: React.ReactNode }> = ({ projectId, title, children }) => {
  const { t } = useTranslation('project');
  const may = usePermission();
  // #2088: phase lateness is judged against the organization's business day, never the UTC day.
  const today = useOrgToday();
  const [managing, setManaging] = useState(false);
  const q = useMilestones(projectId);
  const tasks = useTasks(projectId);
  // #2807: a phase's task count reads each piece of work once (a parent is a roll-up of its subtasks).
  const countedProjectTasks = useMemo(() => countedTasks(tasks.data ?? []), [tasks.data]);
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
        {/* No phases, no dated points: the progress curve has nothing to draw, so it is not mounted. */}
        <p data-empty="" className="text-sm text-muted-foreground">{t('projectDetail.delivery.empty', 'No phases yet. Add phases to track delivery progress.')}</p>
      </Block>
    );
  }
  const totalWeight = all.reduce((s, m) => s + m.weight, 0);
  const current = all.find((milestone) => milestone.effective_pct < 100);
  const donePhases = all.filter((milestone) => milestone.effective_pct >= 100).length;
  const phasesDone = t('projectDetail.delivery.phasesDone', '{{done}} of {{total}} phases complete', { done: donePhases, total: all.length });
  // A phase past its target is "late" (screen rules: overdue is for tasks and invoices). Exception colour once:
  // only the latest phase is red; the others state their lateness in plain text.
  const lateDaysOf = (milestone: (typeof all)[number]) => {
    const started = milestone.effective_pct > 0 || milestone.task_count > 0;
    return milestone.target_date && milestone.target_date < today && milestone.effective_pct < 100 && started
      ? daysOverdue(milestone.target_date) : null;
  };
  const worstLate = all.reduce<{ id: string | null; days: number }>((worst, milestone) => {
    const days = lateDaysOf(milestone) ?? 0;
    return days > worst.days ? { id: milestone.id, days } : worst;
  }, { id: null, days: 0 });
  return (
    <Block id="pd-delivery" title={title} action={action}>
      <div data-testid="phase-read-details">
        {/* The weighted % lives once, in the header facts; this block answers "which phase are we in?". */}
        {/* #design-1115: the card leads with its answer — "Current phase: X" — and how many phases are done. */}
        <Headline tooltip={t('projectDetail.delivery.currentTooltip', 'The first phase in plan order that is not complete. Source: the project phase plan and linked task progress.')}>
          {current
            ? t('projectDetail.delivery.currentPhaseIs', 'Current phase: {{name}}', { name: current.name })
            : t('projectDetail.delivery.allPhasesDone', 'All phases complete')}
        </Headline>
        <Sub>{phasesDone}</Sub>
        {/* One row grid with the Budget block: name, figures, then the bar column (fixed width) at the right edge. */}
        <div role="table" aria-label={title} className="mt-4 text-sm">
          <div role="row" className={cn(PHASE_GRID, 'max-md:sr-only border-b border-border/70 pb-2 text-control text-muted-foreground')}>
            <span role="columnheader">{t('projectDetail.delivery.colPhase', 'Phase')}</span>
            <span role="columnheader" className="md:text-right">{t('projectDetail.delivery.colDue', 'Due')}</span>
            <span role="columnheader" className="md:text-right">{t('projectDetail.delivery.colLateBy', 'Late by')}</span>
            <span role="columnheader" className="md:text-right">{t('projectDetail.delivery.colWeight', 'Weight')}</span>
            <span role="columnheader" className="md:text-right">{t('projectDetail.delivery.colTasks', 'Tasks')}</span>
            <span role="columnheader">{t('projectDetail.delivery.colProgress', 'Progress')}</span>
          </div>
          {all.map((milestone) => {
            const phaseTasks = countedProjectTasks.filter((task) => taskMilestoneIds(task).includes(milestone.id));
            const doneTasks = phaseTasks.filter((task) => task.status === 'Done').length;
            const blockingTasks = phaseTasks.filter((task) => task.status === 'Blocked');
            const weightShare = totalWeight > 0 ? Math.round((milestone.weight / totalWeight) * 100) : 0;
            const pct = completionPct(milestone.effective_pct);
            const lateDays = lateDaysOf(milestone);
            // On a phone the header row is hidden, so each figure carries its column name in front.
            const cue = (label: string) => <span className="md:sr-only">{label} </span>;
            return (
              <div role="row" key={milestone.id} className={cn(PHASE_GRID, 'border-b border-border/70 py-2.5 last:border-b-0')}>
                <span role="cell" className={cn('min-w-0 break-words text-foreground max-md:col-span-1', milestone.id === current?.id ? 'font-medium' : 'font-normal')}>
                  {milestone.name}
                  {blockingTasks.length > 0 && <span className="mt-0.5 flex flex-wrap gap-x-3">{blockingTasks.map((task) => <Link key={task.id} to={`/projects/${projectId}/tasks?open=${encodeURIComponent(task.id)}`} className="font-medium text-primary-text hover:underline">{task.name}</Link>)}</span>}
                </span>
                <span role="cell" className="tabular-nums text-muted-foreground md:text-right max-md:col-span-2 max-md:row-start-2 max-md:inline">
                  {milestone.target_date ? <>{cue(t('projectDetail.delivery.colDue', 'Due'))}{formatDayYear(milestone.target_date)}</> : '—'}
                </span>
                <span role="cell" className={cn('tabular-nums md:text-right max-md:hidden', lateDays === null ? 'text-muted-foreground' : milestone.id === worstLate.id ? 'font-medium text-destructive-text' : 'text-foreground')}>
                  {lateDays === null ? '—' : t('projectDetail.delivery.lateByDays', '{{count}} days', { count: lateDays })}
                </span>
                <span role="cell" className="tabular-nums text-muted-foreground md:text-right max-md:hidden">{t('projectDetail.delivery.weightPct', '{{pct}}%', { pct: String(weightShare) })}</span>
                <span role="cell" className="tabular-nums text-muted-foreground md:text-right max-md:hidden">{t('projectDetail.delivery.tasksOf', '{{done}} of {{total}}', { done: doneTasks, total: phaseTasks.length || milestone.task_count })}</span>
                {/* N3: a block tooltip trigger spans the cell, so the bar keeps its full track on phone. */}
                <span role="cell" className="min-w-0 max-md:col-start-2 max-md:row-start-1">
                  <Tooltip block content={t('projectDetail.delivery.phaseProgressTooltip', 'Manual phase progress when set; otherwise done phase tasks divided by the phase task count. Source: the project phase plan.')}>
                    <span tabIndex={0} className="flex w-full min-w-0">
                      {/* Delivery progress stays primary until the phase is complete, then success. */}
                      <ProgressBar value={pct} tone={milestone.effective_pct >= 100 ? 'success' : 'primary'} showValue widthless className="w-full [&>span:last-child]:w-12"
                        aria-label={t('projectDetail.delivery.phaseProgressAria', '{{name}} {{pct}}% complete', { name: milestone.name, pct })} />
                    </span>
                  </Tooltip>
                </span>
                {/* Phone: late by, weight and tasks read as one line under the name. */}
                <span className="col-span-2 text-control tabular-nums text-muted-foreground md:hidden" aria-hidden="true">
                  {[
                    lateDays === null ? null : t('projectDetail.delivery.phaseLate', '{{count}} days late', { count: lateDays }),
                    t('projectDetail.milestones.weightShare', '{{pct}}% of project', { pct: String(weightShare) }),
                    t('projectDetail.milestones.taskCount', '{{done}} of {{total}} tasks', { done: doneTasks, total: phaseTasks.length || milestone.task_count }),
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
            );
          })}
        </div>
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
