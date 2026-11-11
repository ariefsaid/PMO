import React from 'react';
import { useTranslation } from 'react-i18next';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { formatMonthYearShort, formatTileMoney } from '@/src/lib/format';

const tile = (cents: number, currency: string) => formatTileMoney(cents / 100, currency) ?? '—';

export interface EarnedBarRow {
  key: string;
  name: string;
  currency: string;
  contract: number;
  earned: number;
}

/**
 * Comparison across projects: one bar per project on one scale (the largest contract), sorted by contract,
 * the earned share in the accent colour, both figures written on the row. The table below stays the exact record.
 */
export const EarnedAgainstContract: React.FC<{ rows: EarnedBarRow[] }> = ({ rows }) => {
  const { t } = useTranslation();
  const usable = rows.filter((row) => row.contract > 0);
  const currencies = [...new Set(usable.map((row) => row.currency))];
  if (usable.length < 2) return null;
  return (
    <section aria-label={t('finance:managementPack.chart.earnedVsContract', 'Earned against contract')} data-testid="pack-earned-bars" className="min-w-0">
      <h2 className="mb-2 text-control font-semibold">{t('finance:managementPack.chart.earnedVsContract', 'Earned against contract')}</h2>
      {currencies.map((currency) => {
        const group = usable.filter((row) => row.currency === currency).sort((a, b) => b.contract - a.contract);
        const scale = group[0]?.contract ?? 1;
        return (
          <ul key={currency} role="list" className="space-y-2">
            {group.map((row) => (
              <li key={row.key} className="grid min-w-0 grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                <span className="min-w-0 truncate text-control" title={row.name}>{row.name}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    role="img"
                    aria-label={t('finance:managementPack.chart.barLabel', '{{name}}: earned {{earned}} of {{contract}}', { name: row.name, earned: tile(row.earned, currency), contract: tile(row.contract, currency) })}
                    className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"
                  >
                    <span aria-hidden className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(row.contract / scale) * 100}%`, background: chartTheme.series.neutral }} />
                    <span aria-hidden className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Math.max(0, row.earned) / scale) * 100}%`, background: chartTheme.series.primary }} />
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-control tabular text-muted-foreground">{tile(row.earned, currency)} / {tile(row.contract, currency)}</span>
                </span>
              </li>
            ))}
          </ul>
        );
      })}
    </section>
  );
};

export interface TrendMonth { month: string; earnedToDate: number; invoicedToDate: number }

const W = 400;
const H = 96;
const PAD = 6;

/**
 * Trend over time (3 or more months): earned to date against invoiced to date, labelled at the line ends.
 * The gap between the lines is what is earned but not yet invoiced.
 */
export const EarnedInvoicedTrend: React.FC<{ currency: string; months: TrendMonth[] }> = ({ currency, months }) => {
  const { t } = useTranslation();
  if (months.length < 3) return null;
  const values = months.flatMap((m) => [m.earnedToDate, m.invoicedToDate]);
  const lo = Math.min(0, ...values);
  const span = Math.max(...values) - lo || 1;
  const y = (v: number) => H - PAD - ((v - lo) * (H - 2 * PAD)) / span;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (months.length - 1);
  const line = (pick: (m: TrendMonth) => number) => months.map((m, i) => `${x(i)},${y(pick(m))}`).join(' ');
  const first = months[0]!;
  const last = months[months.length - 1]!;
  const name = t('finance:managementPack.chart.trendName', 'Earned and invoiced to date, {{first}} to {{last}}', { first: formatMonthYearShort(first.month), last: formatMonthYearShort(last.month) });
  return (
    <section aria-label={name} data-testid="pack-trend" className="min-w-0">
      <h2 className="mb-2 text-control font-semibold">{t('finance:managementPack.chart.trendTitle', 'Earned and invoiced to date')}</h2>
      <svg role="img" aria-label={name} focusable="false" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-24 w-full">
        <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke={chartTheme.grid} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polyline points={line((m) => m.invoicedToDate)} fill="none" stroke={chartTheme.series.neutral} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <polyline points={line((m) => m.earnedToDate)} fill="none" stroke={chartTheme.series.primary} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div aria-hidden className="mt-1 flex justify-between gap-3 text-support text-muted-foreground tabular">
        <span>{formatMonthYearShort(first.month)}</span>
        <span>{formatMonthYearShort(last.month)}</span>
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-control tabular">
        <span><span className="font-medium" style={{ color: 'hsl(var(--primary-text, var(--primary)))' }}>{t('finance:managementPack.chart.earnedEnd', 'Earned')}</span> {tile(last.earnedToDate, currency)}</span>
        <span><span className="font-medium text-muted-foreground">{t('finance:managementPack.chart.invoicedEnd', 'Invoiced')}</span> {tile(last.invoicedToDate, currency)}</span>
      </p>
    </section>
  );
};
