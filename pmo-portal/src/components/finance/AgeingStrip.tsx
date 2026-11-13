import React from 'react';
import { useTranslation } from 'react-i18next';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { formatCurrency } from '@/src/lib/format';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { cn } from '@/src/components/ui/cn';
import type { AgeingBuckets, PayablesAgeingBuckets } from '@/src/lib/finance/financePosition';

type AgeingKind = 'receivables' | 'payables';
type AgeingValues = Record<string, AgeingBuckets | PayablesAgeingBuckets>;
type BucketKey = keyof AgeingBuckets | keyof PayablesAgeingBuckets;

export interface AgeingStripProps {
  kind: AgeingKind;
  heading?: string;
  ariaLabel?: string;
  values: AgeingValues;
  /** L12: invoices whose balance is unknown, counted in their age bucket — never added as zero, never dropped. */
  unknownCounts?: Record<string, Partial<Record<BucketKey, number>>>;
  /** Known receivables with no derivable due date, counted separately from balances. */
  noDueDateCounts?: Record<string, number>;
  unknownTotal?: number;
  /** Use status-palette hues for payables age buckets on screens that pair this chart with status pills. */
  payablesStatusColors?: boolean;
}

const RECEIVABLE_BUCKETS = ['notDue', 'noDueDate', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
const PAYABLE_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'over90'] as const;

const BUCKET_COLORS: Record<BucketKey, string> = {
  notDue: chartTheme.series.neutral,
  noDueDate: chartTheme.series.neutral,
  d0_30: chartTheme.series.neutral,
  d1_30: chartTheme.series.primary,
  d31_60: 'hsl(var(--primary) / 0.72)',
  d61_90: 'hsl(var(--primary) / 0.48)',
  over90: chartTheme.series.destructive,
};

const PAYABLE_STATUS_COLORS: Record<BucketKey, string> = {
  ...BUCKET_COLORS,
  d31_60: 'hsl(var(--warning) / 0.72)',
  d61_90: 'hsl(var(--warning) / 0.48)',
};

/**
 * A distance along the age bar, as a percentage of the bar's width, at the four decimals the bar is
 * painted at. Neighbouring segments read the same edge from this one number, so their painted edges
 * coincide; a value rounded down on one side and up on the other is what leaves a sub-pixel gap at a
 * join or at the bar's end, showing the surface behind a 1px lighter sliver.
 */
const barPercent = (value: number) => Number(Math.max(value, 0).toFixed(4));

export const AgeingStrip: React.FC<AgeingStripProps> = ({ kind, heading, ariaLabel, values, unknownCounts = {}, noDueDateCounts = {}, unknownTotal = 0, payablesStatusColors = false }) => {
  const { t } = useTranslation();
  const { currency: orgCurrency, isResolved } = useOrgCurrencyState();
  const bucketKeys: readonly BucketKey[] = kind === 'receivables' ? RECEIVABLE_BUCKETS : PAYABLE_BUCKETS;
  const bucketColors = kind === 'payables' && payablesStatusColors ? PAYABLE_STATUS_COLORS : BUCKET_COLORS;
  const labels: Record<BucketKey, string> = {
    notDue: t('finance:area.notDue', 'Not yet due'),
    noDueDate: t('finance:area.noDueDate', 'No due date'),
    d0_30: t('finance:area.days0to30', '0–30 days'),
    d1_30: t('finance:area.days1to30', '1–30 days'),
    d31_60: t('finance:area.days31to60', '31–60 days'),
    d61_90: t('finance:area.days61to90', '61–90 days'),
    over90: t('finance:area.over90Days', 'Over 90 days'),
  };
  // The basis of each age ("tax included", "since the invoice was recorded") lives in the page's one help control.
  const title = heading ?? (kind === 'receivables'
    ? t('finance:area.receivablesAgeingTitle', 'Client balances by age')
    : t('finance:area.payablesAgeingBasis', 'Invoice age, by days'));
  const currencies = [...new Set([...Object.keys(values), ...Object.keys(unknownCounts), ...(kind === 'receivables' ? Object.keys(noDueDateCounts) : [])])].map((currency) => [currency, values[currency]] as const).sort(([left], [right]) => {
    if (isResolved && left === orgCurrency) return -1;
    if (isResolved && right === orgCurrency) return 1;
    return 0;
  });

  const amountFor = (buckets: AgeingBuckets | PayablesAgeingBuckets | undefined, key: BucketKey): number =>
    kind === 'receivables'
      ? (buckets as AgeingBuckets | undefined)?.[key as keyof AgeingBuckets] ?? 0
      : (buckets as PayablesAgeingBuckets | undefined)?.[key as keyof PayablesAgeingBuckets] ?? 0;

  return (
    <section aria-label={ariaLabel ?? title} className="mb-5 min-w-0">
      <h2 className="mb-2 text-[14px] font-semibold">{title}</h2>
      {currencies.length === 0 && <p className="text-sm text-muted-foreground">{unknownTotal > 0
        ? t('finance:area.ageingUnknown', { defaultValue: unknownTotal === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: unknownTotal })
        : t('finance:area.ageingEmpty', 'No balances to group by age')}</p>}
      {currencies.length > 0 && unknownTotal > 0 && <p className="mb-2 text-control text-muted-foreground">{t('finance:area.ageingUnknownCount', { defaultValue: unknownTotal === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: unknownTotal })}</p>}
      {currencies.map(([currency, buckets]) => {
        const amounts = bucketKeys.map((key) => amountFor(buckets, key));
        const total = amounts.reduce((sum, amount) => sum + Math.max(amount, 0), 0);
        const chartLabel = `${t('financeHub:hub.fix.ageingBarLabel', '{{currency}} balance distribution by age', { currency })}. ${bucketKeys.map((key, index) => `${labels[key]} ${formatCurrency((amounts[index] ?? 0) / 100, currency)}`).join(', ')}`;
        // One contiguous run of edges across the bar: segment i starts on edge i and ends on edge i+1,
        // so each width is derived from the edge it shares with its neighbour rather than from its own
        // rounded share — that is what keeps the joins seamless. The final edge is closed on exactly
        // 100 (with any rounding remainder absorbed there) so the paint finishes on the column's edge.
        const edges: number[] = [];
        let painted = 0;
        amounts.forEach((amount) => {
          painted += total > 0 ? (Math.max(amount, 0) / total) * 100 : 0;
          edges.push(barPercent(painted));
        });
        if (edges.length > 0) edges[edges.length - 1] = 100;
        const segments = bucketKeys.map((key, index) => {
          const start = index === 0 ? 0 : (edges[index - 1] ?? 0);
          return { key, start, width: barPercent((edges[index] ?? 0) - start), amount: amounts[index] ?? 0 };
        });
        return (
          <div key={currency} className="mb-4 min-w-0 last:mb-0">
            <div className="mb-1 text-control font-medium text-muted-foreground">{currency}</div>
            {total > 0 && <div
              role="img"
              aria-label={chartLabel}
              data-testid={`ageing-bar-${currency}`}
              data-scale-max={total}
              className="relative h-9 min-w-0 overflow-hidden rounded-md"
            >
              <div className="absolute inset-x-0 top-1/2 h-6 -translate-y-1/2">
                {segments.map(({ key, start, width, amount }) => <span
                  key={key}
                  data-testid={`ageing-segment-${currency}-${key}`}
                  data-bucket={key}
                  aria-hidden="true"
                  title={`${labels[key]} · ${formatCurrency(amount / 100, currency)}`}
                  className="absolute inset-y-0"
                  style={{
                    left: `${start}%`,
                    width: `${width}%`,
                    background: bucketColors[key],
                    // A hairline of the segment's own colour past its right edge: the next segment
                    // paints over it, so a browser that lands the two rounded edges a fraction apart
                    // still shows bar colour, never the surface behind. At the bar's end this closes
                    // the last pixel and is clipped by the bar's overflow.
                    boxShadow: `1px 0 0 ${bucketColors[key]}`,
                  }}
                />)}
              </div>
            </div>}
            <div data-testid={`ageing-legend-${currency}`} className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-x-3 gap-y-2">
              {bucketKeys.map((key, index) => {
                const amount = amounts[index] ?? 0;
                const unknown = unknownCounts[currency]?.[key] ?? 0;
                const noDueDateCount = kind === 'receivables' && key === 'noDueDate' ? noDueDateCounts[currency] ?? 0 : 0;
                const unknownLabel = t('financeHub:hub.fix.ageing.unknownCount', { defaultValue: unknown === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: unknown });
                return (
                  <div key={key} data-testid={`ageing-bucket-${currency}-${key}`} className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-x-2">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: bucketColors[key] }} />
                    <span className="min-w-0 break-words text-control text-muted-foreground">{labels[key]}</span>
                    {unknown > 0 && amount === 0
                      ? <span className="text-right text-control text-muted-foreground">{unknownLabel}</span>
                      : <span className={cn('max-w-full break-all text-right tabular text-sm', amount === 0 ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground')}>{formatCurrency(amount / 100, currency)}</span>}
                    {unknown > 0 && amount !== 0 && <span className="col-span-2 col-start-2 text-right text-control text-muted-foreground">{t('financeHub:hub.fix.ageing.plusUnknown', { defaultValue: '+ {{label}}', label: unknownLabel })}</span>}
                    {noDueDateCount > 0 && <span className="col-span-2 col-start-2 text-right text-control text-muted-foreground">{t('finance:area.ageingNoDueDateCount', { count: noDueDateCount, defaultValue_one: '{{count}} invoice', defaultValue_other: '{{count}} invoices' })}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
};
