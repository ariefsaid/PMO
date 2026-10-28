import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardFigure } from './FigureGroup';
import type { DashboardPeriod } from './usePeriod';
import { periodDateRange } from './usePeriod';
import { useDashboard, useSalesPipeline, useWinRate } from '@/src/hooks/useDashboard';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useSalesInvoices, useIncomingPayments } from '@/src/hooks/useRevenue';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { useOrgCurrency, useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import type { ManagementPack } from '@/src/lib/reports/managementPack';
import type { IncomingPaymentRow } from '@/src/lib/db/revenue';
import type { UnbilledWorkOrderTotal } from '@/src/lib/db/workOrderBilling';
import { selectOverdueInvoices, selectSupplierInvoices } from './useNeedsYou';
import { orderByCurrency } from './currencyOrder';

export interface CompanyFiguresResult {
  today: DashboardFigure[];
  period: DashboardFigure[];
  todayPending: boolean;
  todayError: boolean;
  periodPending: boolean;
  periodError: boolean;
  todayRetry: () => void;
  periodRetry: () => void;
  dashboard: ReturnType<typeof useDashboard>['data'];
  dashboardPending: boolean;
  dashboardError: boolean;
  dashboardRetry: () => void;
  pipeline: ReturnType<typeof useSalesPipeline>['data'];
  pipelinePending: boolean;
  pipelineError: boolean;
  pipelineRetry: () => void;
  winRateRange: NonNullable<ReturnType<typeof periodDateRange>> & { key: string };
  orgCurrency: string;
  currencyPending: boolean;
  organizationToday: string | null;
  organizationDayPending: boolean;
  isEmpty: boolean;
}

export function selectInvoicedTotals(pack: ManagementPack | undefined, from: string | null, to: string | null) {
  if (!pack || !from || !to) return undefined;
  return pack.totals.map((row) => ({
    currency: row.currency,
    amount: row.months.filter((month) => month.month >= from && month.month <= to)
      .reduce((sum, month) => sum + month.invoiced, 0) / 100,
  }));
}

export interface CollectedTotals {
  totals: Array<{ currency: string; amount: number }>;
  unknownCurrencies: string[];
}

export function selectCollectedTotals(payments: IncomingPaymentRow[] | undefined, from: string | null, to: string | null): CollectedTotals | undefined {
  if (!payments || !from || !to) return undefined;
  const fromDate = `${from}-01`;
  const [year, month] = to.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  const toDate = `${to}-${String(last).padStart(2, '0')}`;
  const totals = new Map<string, number>();
  const unknownCurrencies = new Set<string>();
  for (const payment of payments) {
    if (payment.status !== 'Paid' || !payment.date || payment.date < fromDate || payment.date > toDate) continue;
    if (payment.amount === null || !Number.isFinite(payment.amount)) {
      unknownCurrencies.add(payment.currency);
      continue;
    }
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.amount);
  }
  return { totals: [...totals].map(([currency, amount]) => ({ currency, amount })), unknownCurrencies: [...unknownCurrencies] };
}

export function selectUnbilledTotals(totals: UnbilledWorkOrderTotal[] | undefined) {
  if (!totals) return undefined;
  return totals.map(({ currency, remaining }) => ({ currency, amount: remaining }));
}

/** Known currencies as one short figure plus its exact twin; an unknown currency is named only in the
 *  exact text (hover / screen reader), never as a "CUR —" value. Null when no currency is known. */
export function currencyFigure(
  rows: Array<{ currency: string; amount: number | null }>,
  orgCurrency: string,
  unavailable: string,
  unknownLabel: (currency: string) => string = (currency) => `${currency} unknown`,
): { value: string; exactValue: string } | null {
  const ordered = orderByCurrency(rows, orgCurrency);
  const known = ordered.filter((row): row is { currency: string; amount: number } => row.amount !== null && Number.isFinite(row.amount));
  if (known.length === 0) return null;
  const figures = known.map(({ currency, amount }) => moneyFigure(amount, currency, unavailable, { code: currency !== orgCurrency }));
  const unknown = ordered.filter((row) => !known.includes(row as { currency: string; amount: number })).map((row) => unknownLabel(row.currency));
  return {
    value: figures.map((figure) => figure.value).join(' · '),
    exactValue: [...figures.map((figure) => figure.exactValue ?? figure.value), ...unknown].join(' · '),
  };
}

/** One short figure per known currency, in the shared currency order (the lines behind a joined `value`). */
const currencyLines = (
  rows: Array<{ currency: string; amount: number | null }>,
  orgCurrency: string,
  unavailable: string,
): string[] => orderByCurrency(rows.filter((row) => row.amount !== null && Number.isFinite(row.amount)), orgCurrency)
  .map((row) => moneyFigure(row.amount as number, row.currency, unavailable, { code: row.currency !== orgCurrency }).value);

const currencyText = (
  rows: Array<{ currency: string; amount: number | null }>,
  orgCurrency: string,
  unavailable: string,
): string | null => currencyFigure(rows, orgCurrency, unavailable)?.value ?? null;

export function amountFromDashboard(rows: Array<{ currency: string; contract_value?: number | null; contract_remaining?: number | null; known_amount?: number | null; total_value?: number | null; weighted_value?: number | null }> | undefined,
  field: 'contract_value' | 'contract_remaining' | 'known_amount' | 'total_value' | 'weighted_value', orgCurrency: string, t: (key: string, fallback: string) => string): string | null {
  if (!rows || rows.length === 0) return null;
  return exactFromDashboard(rows, field, orgCurrency, t)?.value ?? null;
}

export function exactFromDashboard(rows: Array<{ currency: string; contract_value?: number | null; contract_remaining?: number | null; known_amount?: number | null; total_value?: number | null; weighted_value?: number | null }> | undefined,
  field: 'contract_value' | 'contract_remaining' | 'known_amount' | 'total_value' | 'weighted_value', orgCurrency: string, t: (key: string, fallback: string, options?: Record<string, unknown>) => string): { value: string; exactValue: string } | null {
  if (!rows || rows.length === 0) return null;
  const amounts = rows.map((row) => ({ currency: row.currency, amount: row[field] ?? null }));
  return currencyFigure(amounts, orgCurrency, t('figures.amountUnknown', 'Amount unavailable'), (currency) => t('figures.currencyUnknown', '{{currency}} amount unknown', { currency }));
}

export function useCompanyFigures(period: DashboardPeriod): CompanyFiguresResult {
  const { t } = useTranslation('dashboard');
  const dashboard = useDashboard();
  const pipeline = useSalesPipeline();
  const orgCurrency = useOrgCurrency();
  const currencyState = useOrgCurrencyState();
  const orgDay = useFxOrgDay(true);
  const invoices = useSalesInvoices();
  const payments = useIncomingPayments();
  // Shared-details select: the supplier invoice and payment rows behind the unpaid balance.
  const procurements = useProcurements({ withSharedDetails: true });
  const workOrders = useUnbilledWorkOrders();
  const dateRange = periodDateRange(period);
  const winRateRange = useMemo(() => ({ ...dateRange, key: `period:${period.from ?? ''}:${period.to ?? ''}` }), [dateRange, period.from, period.to]);
  const winRate = useWinRate(winRateRange);
  const pack = useManagementPack({
    from: period.from ? `${period.from}-01` : undefined,
    to: period.to ? `${period.to}-01` : undefined,
  });

  const overdue = useMemo(() => selectOverdueInvoices(invoices.data, orgDay.day), [invoices.data, orgDay.day]);
  const suppliers = useMemo(() => selectSupplierInvoices(procurements.data), [procurements.data]);
  const invoiced = useMemo(() => selectInvoicedTotals(pack.data, period.from, period.to), [pack.data, period.from, period.to]);
  const collected = useMemo(() => selectCollectedTotals(payments.data, period.from, period.to), [payments.data, period.from, period.to]);
  const unbilledTotals = useMemo(() => selectUnbilledTotals(workOrders.data?.totals), [workOrders.data?.totals]);
  const moneyReason = t('figures.moneyUnknownReason', 'The accounting source did not provide a comparable amount.');
  const overdueKnown = overdue?.knownTotals.length ? currencyText(overdue.knownTotals, orgCurrency, moneyReason) : null;
  const supplierKnown = suppliers?.knownTotals.length ? currencyText(suppliers.knownTotals, orgCurrency, moneyReason) : null;
  const unbilledKnown = unbilledTotals?.length ? currencyText(unbilledTotals, orgCurrency, moneyReason) : null;
  const invoiceCurrencyTotals = useMemo(() => invoiced ?? [], [invoiced]);
  const collectedCurrencyTotals = useMemo(() => collected?.totals ?? [], [collected]);
  const winCurrencyTotals = (winRate.data?.value_by_currency ?? [])
    .filter((row) => row.wins_value !== null && row.wins_value > 0)
    .map((row) => ({ currency: row.currency, amount: row.wins_value }));
  const unbilledCount = workOrders.data?.totals.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const onHand = dashboard.data?.on_hand_value_by_currency;
  const margin = dashboard.data?.on_hand_realized_margin_by_currency;
  const pipelineTotals = dashboard.data?.pipeline_total_value_by_currency;
  const pipelineWeighted = amountFromDashboard(pipelineTotals, 'weighted_value', orgCurrency, t);
  const pipelineGross = amountFromDashboard(pipelineTotals, 'total_value', orgCurrency, t);
  const onHandValue = amountFromDashboard(onHand, 'contract_value', orgCurrency, t)
    ?? (dashboard.data?.on_hand_value === null || dashboard.data?.on_hand_value === undefined
      ? null : moneyFigure(dashboard.data.on_hand_value, orgCurrency, moneyReason).value);
  const spendData = dashboard.data;
  const spendPartial = Boolean(spendData && (spendData.on_hand_actual_project_count < spendData.on_hand_actual_project_total
    || spendData.on_hand_actual_coverage_count < spendData.on_hand_actual_coverage_total));
  const remaining = amountFromDashboard(onHand, 'contract_remaining', orgCurrency, t)
    ?? (dashboard.data?.on_hand_contract_remaining === null || dashboard.data?.on_hand_contract_remaining === undefined
      ? null : moneyFigure(dashboard.data.on_hand_contract_remaining, orgCurrency, moneyReason).value);
  const billedMargin = amountFromDashboard(margin, 'known_amount', orgCurrency, t)
    ?? (dashboard.data?.on_hand_realized_margin === null || dashboard.data?.on_hand_realized_margin === undefined
      ? null : moneyFigure(dashboard.data.on_hand_realized_margin, orgCurrency, moneyReason).value);
  const unknownMarginProjects = margin?.reduce((sum, row) => sum + (row.unknown_projects ?? 0), 0) ?? 0;
  const billedMarginLabel = unknownMarginProjects > 0
    ? t('dashboard:hub.company.knownMarginOnBilledWork', 'Known margin on billed work')
    : t('figures.billedMargin', 'Margin on billed work');
  const today = useMemo<DashboardFigure[]>(() => [
    {
      id: 'contract-on-hand', label: t('figures.contractOnHand', 'Contract on hand'), value: onHandValue,
      unavailableReason: moneyReason,
      exactValue: exactFromDashboard(onHand, 'contract_value', orgCurrency, t)?.exactValue,
      // Some delivery projects or cost categories have no ledger actuals yet: the remainder is overstated.
      subline: remaining === null ? undefined : spendPartial
        ? `${t('figures.leftAfterRecordedSpending', 'Left after recorded spending')} (${t('figures.partial', 'Partial')}): ${remaining}`
        : `${t('figures.leftAfterSpending', 'Left after spending')}: ${remaining}`,
      // AC-IXD-DASH-W5-C2A: the list it opens holds exactly the projects the figure sums.
      href: '/projects?filter=Ongoing',
    },
    {
      id: 'billed-margin', label: billedMarginLabel, value: billedMargin,
      unavailableReason: moneyReason,
      exactValue: exactFromDashboard(margin, 'known_amount', orgCurrency, t)?.exactValue,
      href: '/sales-invoices',
    },
    {
      id: 'pipeline', label: t('figures.pipeline', 'Pipeline (weighted)'), value: pipelineWeighted,
      unavailableReason: moneyReason,
      exactValue: exactFromDashboard(pipelineTotals, 'weighted_value', orgCurrency, t)?.exactValue,
      subline: [pipelineGross === null ? null : `${t('figures.gross', 'Gross')}: ${pipelineGross}`, dashboard.data?.pipeline_projected_margin == null
        ? null
        : `${t('dashboard:hub.company.forecastMargin', 'Forecast margin')}: ${(dashboard.data.pipeline_projected_margin * 100).toFixed(1)}%`].filter(Boolean).join(' · ') || undefined,
      href: '/sales',
    },
    {
      id: 'client-overdue', label: t('figures.owedByClients', 'Owed by clients · overdue'),
      value: overdue === undefined ? null : String(overdue.count), unavailableReason: t('figures.overdueUnknown', 'Overdue invoice data is unavailable.'),
      subline: [overdueKnown, overdue?.count
        && overdue.oldestDays != null ? t('dashboard:hub.company.oldestOverdue', 'Oldest {{days}} days overdue', { days: overdue.oldestDays })
        : overdue?.count === 0 ? t('figures.noOverdue', 'No overdue client invoices') : null].filter(Boolean).join(' · ') || undefined,
      href: '/sales-invoices?overdue=true',
    },
    {
      id: 'supplier-payables', label: t('figures.owedToSuppliers', 'Owed to suppliers'),
      value: suppliers === undefined ? null : suppliers.count === 0 ? moneyFigure(0, orgCurrency, moneyReason).value : supplierKnown,
      unavailableReason: suppliers?.unknownBalances
        ? t('dashboard:hub.company.supplierBalancesUnknown', '{{count}} supplier invoice balances are unknown.', { count: suppliers.unknownBalances })
        : t('figures.supplierUnknown', 'Supplier invoice data is unavailable.'),
      exactValue: suppliers?.knownTotals.length ? currencyFigure(suppliers.knownTotals, orgCurrency, moneyReason)?.exactValue : undefined,
      subline: suppliers ? t('figures.supplierCount', '{{count}} supplier invoices awaiting payment', { count: suppliers.count }) : undefined,
      href: '/procurement?status=Vendor+Invoiced',
    },
    {
      id: 'still-to-invoice', label: t('figures.stillToInvoice', 'Still to invoice on work orders'),
      value: workOrders.data === undefined ? null : unbilledKnown ?? (workOrders.data.incompleteCount > 0 ? null : moneyFigure(0, orgCurrency, moneyReason).value),
      unavailableReason: t('figures.unbilledUnknown', 'Some work orders could not be totalled.'),
      exactValue: unbilledTotals?.length ? currencyFigure(unbilledTotals, orgCurrency, moneyReason)?.exactValue : undefined,
      subline: workOrders.data ? t('figures.workOrderCount', '{{count}} work orders', { count: unbilledCount + workOrders.data.incompleteCount }) : undefined,
      href: '/projects',
    },
  ], [billedMargin, billedMarginLabel, dashboard.data?.pipeline_projected_margin, margin, moneyReason, onHand, onHandValue, pipelineTotals, unbilledTotals, overdue, overdueKnown, pipelineGross, pipelineWeighted, remaining, spendPartial, supplierKnown, suppliers, t, unbilledCount, unbilledKnown, workOrders.data, orgCurrency]);

  const periodFigures = useMemo<DashboardFigure[]>(() => {
    const wonCount = winRate.data?.wins_count;
    const wonMoney = winCurrencyTotals.length ? currencyText(winCurrencyTotals, orgCurrency, moneyReason)
      : winRate.data?.wins_value === null || winRate.data?.wins_value === undefined ? null : moneyFigure(winRate.data.wins_value, orgCurrency, moneyReason).value;
    const rate = winRate.data?.win_rate_count;
    return [
      { id: 'invoiced', label: t('figures.invoiced', 'Invoiced · excl. tax'), value: invoiced === undefined ? null : (invoiceCurrencyTotals.length ? currencyText(invoiceCurrencyTotals, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value), lines: currencyLines(invoiceCurrencyTotals, orgCurrency, moneyReason), unavailableReason: t('figures.invoicedUnknown', 'Invoiced totals are unavailable for this period.'), href: '/sales-invoices' },
      { id: 'collected', label: t('figures.collected', 'Collected'), value: collected === undefined ? null : (() => {
        const unknownCurrencies = new Set(collected.unknownCurrencies);
        const known = collectedCurrencyTotals.filter((row) => !unknownCurrencies.has(row.currency));
        const displayRows = [
          ...known.map((row) => ({ ...row, amount: row.amount as number | null })),
          ...collected.unknownCurrencies.map((currency) => ({ currency, amount: null })),
        ];
        return displayRows.length ? currencyText(displayRows, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value;
      })(), lines: currencyLines(collectedCurrencyTotals.filter((row) => !(collected?.unknownCurrencies ?? []).includes(row.currency)), orgCurrency, moneyReason), unavailableReason: t('figures.collectedUnknown', 'Incoming payment totals are unavailable for this period.'), title: collected?.unknownCurrencies.length ? t('figures.collectedUnknown', 'Incoming payment totals are unavailable for this period.') : undefined, href: '/incoming-payments' },
      { id: 'won', label: t('figures.won', 'Won'), value: wonCount === undefined ? null : `${wonCount}${wonMoney ? ` · ${wonMoney}` : ''}`, unavailableReason: t('figures.wonUnknown', 'Won project results are unavailable for this period.'), href: '/projects?status=Won' },
      { id: 'win-rate', label: t('figures.winRate', 'Win rate'), value: rate === undefined || (winRate.data?.wins_count ?? 0) + (winRate.data?.losses_count ?? 0) === 0 ? null : `${(rate * 100).toFixed(1)}%`, unavailableReason: t('figures.winRateNoResults', 'No closed project results were recorded in this period.'), subline: rate === undefined ? undefined : t('figures.winRateBasis', 'By project count'), href: '/sales' },
    ];
  }, [collected, collectedCurrencyTotals, invoiced, invoiceCurrencyTotals, moneyReason, orgCurrency, t, winCurrencyTotals, winRate.data]);

  const periodPending = pack.isPending || payments.isPending || winRate.isPending;
  const periodError = pack.isError || payments.isError || winRate.isError;
  const dashboardStatusRows = dashboard.data?.projects_by_status ?? [];
  const procurementStatusRows = dashboard.data?.procurements_by_status ?? [];
  const hasWorkOrderEvidence = (workOrders.data?.totals ?? []).some((row) => row.count > 0) || (workOrders.data?.incompleteCount ?? 0) > 0;
  const isEmpty = Boolean(dashboard.data && !dashboardStatusRows.some((row) => row.count > 0) && !procurementStatusRows.some((row) => row.count > 0)
    && !invoices.data?.length && !procurements.data?.length && !payments.data?.length && !pipeline.data?.projects?.length && !hasWorkOrderEvidence
    && !pack.data?.totals.length);

  return {
    today, period: periodFigures,
    todayPending: dashboard.isPending || invoices.isPending || procurements.isPending || workOrders.isPending || orgDay.isPending,
    todayError: dashboard.isError || invoices.isError || procurements.isError || workOrders.isError || orgDay.isError,
    periodPending, periodError,
    todayRetry: () => { void dashboard.refetch(); void invoices.refetch(); void procurements.refetch(); void workOrders.refetch(); orgDay.retry(); },
    periodRetry: () => { void pack.refetch(); void payments.refetch(); void winRate.refetch(); },
    dashboard: dashboard.data,
    dashboardPending: dashboard.isPending,
    dashboardError: dashboard.isError,
    dashboardRetry: () => { void dashboard.refetch(); },
    pipeline: pipeline.data,
    pipelinePending: pipeline.isPending,
    pipelineError: pipeline.isError,
    pipelineRetry: () => { void pipeline.refetch(); },
    winRateRange,
    orgCurrency,
    currencyPending: currencyState.isResolved === false,
    organizationToday: orgDay.day,
    organizationDayPending: orgDay.isPending,
    isEmpty,
  };
}
