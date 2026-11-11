import React from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { tooltipContentStyle, tooltipCursorFill, tooltipLabelStyle } from '@/src/components/dashboard/chartChrome';
import { formatCurrency } from '@/src/lib/format';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
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
  unknownTotal?: number;
  /** Shared per-currency extent so receivables and payables bars use the same scale. */
  scaleMaxByCurrency?: Record<string, number>;
}

const RECEIVABLE_BUCKETS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
const PAYABLE_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'over90'] as const;

const BUCKET_COLORS: Record<BucketKey, string> = {
  notDue: chartTheme.series.neutral,
  d0_30: chartTheme.series.neutral,
  d1_30: chartTheme.series.primary,
  d31_60: 'hsl(var(--primary) / 0.72)',
  d61_90: 'hsl(var(--primary) / 0.48)',
  over90: chartTheme.series.destructive,
};

export const AgeingStrip: React.FC<AgeingStripProps> = ({ kind, heading, ariaLabel, values, unknownCounts = {}, unknownTotal = 0, scaleMaxByCurrency }) => {
  const { t } = useTranslation();
  const { currency: orgCurrency, isResolved } = useOrgCurrencyState();
  const bucketKeys: readonly BucketKey[] = kind === 'receivables' ? RECEIVABLE_BUCKETS : PAYABLE_BUCKETS;
  const labels: Record<BucketKey, string> = {
    notDue: t('finance:area.notDue', 'Not yet due'),
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
  const currencies = [...new Set([...Object.keys(values), ...Object.keys(unknownCounts)])].map((currency) => [currency, values[currency]] as const).sort(([left], [right]) => {
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
        ? t('finance:area.ageingUnknown', { defaultValue: unknownTotal === 1 ? '{{count}} invoice has no balance reported by the accounting system' : '{{count}} invoices have no balance reported by the accounting system', count: unknownTotal })
        : t('finance:area.ageingEmpty', 'No balances to group by age')}</p>}
      {currencies.length > 0 && unknownTotal > 0 && <p className="mb-2 text-control text-muted-foreground">{t('finance:area.ageingUnknownCount', { defaultValue: unknownTotal === 1 ? '{{count}} invoice has no balance reported by the accounting system' : '{{count}} invoices have no balance reported by the accounting system', count: unknownTotal })}</p>}
      {currencies.map(([currency, buckets]) => {
        const amounts = bucketKeys.map((key) => amountFor(buckets, key));
        const total = amounts.reduce((sum, amount) => sum + Math.max(amount, 0), 0);
        const scaleMax = scaleMaxByCurrency?.[currency];
        const chartData = { name: currency, ...Object.fromEntries(bucketKeys.map((key, index) => [key, Math.max(amounts[index] ?? 0, 0)])) };
        const chartLabel = `${t('financeHub:hub.fix.ageingBarLabel', '{{currency}} balance distribution by age', { currency })}. ${bucketKeys.map((key, index) => `${labels[key]} ${formatCurrency((amounts[index] ?? 0) / 100, currency)}`).join(', ')}`;
        return (
          <div key={currency} className="mb-4 min-w-0 last:mb-0">
            <div className="mb-1 text-control font-medium text-muted-foreground">{currency}</div>
            {total > 0 && <div
              role="img"
              aria-label={chartLabel}
              data-testid={`ageing-bar-${currency}`}
              className="h-9 min-w-0 overflow-hidden rounded-md"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[chartData]} layout="vertical" margin={{ top: 3, right: 0, bottom: 3, left: 0 }} barSize={24}>
                  <XAxis type="number" hide domain={[0, scaleMax && scaleMax > 0 ? scaleMax : 'dataMax']} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip cursor={tooltipCursorFill} contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} formatter={(value, key) => [formatCurrency(Number(value) / 100, currency), labels[key as BucketKey]]} />
                  {bucketKeys.map((key) => <Bar key={key} dataKey={key} stackId="age" fill={BUCKET_COLORS[key]} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>}
            <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-x-3 gap-y-2">
              {bucketKeys.map((key, index) => {
                const amount = amounts[index] ?? 0;
                const unknown = unknownCounts[currency]?.[key] ?? 0;
                const unknownLabel = t('financeHub:hub.fix.ageing.unknownCount', { defaultValue: unknown === 1 ? '{{count}} balance unknown' : '{{count}} balances unknown', count: unknown });
                return (
                  <div key={key} data-testid={`ageing-bucket-${currency}-${key}`} className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-baseline gap-x-2">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: BUCKET_COLORS[key] }} />
                    <span className="min-w-0 break-words text-control text-muted-foreground">{labels[key]}</span>
                    {unknown > 0 && amount === 0
                      ? <span className="text-right text-control text-muted-foreground">{unknownLabel}</span>
                      : <span className="max-w-full break-all text-right tabular text-sm font-semibold">{formatCurrency(amount / 100, currency)}</span>}
                    {unknown > 0 && amount !== 0 && <span className="col-span-2 col-start-2 text-right text-control text-muted-foreground">{t('financeHub:hub.fix.ageing.plusUnknown', { defaultValue: '+ {{label}}', label: unknownLabel })}</span>}
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
