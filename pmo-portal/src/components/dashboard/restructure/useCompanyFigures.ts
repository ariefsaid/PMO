import { parseExactCents, formatExactCents } from '@/src/lib/exactDecimal';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DashboardFigure } from './FigureGroup';
import type { DashboardPeriod } from './usePeriod';
import { periodDateRange } from './usePeriod';
import { useDashboard, useSalesPipeline, useWinRate } from '@/src/hooks/useDashboard';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { selectInvoicedTrend, trendWindow, type InvoicedTrend } from '@/src/lib/dashboardTrend';
import { useOverdueInvoiceFacts, usePaidPaymentFacts, useHasAnySalesInvoice, useHasAnyIncomingPayment } from '@/src/hooks/useRevenue';
import { useProcurements } from '@/src/hooks/useProcurements';
import { useUnbilledWorkOrders } from '@/src/hooks/useWorkOrderBilling';
import { useOrgCurrency, useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { formatDashboardPercent, moneyFigure } from '@/src/lib/dashboardMoney';
import { formatTileMoney } from '@/src/lib/format';
import type { ManagementPack } from '@/src/lib/reports/managementPack';
import {
  selectBilledWorkByMonth,
  selectBilledWorkInPeriod,
  selectLeftToBillTotals,
} from '@/src/lib/reports/managementPack';
import type { PaidPaymentFact } from '@/src/lib/db/revenue';
import type { UnbilledWorkOrderTotal } from '@/src/lib/db/workOrderBilling';
import { selectOverdueInvoices, selectSupplierInvoices } from './useNeedsYou';
import { withLinkedDocuments } from '@/src/lib/procurement/procurementMoney';
import { useErpPurchases } from '@/src/hooks/useErpPurchases';
import { orderByCurrency, tileMoneyLines } from './currencyOrder';
import { clientInvoiceOverdueDays } from '@/src/lib/repositories/revenueDisplay';
import type { OverdueInvoiceFact } from '@/src/lib/db/revenue';
import type { ProcurementWithRefs } from '@/src/lib/db/procurements';
import { supplierUnpaid } from '@/src/lib/procurement/procurementMoney';
import { calendarAgeDays, isProcurementReadyToPay, supplierInvoiceDate } from '@/src/lib/finance/financePosition';

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
  /** #1597: the headline invoiced figure's monthly line; null = nothing invoiced yet. */
  invoicedTrend: InvoicedTrend | null;
  /** Full completed-month window for the paired home trend, including known zero months before first invoicing. */
  trendInvoicedByMonth: Array<{ month: string; amount: number }> | undefined;
  trendPending: boolean;
  trendError: boolean;
  trendRetry: () => void;
  /** Recorded incoming payments per month ("YYYY-MM") in the organisation currency; undefined while unknown. */
  collectedByMonth: Map<string, number> | undefined;
  /** Invoiced (excl. tax) for every month of the selected period in the organisation currency; undefined while unknown. */
  invoicedByMonth: Array<{ month: string; amount: number }> | undefined;
  /** Each figure's own read: a tile waits on (and fails with) only the source it is made of, never its neighbours'. */
  figureStatus: (id: string) => FigureStatus;
  /** Open client invoices and supplier invoices split by due state, for the Finances block. */
  receivables: OwedSplit | undefined;
  payables: OwedSplit | undefined;
  receivablesPending: boolean;
  receivablesError: boolean;
  payablesPending: boolean;
  payablesError: boolean;
  /** Left to bill per signed-contract project at the latest pack month (org currency, known rows only), largest first. */
  leftToBillByProject: Array<{ id: string; name: string; amount: number }> | undefined;
  collectedPending: boolean;
}

export interface FigureStatus { pending: boolean; error: boolean; retry?: () => void }

/** What is owed one way: known balances split into not yet due and overdue, per currency; unknown balances counted, never summed. */
export interface OwedSplit {
  count: number;
  notDue: Array<{ currency: string; amount: number }>;
  overdue: Array<{ currency: string; amount: number }>;
  overdueCount: number;
  unknownBalances: number;
  oldestDays: number | null;
}

const addTo = (map: Map<string, number>, currency: string, amount: number) => map.set(currency, (map.get(currency) ?? 0) + amount);
const listOf = (map: Map<string, number>) => [...map].map(([currency, amount]) => ({ currency, amount }));

/** Client side: overdue is the one shared rule (#1457); the oldest age is the oldest overdue invoice's. */
export function splitReceivables(rows: OverdueInvoiceFact[] | undefined, organizationToday: string | null): OwedSplit | undefined {
  if (!rows || !organizationToday) return undefined;
  const notDue = new Map<string, number>();
  const overdue = new Map<string, number>();
  let unknownBalances = 0;
  let overdueCount = 0;
  let oldestDays: number | null = null;
  for (const invoice of rows) {
    const days = clientInvoiceOverdueDays(invoice, organizationToday);
    if (days !== null) { overdueCount += 1; oldestDays = Math.max(oldestDays ?? 0, days); }
    const amount = invoice.erp_outstanding_amount;
    if (amount === null || amount === undefined || !Number.isFinite(amount)) { unknownBalances += 1; continue; }
    addTo(days === null ? notDue : overdue, invoice.currency, amount);
  }
  return { count: rows.length, notDue: listOf(notDue), overdue: listOf(overdue), overdueCount, unknownBalances, oldestDays };
}

/** Supplier side: a supplier invoice is overdue past 90 days since it was recorded (the Payables page's rule). */
export const SUPPLIER_OVERDUE_DAYS = 90;
export function splitPayables(rows: ProcurementWithRefs[] | undefined, organizationToday: string | null): OwedSplit | undefined {
  if (!rows || !organizationToday) return undefined;
  const notDue = new Map<string, number>();
  const overdue = new Map<string, number>();
  let count = 0;
  let unknownBalances = 0;
  let overdueCount = 0;
  let oldestDays: number | null = null;
  for (const row of rows) {
    if (!isProcurementReadyToPay(row)) continue;
    count += 1;
    const age = calendarAgeDays(supplierInvoiceDate(row), organizationToday);
    if (age !== null) oldestDays = Math.max(oldestDays ?? 0, age);
    const late = age !== null && age > SUPPLIER_OVERDUE_DAYS;
    if (late) overdueCount += 1;
    const unpaid = supplierUnpaid(row);
    if (unpaid.unknown || unpaid.amount === null) { unknownBalances += 1; continue; }
    addTo(late ? overdue : notDue, row.currency, unpaid.amount);
  }
  return { count, notDue: listOf(notDue), overdue: listOf(overdue), overdueCount, unknownBalances, oldestDays };
}

/** Left to bill per contract project at the pack's latest month, in one currency; a row with an unknown contract or snapshot is left out. */
export function selectLeftToBillByProject(pack: ManagementPack | undefined, currency: string): Array<{ id: string; name: string; amount: number }> | undefined {
  if (!pack) return undefined;
  const month = pack.months[pack.months.length - 1];
  if (!month) return [];
  return pack.rows
    .filter((row) => row.kind === 'contract' && row.currency === currency && row.contractNet !== null)
    .flatMap((row) => {
      const snapshot = row.months.find((entry) => entry.month === month);
      if (!snapshot || snapshot.backlog === null) return [];
      const amount = ((row.contractNet as number) - snapshot.invoicedToDate) / 100;
      return amount > 0 ? [{ id: row.projectId ?? row.key, name: row.projectName ?? row.projectNumber ?? row.key, amount }] : [];
    })
    .sort((a, b) => b.amount - a.amount);
}

export interface CollectedTotals {
  totals: Array<{ currency: string; amount: string }>;
  unknownCurrencies: string[];
}

export function selectCollectedTotals(payments: PaidPaymentFact[] | undefined, from: string | null, to: string | null): CollectedTotals | undefined {
  if (!payments || !from || !to) return undefined;
  const fromDate = `${from}-01`;
  const [year, month] = to.split('-').map(Number);
  const last = new Date(year, month, 0).getDate();
  const toDate = `${to}-${String(last).padStart(2, '0')}`;
  const totals = new Map<string, bigint>();
  const unknownCurrencies = new Set<string>();
  for (const payment of payments) {
    if (payment.status !== 'Paid' || !payment.date || payment.date < fromDate || payment.date > toDate) continue;
    if (payment.amount === null || !Number.isFinite(payment.amount)) {
      unknownCurrencies.add(payment.currency);
      continue;
    }
    const cents = parseExactCents(String(payment.amount));
    if (cents === null) {
      unknownCurrencies.add(payment.currency);
      continue;
    }
    totals.set(payment.currency, (totals.get(payment.currency) ?? 0n) + cents);
  }
  return { totals: [...totals].map(([currency, amount]) => ({ currency, amount: formatExactCents(amount) })), unknownCurrencies: [...unknownCurrencies] };
}

/** Paid receipts per calendar month in one currency. One receipt with no amount makes the whole series unknown, never a partial sum. */
export function selectCollectedByMonth(payments: PaidPaymentFact[] | undefined, currency: string): Map<string, number> | undefined {
  if (!payments) return undefined;
  const months = new Map<string, number>();
  for (const payment of payments) {
    if (payment.status !== 'Paid' || !payment.date || payment.currency !== currency) continue;
    if (payment.amount === null || !Number.isFinite(payment.amount)) return undefined;
    const month = payment.date.slice(0, 7);
    months.set(month, (months.get(month) ?? 0) + Number(payment.amount));
  }
  return months;
}

export function selectUnbilledTotals(totals: UnbilledWorkOrderTotal[] | undefined) {
  if (!totals) return undefined;
  return totals.map(({ currency, remaining }) => ({ currency, amount: remaining }));
}

/** Known currencies as one short figure plus its exact twin; an unknown currency is named only in the
 *  exact text (hover / screen reader), never as a "CUR —" value. Null when no currency is known. */
export function currencyFigure(
  rows: Array<{ currency: string; amount: number | string | null }>,
  orgCurrency: string,
  unavailable: string,
  unknownLabel: (currency: string) => string = (currency) => `${currency} unknown`,
): { value: string; exactValue: string } | null {
  const ordered = orderByCurrency(rows, orgCurrency);
  const known = ordered.filter((row): row is { currency: string; amount: number | string } => row.amount !== null && Number.isFinite(Number(row.amount)));
  if (known.length === 0) return null;
  const figures = known.map(({ currency, amount }) => moneyFigure(amount, currency, unavailable, { code: currency !== orgCurrency }));
  const unknown = ordered.filter((row) => !known.includes(row as { currency: string; amount: number | string })).map((row) => unknownLabel(row.currency));
  return {
    value: figures.map((figure) => figure.value).join(' · '),
    exactValue: [...figures.map((figure) => figure.exactValue ?? figure.value), ...unknown].join(' · '),
  };
}

/** One short figure per known currency, in the shared currency order (the lines behind a joined `value`). */
const currencyLines = (
  rows: Array<{ currency: string; amount: number | string | null }>,
  orgCurrency: string,
  unavailable: string,
): string[] => orderByCurrency(rows.filter((row) => row.amount !== null && Number.isFinite(Number(row.amount))), orgCurrency)
  .map((row) => moneyFigure(row.amount as number | string, row.currency, unavailable, { code: row.currency !== orgCurrency }).value);

const currencyText = (
  rows: Array<{ currency: string; amount: number | string | null }>,
  orgCurrency: string,
  unavailable: string,
): string | null => currencyFigure(rows, orgCurrency, unavailable)?.value ?? null;

/** Per-currency amounts of a dashboard field; null when no currency has a known value. */
const knownAmounts = <Row extends { currency: string }>(rows: Row[] | undefined, field: keyof Row): Array<{ currency: string; amount: number }> | null => {
  const known = (rows ?? []).flatMap((row) => { const value = row[field]; return typeof value === 'number' && Number.isFinite(value) ? [{ currency: row.currency, amount: value }] : []; });
  return known.length ? known : null;
};

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
  const invoices = useOverdueInvoiceFacts();
  const payments = usePaidPaymentFacts();
  // Shared-details select: the supplier invoice and payment rows behind the unpaid balance.
  const procurements = useProcurements({ lean: true });
  const workOrders = useUnbilledWorkOrders();
  const dateRange = periodDateRange(period);
  const winRateRange = useMemo(() => ({ ...dateRange, key: `period:${period.from ?? ''}:${period.to ?? ''}` }), [dateRange, period.from, period.to]);
  const winRate = useWinRate(winRateRange);
  const pack = useManagementPack({
    from: period.from ? `${period.from}-01` : undefined,
    to: period.to ? `${period.to}-01` : undefined,
  });

  // Issue 1973: the narrow facts reads see only open invoices / Paid receipts, so the empty state
  // needs one existence probe each — an org with only closed records still has activity. Review perf
  // finding 1: the probes' answer only matters once the dashboard is loaded AND every other activity
  // signal has already resolved empty, so populated orgs never fetch them (each otherwise fires on
  // every dashboard load). Every signal below must be LOADED-and-empty, not merely undefined. A
  // disabled react-query probe stays isPending, so todayPending reads isLoading for them (below) or
  // the tiles would skeleton forever.
  const probesEnabled = Boolean(
    dashboard.data
    && !(dashboard.data.projects_by_status ?? []).some((row) => row.count > 0)
    && !(dashboard.data.procurements_by_status ?? []).some((row) => row.count > 0)
    && invoices.data?.length === 0
    && payments.data?.length === 0
    && procurements.data?.length === 0
    && pipeline.data?.projects?.length === 0
    && workOrders.data !== undefined && workOrders.data.incompleteCount === 0 && !workOrders.data.totals.some((row) => row.count > 0)
    && pack.data?.totals.length === 0,
  );
  const anyInvoice = useHasAnySalesInvoice(probesEnabled);
  const anyPayment = useHasAnyIncomingPayment(probesEnabled);

  const trendRange = trendWindow(orgDay.day);
  const trendPack = useManagementPack(trendRange, Boolean(trendRange.to));
  const invoicedTrend = useMemo(() => selectInvoicedTrend(trendPack.data, orgCurrency), [trendPack.data, orgCurrency]);
  const trendInvoicedByMonth = useMemo(() => selectBilledWorkByMonth(trendPack.data, trendRange.from ?? null, trendRange.to ?? null, orgCurrency), [trendPack.data, trendRange.from, trendRange.to, orgCurrency]);

  const overdue = useMemo(() => selectOverdueInvoices(invoices.data, orgDay.day), [invoices.data, orgDay.day]);
  // L12: the supplier total reads linked accounting documents, the same amount as Payables and the record.
  const linkedDocuments = useErpPurchases();
  const linkedProcurements = useMemo(() => withLinkedDocuments(procurements.data, linkedDocuments.data), [procurements.data, linkedDocuments.data]);
  const suppliers = useMemo(() => selectSupplierInvoices(linkedProcurements), [linkedProcurements]);
  const receivables = useMemo(() => splitReceivables(invoices.data, orgDay.day), [invoices.data, orgDay.day]);
  const payables = useMemo(() => splitPayables(linkedProcurements, orgDay.day), [linkedProcurements, orgDay.day]);
  const leftToBillByProject = useMemo(() => selectLeftToBillByProject(pack.data, orgCurrency), [pack.data, orgCurrency]);
  const invoiced = useMemo(() => selectBilledWorkInPeriod(pack.data, period.from, period.to), [pack.data, period.from, period.to]);
  const collected = useMemo(() => selectCollectedTotals(payments.data, period.from, period.to), [payments.data, period.from, period.to]);
  const invoicedByMonth = useMemo(() => selectBilledWorkByMonth(pack.data, period.from, period.to, orgCurrency), [pack.data, period.from, period.to, orgCurrency]);
  const collectedByMonth = useMemo(() => selectCollectedByMonth(payments.data, orgCurrency), [payments.data, orgCurrency]);
  const leftToBillTotals = useMemo(() => selectLeftToBillTotals(pack.data, orgCurrency), [pack.data, orgCurrency]);
  const leftToBillKnown = leftToBillTotals?.some((row) => row.amount === null)
    ? null
    : leftToBillTotals?.map((row) => ({ currency: row.currency, amount: row.amount as number })) ?? null;
  const moneyReason = t('figures.moneyUnknownReason', 'The accounting source did not provide a comparable amount.');
  // Owed by clients: every open invoice's balance; one unknown balance makes the total unknowable (never a partial sum).
  const owed = useMemo(() => {
    if (!invoices.data) return undefined;
    const totals = new Map<string, number>();
    let unknown = 0;
    for (const invoice of invoices.data) {
      const amount = invoice.erp_outstanding_amount;
      if (amount === null || amount === undefined || !Number.isFinite(amount)) unknown += 1;
      else totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + amount);
    }
    return { totals: [...totals].map(([currency, amount]) => ({ currency, amount })), unknown };
  }, [invoices.data]);
  const overdueKnown = overdue?.knownTotals.length ? currencyText(overdue.knownTotals, orgCurrency, moneyReason) : null;
  const supplierKnown = suppliers?.knownTotals.length ? currencyText(suppliers.knownTotals, orgCurrency, moneyReason) : null;
  const invoiceCurrencyTotals = useMemo(() => invoiced ?? [], [invoiced]);
  const collectedCurrencyTotals = useMemo(() => collected?.totals ?? [], [collected]);
  const invoicedAmounts = useMemo(() => invoiced === undefined ? null : invoiceCurrencyTotals.length > 0
    ? invoiceCurrencyTotals
    : [{ currency: orgCurrency, amount: 0 }], [invoiced, invoiceCurrencyTotals, orgCurrency]);
  const winCurrencyTotals = (winRate.data?.value_by_currency ?? [])
    .filter((row) => row.wins_value !== null && row.wins_value > 0)
    .map((row) => ({ currency: row.currency, amount: row.wins_value }));
  const onHand = dashboard.data?.on_hand_value_by_currency;
  const margin = dashboard.data?.on_hand_realized_margin_by_currency;
  const pipelineTotals = dashboard.data?.pipeline_total_value_by_currency;
  const pipelineWeighted = amountFromDashboard(pipelineTotals, 'weighted_value', orgCurrency, t);
  const pipelineGross = amountFromDashboard(pipelineTotals, 'total_value', orgCurrency, t);
  const onHandValue = amountFromDashboard(onHand, 'contract_value', orgCurrency, t)
    ?? (dashboard.data?.on_hand_value === null || dashboard.data?.on_hand_value === undefined
      ? null : moneyFigure(dashboard.data.on_hand_value, orgCurrency, moneyReason).value);
  const spendData = dashboard.data;
  const ongoingProjects = spendData?.active_projects;
  const ongoingProjectsLabel = ongoingProjects === undefined || ongoingProjects === null
    ? null
    : t('dashboard:executive.ongoingProjectsCount', '{{count}} Ongoing projects', { count: ongoingProjects });
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
  const billedMarginSubline = (margin ?? [])
    .flatMap((row) => {
      const percent = formatDashboardPercent(row.known_amount, row.known_billed_revenue ?? null);
      if (percent === null) return [];
      const amount = margin?.length === 1 ? percent : `${row.currency} ${percent}`;
      return [t('dashboard:executive.knownMarginPercentage', '{{percent}} of billed revenue for projects with known margin', { percent: amount })];
    })
    .join(' · ');
  const today = useMemo<DashboardFigure[]>(() => [
    {
      id: 'contract-on-hand', label: t('figures.contractOnHand', 'Contract on hand'), value: onHandValue,
      unavailableReason: moneyReason,
      amounts: knownAmounts(onHand, 'contract_value') ?? (dashboard.data?.on_hand_value == null ? null : [{ currency: orgCurrency, amount: dashboard.data.on_hand_value }]),
      exactValue: exactFromDashboard(onHand, 'contract_value', orgCurrency, t)?.exactValue,
      // Some delivery projects or cost categories have no ledger actuals yet: the remainder is overstated.
      subline: [ongoingProjectsLabel, remaining === null ? null : spendPartial
        ? `${t('figures.leftAfterRecordedSpending', 'Left after recorded spending')} (${t('figures.partial', 'Partial')}): ${remaining}`
        : `${t('figures.leftAfterSpending', 'Left after spending')}: ${remaining}`].filter(Boolean).join(' · ') || undefined,
      // AC-IXD-DASH-W5-C2A: the list it opens holds exactly the projects the figure sums (#1461:
      // `on-hand` is the on-hand status set the contract sum reads — including Close Out).
      href: '/projects?filter=on-hand',
    },
    {
      id: 'billed-margin', label: billedMarginLabel, value: billedMargin,
      unavailableReason: moneyReason,
      amounts: knownAmounts(margin, 'known_amount') ?? (dashboard.data?.on_hand_realized_margin == null ? null : [{ currency: orgCurrency, amount: dashboard.data.on_hand_realized_margin }]),
      exactValue: exactFromDashboard(margin, 'known_amount', orgCurrency, t)?.exactValue,
      subline: billedMarginSubline || undefined,
      // #1461: margin sums the on-hand projects, so the drill opens exactly that set.
      href: '/projects?filter=on-hand',
    },
    {
      id: 'pipeline', label: t('figures.pipeline', 'Pipeline (weighted)'), value: pipelineWeighted,
      unavailableReason: moneyReason,
      amounts: knownAmounts(pipelineTotals, 'weighted_value'),
      exactValue: exactFromDashboard(pipelineTotals, 'weighted_value', orgCurrency, t)?.exactValue,
      subline: [pipelineGross === null ? null : `${t('figures.gross', 'Gross')}: ${pipelineGross}`, dashboard.data?.pipeline_projected_margin == null
        ? null
        : `${t('dashboard:hub.company.forecastMargin', 'Forecast margin')}: ${(dashboard.data.pipeline_projected_margin * 100).toFixed(1)}%`].filter(Boolean).join(' · ') || undefined,
      href: '/sales',
    },
    {
      id: 'owed-clients', label: t('home.owedByClients', 'Owed by clients'), value: owed === undefined || owed.unknown > 0 ? null : '',
      // The read holds open invoices only, so none open is a KNOWN zero (the shared formatter stopped inventing one):
      // pass it explicitly, as the Receivables page does for `receivablesCount === 0`, or the tile vanishes and the
      // page reports it hidden for balances that are in fact all synced.
      amounts: owed === undefined || owed.unknown > 0 ? null : owed.totals.length ? owed.totals : [{ currency: orgCurrency, amount: 0 }],
      unavailableReason: t('home.reasonClientBalances', 'some client invoice balances are not synced'),
      // The one caption: what part of it is overdue (only when every overdue balance is known).
      subline: overdue && overdue.count > 0 && overdue.unknownBalances === 0 && overdue.knownTotals.length
        ? overdue.knownTotals.length === 1
          ? t('home.overdueAmount', '{{amount}} overdue', { amount: tileMoneyLines(overdue.knownTotals, orgCurrency, formatTileMoney)[0] })
          : t('hub.company.attentionOverdue', { count: overdue.count, defaultValue: '{{count}} overdue' })
        : undefined,
      href: '/finance/receivables',
    },
    {
      id: 'client-overdue', label: t('figures.owedByClients', 'Owed by clients · overdue'),
      value: overdue === undefined ? null : String(overdue.count), unavailableReason: t('figures.overdueUnknown', 'Overdue invoice data is unavailable.'),
      subline: [overdueKnown, overdue?.count
        && overdue.oldestDays != null ? t('dashboard:hub.company.oldestOverdue', 'Oldest {{days}} days overdue', { days: overdue.oldestDays })
        : overdue?.count === 0 ? t('figures.noOverdue', 'No overdue client invoices') : null].filter(Boolean).join(' · ') || undefined,
      href: '/finance/receivables?overdue=true',
    },
    {
      id: 'supplier-payables', label: t('figures.owedToSuppliers', 'Owed to suppliers'),
      value: suppliers === undefined ? null : suppliers.count === 0 ? moneyFigure(0, orgCurrency, moneyReason).value : supplierKnown,
      unavailableReason: suppliers?.unknownBalances
        ? t('dashboard:hub.company.supplierBalancesUnknown', '{{count}} supplier invoice balances are unknown.', { count: suppliers.unknownBalances })
        : t('figures.supplierUnknown', 'Supplier invoice data is unavailable.'),
      amounts: suppliers === undefined || suppliers.unknownBalances > 0 ? null : suppliers.knownTotals,
      exactValue: suppliers?.knownTotals.length ? currencyFigure(suppliers.knownTotals, orgCurrency, moneyReason)?.exactValue : undefined,
      subline: suppliers ? t('figures.supplierCount', '{{count}} supplier invoices awaiting payment', { count: suppliers.count }) : undefined,
      href: '/procurement?status=Vendor+Invoiced',
    },
    {
      id: 'left-to-bill', label: t('figures.leftToBill', 'Left to bill'),
      value: leftToBillTotals === undefined ? null : leftToBillKnown ? currencyText(leftToBillKnown, orgCurrency, moneyReason) : null,
      unavailableReason: t('figures.leftToBillUnknown', 'A contract invoice needs reconciliation before this amount can be known.'),
      amounts: leftToBillKnown,
      exactValue: leftToBillKnown?.length ? currencyFigure(leftToBillKnown, orgCurrency, moneyReason)?.exactValue : undefined,
      href: '/finance/reports',
    },
  ], [dashboard.data?.on_hand_realized_margin, dashboard.data?.on_hand_value, owed, billedMargin, billedMarginLabel, billedMarginSubline, dashboard.data?.pipeline_projected_margin, margin, moneyReason, onHand, onHandValue, ongoingProjectsLabel, pipelineTotals, leftToBillTotals, leftToBillKnown, overdue, overdueKnown, pipelineGross, pipelineWeighted, remaining, spendPartial, supplierKnown, suppliers, t, orgCurrency]);

  const periodFigures = useMemo<DashboardFigure[]>(() => {
    const wonCount = winRate.data?.wins_count;
    const wonMoney = winCurrencyTotals.length ? currencyText(winCurrencyTotals, orgCurrency, moneyReason)
      : winRate.data?.wins_value === null || winRate.data?.wins_value === undefined ? null : moneyFigure(winRate.data.wins_value, orgCurrency, moneyReason).value;
    const rate = winRate.data?.win_rate_count;
    // #1461: a period figure's drill carries its own window, so the list it opens can show
    // exactly the records the figure counts. Null while the period is still resolving.
    const windowQuery = period.from && period.to ? `from=${period.from}&to=${period.to}` : null;
    return [
      { id: 'invoiced', label: t('figures.invoiced', 'Invoiced · excl. tax'), value: invoiced === undefined ? null : (invoiceCurrencyTotals.length ? currencyText(invoiceCurrencyTotals, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value), lines: currencyLines(invoiceCurrencyTotals, orgCurrency, moneyReason), amounts: invoicedAmounts, unavailableReason: t('figures.invoicedUnknown', 'Invoiced totals are unavailable for this period.'), href: windowQuery ? `/finance/receivables?${windowQuery}` : undefined },
      { id: 'collected', label: t('figures.collected', 'Collected'), value: collected === undefined ? null : (() => {
        const unknownCurrencies = new Set(collected.unknownCurrencies);
        const known = collectedCurrencyTotals.filter((row) => !unknownCurrencies.has(row.currency));
        const displayRows = [
          ...known.map((row) => ({ ...row, amount: row.amount as string | null })),
          ...collected.unknownCurrencies.map((currency) => ({ currency, amount: null })),
        ];
        return displayRows.length ? currencyText(displayRows, orgCurrency, moneyReason) : moneyFigure(0, orgCurrency, moneyReason).value;
      })(), lines: currencyLines(collectedCurrencyTotals.filter((row) => !(collected?.unknownCurrencies ?? []).includes(row.currency)), orgCurrency, moneyReason), amounts: collected === undefined || collected.unknownCurrencies.length > 0 ? null : collectedCurrencyTotals.length ? collectedCurrencyTotals.map((row) => ({ currency: row.currency, amount: Number(row.amount) })) : [{ currency: orgCurrency, amount: 0 }], unavailableReason: t('figures.collectedUnknown', 'Incoming payment totals are unavailable for this period.'), title: collected?.unknownCurrencies.length ? t('figures.collectedUnknown', 'Incoming payment totals are unavailable for this period.') : undefined, href: windowQuery ? `/finance/receivables?view=payments&status=Paid&${windowQuery}` : undefined },
      { id: 'won', label: t('figures.won', 'Won'), count: wonCount, amounts: wonCount === undefined ? null : winCurrencyTotals.map((row) => ({ currency: row.currency, amount: row.amount as number })), value: wonCount === undefined ? null : `${wonCount}${wonMoney ? ` · ${wonMoney}` : ''}`, unavailableReason: t('figures.wonUnknown', 'Won project results are unavailable for this period.'), href: windowQuery ? `/projects?filter=won&${windowQuery}` : undefined },
      { id: 'win-rate', label: t('figures.winRate', 'Win rate'), value: rate === undefined || (winRate.data?.wins_count ?? 0) + (winRate.data?.losses_count ?? 0) === 0 ? null : `${(rate * 100).toFixed(1)}%`, unavailableReason: t('figures.winRateNoResults', 'No closed project results were recorded in this period.'), subline: rate === undefined ? undefined : t('figures.winRateBasis', 'By project count'), href: windowQuery ? `/projects?filter=decided&${windowQuery}` : undefined },
    ];
  }, [collected, collectedCurrencyTotals, invoiced, invoicedAmounts, invoiceCurrencyTotals, moneyReason, orgCurrency, period.from, period.to, t, winCurrencyTotals, winRate.data]);

  const periodPending = pack.isPending || payments.isPending || winRate.isPending;
  const periodError = pack.isError || payments.isError || winRate.isError;
  const dashboardStatusRows = dashboard.data?.projects_by_status ?? [];
  const procurementStatusRows = dashboard.data?.procurements_by_status ?? [];
  const hasWorkOrderEvidence = (workOrders.data?.totals ?? []).some((row) => row.count > 0) || (workOrders.data?.incompleteCount ?? 0) > 0;
  const isEmpty = Boolean(dashboard.data && !dashboardStatusRows.some((row) => row.count > 0) && !procurementStatusRows.some((row) => row.count > 0)
    && !invoices.data?.length && !procurements.data?.length && !payments.data?.length && !pipeline.data?.projects?.length && !hasWorkOrderEvidence
    && !pack.data?.totals.length && anyInvoice.data === false && anyPayment.data === false);

  // A1–A5 (loading gates): each figure is drawn from its own source, so it waits on and fails with that read only.
  const source: Record<string, FigureStatus> = {
    dashboard: { pending: dashboard.isPending, error: dashboard.isError, retry: () => { void dashboard.refetch(); } },
    invoices: { pending: invoices.isPending || orgDay.isPending, error: invoices.isError || orgDay.isError, retry: () => { void invoices.refetch(); orgDay.retry(); } },
    procurements: { pending: procurements.isPending, error: procurements.isError, retry: () => { void procurements.refetch(); } },
    pack: { pending: pack.isPending, error: pack.isError, retry: () => { void pack.refetch(); } },
    payments: { pending: payments.isPending, error: payments.isError, retry: () => { void payments.refetch(); } },
    winRate: { pending: winRate.isPending, error: winRate.isError, retry: () => { void winRate.refetch(); } },
  };
  const FIGURE_SOURCE: Record<string, string> = {
    'contract-on-hand': 'dashboard', 'billed-margin': 'dashboard', pipeline: 'dashboard',
    'owed-clients': 'invoices', 'client-overdue': 'invoices', 'supplier-payables': 'procurements',
    'left-to-bill': 'pack', invoiced: 'pack', collected: 'payments', won: 'winRate', 'win-rate': 'winRate',
  };
  const figureStatus = (id: string): FigureStatus => source[FIGURE_SOURCE[id]] ?? { pending: false, error: false };

  return {
    figureStatus,
    receivables,
    payables,
    receivablesPending: source.invoices.pending,
    receivablesError: source.invoices.error,
    payablesPending: procurements.isPending || orgDay.isPending,
    payablesError: procurements.isError || orgDay.isError,
    leftToBillByProject,
    collectedPending: payments.isPending,
    today, period: periodFigures,
    todayPending: dashboard.isPending || invoices.isPending || procurements.isPending || workOrders.isPending || pack.isPending || orgDay.isPending || anyInvoice.isLoading || anyPayment.isLoading,
    todayError: dashboard.isError || invoices.isError || procurements.isError || workOrders.isError || pack.isError || orgDay.isError,
    periodPending, periodError,
    todayRetry: () => { void dashboard.refetch(); void invoices.refetch(); void procurements.refetch(); void workOrders.refetch(); void anyInvoice.refetch(); void anyPayment.refetch(); orgDay.retry(); },
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
    invoicedTrend,
    trendInvoicedByMonth,
    // Pending from the first paint: until the org day resolves there is no window to fetch, and a card that appears later shoves the page down.
    trendPending: trendRange.to ? trendPack.isPending : Boolean(orgDay.isPending),
    trendError: trendPack.isError,
    trendRetry: () => { void trendPack.refetch(); },
    collectedByMonth,
    invoicedByMonth,
  };
}
