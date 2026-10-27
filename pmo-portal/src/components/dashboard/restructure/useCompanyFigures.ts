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

export function selectCollectedTotals(payments: IncomingPaymentRow[] | undefined, from: string | null, to: string | null) {
  if (!payments || !from || !to) return undefined;
  const fromDate = `${from}-01`;
  const [year, month] = to.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  const toDate = `${to}-${String(last).padStart(2, '0')}`;
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'Paid' || !payment.date || payment.date < fromDate || payment.date > toDate) continue;
    if (payment.amount === null || !Number.isFinite(payment.amount)) continue;
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0) + payment.amount);
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }));
}

export function selectUnbilledTotals(totals: UnbilledWorkOrderTotal[] | undefined) {
  if (!totals) return undefined;
  return totals.map(({ currency, remaining }) => ({ currency, amount: remaining }));
}

const currencyText = (
  rows: Array<{ currency: string; amount: number }>,
  orgCurrency: string,
  unavailable: string,
): string => rows.map(({ currency, amount }) => moneyFigure(amount, currency, unavailable, { code: currency !== orgCurrency }).value).join(' · ');

function amountFromDashboard(rows: Array<{ currency: string; contract_value?: number | null; contract_remaining?: number | null; known_amount?: number | null; total_value?: number | null; weighted_value?: number | null }> | undefined,
  field: 'contract_value' | 'contract_remaining' | 'known_amount' | 'total_value' | 'weighted_value', orgCurrency: string, t: (key: string, fallback: string) => string): string | null {
  if (!rows || rows.length === 0) return null;
  const known = rows.filter((row) => row[field] !== null && row[field] !== undefined)
    .map((row) => ({ currency: row.currency, amount: row[field] as number }));
  return known.length ? currencyText(known, orgCurrency, t('figures.amountUnknown', 'Amount unavailable')) : null;
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
  const procurements = useProcurements();
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
  const collectedCurrencyTotals = useMemo(() => collected ?? [], [collected]);
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
  const remaining = amountFromDashboard(onHand, 'contract_remaining', orgCurrency, t)
    ?? (dashboard.data?.on_hand_contract_remaining === null || dashboard.data?.on_hand_contract_remaining === undefined
      ? null : moneyFigure(dashboard.data.on_hand_contract_remaining, orgCurrency, moneyReason).value);
  const billedMargin = amountFromDashboard(margin, 'known_amount', orgCurrency, t)
    ?? (dashboard.data?.on_hand_realized_margin === null || dashboard.data?.on_hand_realized_margin === undefined
      ? null : moneyFigure(dashboard.data.on_hand_realized_margin, orgCurrency, moneyReason).value);
  const today = useMemo<DashboardFigure[]>(() => [
    {
      id: 'contract-on-hand', label: t('figures.contractOnHand', 'Contract on hand'), value: onHandValue,
      unavailableReason: moneyReason,
      subline: remaining === null
        ? t('figures.leftAfterSpendingUnknown', 'Left after spending: —')
        : `${t('figures.leftAfterSpending', 'Left after spending')}: ${remaining}`,
      href: '/projects',
    },
    {
      id: 'billed-margin', label: t('figures.billedMargin', 'Margin on billed work'), value: billedMargin,
      unavailableReason: moneyReason, href: '/sales-invoices',
    },
    {
      id: 'pipeline', label: t('figures.pipeline', 'Pipeline (weighted)'), value: pipelineWeighted,
      unavailableReason: moneyReason,
      subline: pipelineGross === null ? t('figures.grossUnknown', 'Gross: —') : `${t('figures.gross', 'Gross')}: ${pipelineGross}`,
      href: '/sales',
    },
    {
      id: 'client-overdue', label: t('figures.owedByClients', 'Owed by clients · overdue'),
      value: overdue === undefined ? null : String(overdue.count), unavailableReason: t('figures.overdueUnknown', 'Overdue invoice data is unavailable.'),
      subline: [overdueKnown, overdue && overdue.unknownBalances > 0
        ? t('figures.unknownBalancesDays', '{{count}} balances unknown · up to {{days}} days overdue', { count: overdue.unknownBalances, days: overdue.oldestDays ?? '—' })
        : overdue?.count === 0 ? t('figures.noOverdue', 'No overdue client invoices') : null].filter(Boolean).join(' · '),
      href: '/sales-invoices?overdue=true',
    },
    {
      id: 'supplier-payables', label: t('figures.owedToSuppliers', 'Owed to suppliers'),
      value: suppliers === undefined ? null : supplierKnown ?? moneyFigure(0, orgCurrency, moneyReason).value,
      unavailableReason: t('figures.supplierUnknown', 'Supplier invoice data is unavailable.'),
      subline: suppliers ? t('figures.supplierCount', '{{count}} supplier invoices awaiting payment', { count: suppliers.count }) : undefined,
      href: '/procurement?status=Vendor+Invoiced',
    },
    {
      id: 'still-to-invoice', label: t('figures.stillToInvoice', 'Still to invoice on work orders'),
      value: workOrders.data === undefined ? null : unbilledKnown ?? (workOrders.data.incompleteCount > 0 ? null : moneyFigure(0, orgCurrency, moneyReason).value),
      unavailableReason: t('figures.unbilledUnknown', 'Some work orders could not be totalled.'),
      subline: workOrders.data ? t('figures.workOrderCount', '{{count}} work orders', { count: unbilledCount + workOrders.data.incompleteCount }) : undefined,
      href: '/projects',
    },
  ], [billedMargin, moneyReason, onHandValue, overdue, overdueKnown, pipelineGross, pipelineWeighted, remaining, supplierKnown, suppliers, t, unbilledCount, unbilledKnown, workOrders.data, orgCurrency]);

  const periodFigures = useMemo<DashboardFigure[]>(() => {
    const wonCount = winRate.data?.wins_count;
    const wonMoney = winCurrencyTotals.length ? currencyText(winCurrencyTotals, orgCurrency, moneyReason)
      : winRate.data?.wins_value === null || winRate.data?.wins_value === undefined ? null : moneyFigure(winRate.data.wins_value, orgCurrency, moneyReason).value;
    const rate = winRate.data?.win_rate_count;
    return [
      { id: 'invoiced', label: t('figures.invoiced', 'Invoiced · excl. tax'), value: invoiced === undefined ? null : (invoiceCurrencyTotals.length ? currencyText(invoiceCurrencyTotals, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value), unavailableReason: t('figures.invoicedUnknown', 'Invoiced totals are unavailable for this period.'), href: '/sales-invoices' },
      { id: 'collected', label: t('figures.collected', 'Collected'), value: collected === undefined ? null : (collectedCurrencyTotals.length ? currencyText(collectedCurrencyTotals, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value), unavailableReason: t('figures.collectedUnknown', 'Incoming payment totals are unavailable for this period.'), href: '/incoming-payments' },
      { id: 'won', label: t('figures.won', 'Won'), value: wonCount === undefined ? null : `${wonCount}${wonMoney ? ` · ${wonMoney}` : ''}`, unavailableReason: t('figures.wonUnknown', 'Won project results are unavailable for this period.'), subline: wonCount === undefined ? undefined : t('figures.wonCount', '{{count}} projects won', { count: wonCount }), href: '/projects?status=Won' },
      { id: 'win-rate', label: t('figures.winRate', 'Win rate'), value: rate === undefined || (winRate.data?.wins_count ?? 0) + (winRate.data?.losses_count ?? 0) === 0 ? null : `${(rate * 100).toFixed(1)}%`, unavailableReason: t('figures.winRateNoResults', 'No closed project results were recorded in this period.'), subline: rate === undefined ? undefined : t('figures.winRateBasis', 'By project count'), href: '/sales' },
    ];
  }, [collected, collectedCurrencyTotals, invoiced, invoiceCurrencyTotals, moneyReason, orgCurrency, t, winCurrencyTotals, winRate.data]);

  const periodPending = pack.isPending || payments.isPending || winRate.isPending;
  const periodError = pack.isError || payments.isError || winRate.isError;
  const dashboardStatusRows = dashboard.data?.projects_by_status ?? [];
  const procurementStatusRows = dashboard.data?.procurements_by_status ?? [];
  const isEmpty = Boolean(dashboard.data && !dashboardStatusRows.some((row) => row.count > 0) && !procurementStatusRows.some((row) => row.count > 0));

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
