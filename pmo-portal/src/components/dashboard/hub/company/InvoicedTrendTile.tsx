import React from 'react';
import { useTranslation } from 'react-i18next';
import { FigureContent } from '@/src/components/ui/FigureContent';
import { Icon } from '@/src/components/ui/icons';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { cn } from '@/src/components/ui/cn';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { formatUtcMonthYear } from '@/src/lib/format';
import type { InvoicedTrend, TrendDirection } from '@/src/lib/dashboardTrend';

const W = 160;
const H = 40;
const PAD = 4;
const monthText = (iso: string) => formatUtcMonthYear(new Date(`${iso}T00:00:00Z`));

/** Decorative: the text summary beside it carries the same facts (AC-DTR-003). */
const Line: React.FC<{ points: InvoicedTrend['points'] }> = ({ points }) => {
  const values = points.map((p) => p.amount);
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const xy = values.map((v, i) => [
    PAD + (i * (W - 2 * PAD)) / (values.length - 1),
    span === 0 ? H / 2 : H - PAD - ((v - min) * (H - 2 * PAD)) / span,
  ]);
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} className="h-10 w-40 shrink-0">
      <polyline points={xy.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke={chartTheme.series.primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill={chartTheme.series.primary} />
    </svg>
  );
};

const DIRECTION_CLASS: Record<TrendDirection, string> = {
  up: 'text-success',
  down: 'text-destructive-text',
  flat: 'text-muted-foreground',
};

/**
 * #1597: the headline money figure with its trend. Every number is the management pack's own monthly
 * total (see selectInvoicedTrend); this tile only lays it out. Fewer than three months of history
 * keeps the figure and drops the line.
 */
export const InvoicedTrendTile: React.FC<{ trend: InvoicedTrend }> = ({ trend }) => {
  const { t } = useTranslation('dashboard');
  const reason = t('figures.moneyUnknownReason', 'The accounting source did not provide a comparable amount.');
  const money = (amount: number) => moneyFigure(amount, trend.currency, reason, { labelHasCurrency: true });
  const total = money(trend.total);
  const label = t('trend.label', 'Invoiced per month · {{currency}} · excl. tax', { currency: trend.currency });
  const { first, last } = { first: trend.points[0], last: trend.points[trend.points.length - 1] };
  const direction = {
    up: t('trend.rising', 'Rising'),
    down: t('trend.falling', 'Falling'),
    flat: t('trend.steady', 'Steady'),
  }[trend.direction];

  return (
    <section aria-label={label} data-testid="invoiced-trend" className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-card px-4 pb-3.5 pt-4">
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        <div className="min-w-0 break-words text-[23px] font-bold leading-none tracking-[-0.02em] tabular">
          <FigureContent value={total.value} exactValue={total.exactValue} unavailableReason={total.unavailableReason} />
        </div>
        <div className="text-[12px] text-muted-foreground">
          {t('trend.span', '{{from}} to {{to}}', { from: monthText(first.month), to: monthText(last.month) })}
        </div>
      </div>
      {trend.hasLine && (
        <div className="flex min-w-0 flex-col items-start gap-2 sm:items-end">
          <Line points={trend.points} />
          <p data-testid="invoiced-trend-summary" className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className={cn('inline-flex items-center gap-[3px] font-semibold [&_svg]:size-3', DIRECTION_CLASS[trend.direction])}>
              {trend.direction !== 'flat' && <Icon name={trend.direction} />}
              {direction}
            </span>
            <span className="tabular">{t('trend.firstLast', '{{firstMonth}} {{first}} → {{lastMonth}} {{last}}', {
              firstMonth: monthText(first.month), first: money(trend.first).value, lastMonth: monthText(last.month), last: money(trend.last).value,
            })}</span>
          </p>
        </div>
      )}
    </section>
  );
};
