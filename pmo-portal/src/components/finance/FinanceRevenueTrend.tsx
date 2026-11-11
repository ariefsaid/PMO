import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChartCard, MonthColumns, SeriesKey } from '@/src/components/dashboard/charts';
import { useMonthlyInvoiceFacts, usePaidPaymentFacts } from '@/src/hooks/useRevenue';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { selectCollectedByMonth } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { addMonths, monthsBetween } from '@/src/lib/reports/months';
import { formatMonthShort, formatTileMoney } from '@/src/lib/format';

const FinanceRevenueTrend: React.FC<{ today: string | null; enabled: boolean }> = ({ today, enabled }) => {
  const { t } = useTranslation('dashboard');
  const currencyState = useOrgCurrencyState();
  const to = addMonths(`${(today ?? new Date().toISOString()).slice(0, 7)}-01`, -1);
  const from = addMonths(to, -5);
  const invoices = useMonthlyInvoiceFacts(from, addMonths(to, 1), enabled && Boolean(today));
  const payments = usePaidPaymentFacts(enabled && Boolean(today));
  const invoiceValues = new Map<string, number>();
  for (const invoice of invoices.data ?? []) {
    if (invoice.currency !== currencyState.currency || invoice.net == null) continue;
    const month = invoice.invoice_date.slice(0, 7);
    invoiceValues.set(month, (invoiceValues.get(month) ?? 0) + Number(invoice.net) + Number(invoice.recovery ?? 0));
  }
  const invoicesByMonth = invoices.data === undefined ? undefined : invoiceValues;
  const collectedByMonth = selectCollectedByMonth(payments.data, currencyState.currency);
  const hasInvoices = invoicesByMonth !== undefined;
  const hasCollections = collectedByMonth !== undefined;
  const collectionsPrimary = !hasInvoices && hasCollections;
  const hasPair = hasInvoices && hasCollections && !collectionsPrimary;
  const months = monthsBetween(from, to);
  const points = months.map((month) => {
    const monthKey = month.slice(0, 7);
    const collected = hasCollections ? collectedByMonth?.get(monthKey) ?? 0 : undefined;
    const invoiced = hasInvoices ? invoiceValues.get(monthKey) ?? 0 : undefined;
    const date = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1);
    const primary = collectionsPrimary ? collected : invoiced;
    return {
      key: month,
      tick: formatMonthShort(date),
      a: primary ?? 0,
      labelA: primary === undefined ? undefined : formatTileMoney(primary, currencyState.currency) ?? undefined,
      ...(hasPair ? {
        b: collected ?? 0,
        labelB: formatTileMoney(collected ?? 0, currencyState.currency) ?? undefined,
      } : {}),
    };
  });
  const title = t('home.financeRevenueTrend', 'Invoiced and collected · 6 months');
  const invoicedLabel = t('home.invoiced', 'Invoiced');
  const collectedLabel = t('home.collected', 'Collected');
  const collectionGap = !hasCollections && !payments.isPending
    ? t('home.collectedTrendGap', 'Collected is incomplete; invoiced amounts are shown.')
    : null;
  const invoiceGap = !hasInvoices && hasCollections
    ? t('home.invoicedTrendGap', 'Invoiced is incomplete; collected amounts are shown.')
    : null;
  const hasSeries = hasInvoices || hasCollections;
  const hasNonZero = points.some((point) => point.a !== 0 || (point.b !== undefined && point.b !== 0));
  const canDraw = hasSeries && hasNonZero && points.length >= 3;
  const gap = [invoiceGap, collectionGap].filter(Boolean).join(' ');
  const pending = !today || !currencyState.isResolved || invoices.isPending || payments.isPending;

  if (!enabled) return null;
  return (
    <ChartCard
      title={title}
      known={canDraw}
      hiddenReason={!hasSeries
        ? t('home.reasonTrendUnavailable', "Monthly series aren't available yet")
        : hasNonZero
          ? t('home.reasonTrend', 'fewer than three months have invoiced or collected amounts')
          : t('home.reasonTrendNoActivity', 'no invoice or collection amounts are recorded in these months')}
      pending={pending}
      testId="finance-revenue-trend"
    >
      <MonthColumns
        points={points}
        ariaLabel={collectionsPrimary ? `${title} · ${collectedLabel}` : title}
        seriesNames={collectionsPrimary
          ? [collectedLabel]
          : [t('home.chartInvoiced', 'Invoiced, excl. tax'), collectedLabel]}
        labelAll
        minWidth={660}
      />
      {!hasPair && <SeriesKey items={collectionsPrimary
        ? [{ label: collectedLabel, tone: 'accent' }]
        : [{ label: invoicedLabel, tone: 'accent' }]} />}
      {gap && <p data-testid="finance-revenue-trend-gap" className="mt-2 text-control text-muted-foreground">{gap}</p>}
    </ChartCard>
  );
};

export default FinanceRevenueTrend;
