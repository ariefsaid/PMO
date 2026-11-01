import React from 'react';
import { useTranslation } from 'react-i18next';
import { FigureContent } from '@/src/components/ui/FigureContent';
import { Icon } from '@/src/components/ui/icons';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { cn } from '@/src/components/ui/cn';
import { moneyFigure } from '@/src/lib/dashboardMoney';
import { formatUtcMonthYearFull } from '@/src/lib/format';
import { TREND_MONTHS, type InvoicedTrend, type TrendDirection } from '@/src/lib/dashboardTrend';

const W = 400;
const H = 88;
const PAD = 6;
const monthText = (iso: string) => formatUtcMonthYearFull(new Date(`${iso}T00:00:00Z`));

/** Decorative: the text summary beside it carries the same facts (AC-DTR-003). Scaled from zero so a fall to nothing reads as one. */
const Line: React.FC<{ points: InvoicedTrend['points'] }> = ({ points }) => {
  const values = points.map((p) => p.amount);
  const lo = Math.min(0, ...values);
  const span = Math.max(0, ...values) - lo;
  const y = (v: number) => H - PAD - ((v - lo) * (H - 2 * PAD)) / span;
  const xy = values.map((v, i) => [PAD + (i * (W - 2 * PAD)) / (values.length - 1), y(v)]);
  const path = xy.map(([x, py]) => `${x},${py}`).join(' ');
  const [fx, fy] = xy[0];
  const [lx, ly] = xy[xy.length - 1];
  const primary = chartTheme.series.primary;
  return (
    <svg aria-hidden="true" focusable="false" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke={chartTheme.grid} strokeWidth="1" />
      <polygon points={`${PAD},${y(0)} ${path} ${W - PAD},${y(0)}`} fill={primary} fillOpacity="0.1" />
      <polyline points={path} fill="none" stroke={primary} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={fx} cy={fy} r="3.5" fill={primary} />
      <circle cx={lx} cy={ly} r="3.5" fill={primary} />
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
  const money = (amount: number) => moneyFigure(amount, trend.currency, reason);
  const total = money(trend.total);
  const label = t('trend.label', 'Invoiced, last {{months}} completed months · excl. tax', { months: TREND_MONTHS });
  const { first, last } = { first: trend.points[0], last: trend.points[trend.points.length - 1] };
  const firstText = `${monthText(first.month)} · ${money(trend.first).value}`;
  const lastText = `${monthText(last.month)} · ${money(trend.last).value}`;
  const direction = {
    up: t('trend.rising', 'Rising'),
    down: t('trend.falling', 'Falling'),
    flat: t('trend.steady', 'Steady'),
  }[trend.direction];

  return (
    <section aria-label={label} data-testid="invoiced-trend" className="flex min-w-0 flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-lg border border-border bg-card px-4 pb-3.5 pt-4">
      <div className="flex min-w-0 flex-col gap-2.5">
        <span className="text-[12.5px] font-medium text-muted-foreground">{label}</span>
        <div className="min-w-0 break-words text-[23px] font-bold leading-none tracking-[-0.02em] tabular">
          <FigureContent value={total.value} exactValue={total.exactValue} unavailableReason={total.unavailableReason} />
        </div>
        {trend.hasLine && (
          <p data-testid="invoiced-trend-summary" className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span className={cn('inline-flex items-center gap-[3px] font-semibold [&_svg]:size-3', DIRECTION_CLASS[trend.direction])}>
              {trend.direction !== 'flat' && <Icon name={trend.direction} />}
              {direction}
            </span>
            <span className="tabular">{t('trend.latest', 'Latest month, {{month}}: {{amount}}', { month: monthText(last.month), amount: money(trend.last).value })}</span>
            <span className="sr-only">{t('trend.since', 'from {{month}}: {{amount}}', { month: monthText(first.month), amount: money(trend.first).value })}</span>
          </p>
        )}
      </div>
      {trend.hasLine && (
        <div className="flex min-w-0 basis-72 flex-1 flex-col gap-1.5 sm:max-w-lg">
          <Line points={trend.points} />
          <div aria-hidden="true" className="flex justify-between gap-3 text-[12px] text-muted-foreground tabular">
            <span>{firstText}</span>
            <span>{lastText}</span>
          </div>
        </div>
      )}
    </section>
  );
};
