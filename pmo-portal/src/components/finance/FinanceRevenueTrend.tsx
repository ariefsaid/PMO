import React from 'react';
import { useTranslation } from 'react-i18next';
import { ChartCard } from '@/src/components/dashboard/charts';
import { RevenueTrendLineChart } from '@/src/components/dashboard/RevenueTrendLineChart';
import { usePaidPaymentFacts } from '@/src/hooks/useRevenue';
import { useManagementPack } from '@/src/hooks/useManagementPack';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { selectCollectedByMonth, selectInvoicedByMonth } from '@/src/components/dashboard/restructure/useCompanyFigures';
import { addMonths, monthsBetween } from '@/src/lib/reports/months';
import { formatMonthShort, formatTileMoney } from '@/src/lib/format';

const FinanceRevenueTrend: React.FC<{ today: string | null; enabled: boolean }> = ({ today, enabled }) => {
  const { t } = useTranslation('dashboard');
  const currencyState = useOrgCurrencyState();
  const to = addMonths(`${(today ?? new Date().toISOString()).slice(0, 7)}-01`, -1);
  const from = addMonths(to, -5);
  const ready = enabled && Boolean(today) && currencyState.isResolved;
  const pack = useManagementPack({ from, to }, ready);
  const payments = usePaidPaymentFacts(ready);
  const invoicesByMonth = selectInvoicedByMonth(pack.data, from, to, currencyState.currency);
  const collectedByMonth = selectCollectedByMonth(payments.data, currencyState.currency);
  const hasInvoices = invoicesByMonth !== undefined;
  const hasCollections = collectedByMonth !== undefined;
  const collectionsPrimary = !hasInvoices && hasCollections;
  const months = monthsBetween(from, to);
  const invoiceValues = new Map((invoicesByMonth ?? []).map((point) => [point.month, point.amount]));
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
      ...(hasInvoices && hasCollections && !collectionsPrimary ? {
        b: collected ?? 0,
        labelB: formatTileMoney(collected ?? 0, currencyState.currency) ?? undefined,
      } : {}),
    };
  });
  const title = t('home.financeRevenueTrend', 'Invoiced and collected · 6 months');
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

  if (!enabled) return null;
  return (
    <ChartCard
      title={title}
      known={canDraw}
      hiddenReason={hasNonZero
        ? t('home.reasonTrend', 'fewer than three months have invoiced or collected amounts')
        : t('home.reasonTrendNoActivity', 'no invoice or collection amounts are recorded in these months')}
      pending={!today || !currencyState.isResolved || pack.isPending || payments.isPending}
      error={!canDraw && (pack.isError || payments.isError) ? { title: t('trend.error', "Couldn't load the invoiced trend"), retry: () => { void pack.refetch(); void payments.refetch(); } } : undefined}
      testId="finance-revenue-trend"
    >
      <RevenueTrendLineChart
        points={points}
        ariaLabel={collectionsPrimary ? `${title} · ${t('home.chartCollected', 'Collected')}` : title}
        seriesNames={collectionsPrimary
          ? [t('home.chartCollected', 'Collected')]
          : [t('home.chartInvoiced', 'Invoiced, excl. tax'), t('home.chartCollected', 'Collected')]}
      />
      {gap && <p data-testid="finance-revenue-trend-gap" className="mt-2 text-control text-muted-foreground">{gap}</p>}
    </ChartCard>
  );
};

export default FinanceRevenueTrend;
