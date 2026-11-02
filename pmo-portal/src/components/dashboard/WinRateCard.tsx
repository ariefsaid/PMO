import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWinRate, type WinRateRange } from '@/src/hooks/useDashboard';
import { ViewToggle, type ViewOption } from '@/src/components/ui/ViewToggle';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency, formatPercent } from '@/src/lib/format';
import { toIso } from '@/src/lib/calendar/monthMatrix';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { Icon } from '@/src/components/ui/icons';
import {
  calculateBidRates,
  type BidCurrencyTotals,
  type BidRateFigure,
  type UnavailableRateReason,
} from '@/src/lib/winRateMetrics';
import { STALE_BID_THRESHOLD_DAYS } from '@/src/lib/dashboardConstants';
import { LossBreakdown } from './LossBreakdown';

// ── Win-rate period options (PRESERVED VERBATIM from the legacy file — AC-1117) ──

type PeriodKey = 'all' | 'ytd' | 'q' | 't12';

/** Local YYYY-MM-DD string for a Date (cache key + RPC param), or '' if absent.
 *  AC-W2-3-04: uses LOCAL date parts so cache key matches the RPC param without UTC shift. */
function toDateKey(d?: Date): string {
  return d ? toIso(d) : '';
}

/**
 * Build a WinRateRange whose `key` encodes both the period label and the resolved
 * from/to ISO dates. This prevents stale cache entries when the window rolls over
 * across a day/quarter/year boundary in a long-lived session (FIX-WIN-CACHE-KEY).
 */
function buildWinRateRange(period: PeriodKey): WinRateRange {
  const now = new Date();
  switch (period) {
    case 'ytd': {
      const from = new Date(now.getFullYear(), 0, 1);
      return { from, key: `ytd:${toDateKey(from)}:` };
    }
    case 'q': {
      const from = new Date(now);
      from.setMonth(from.getMonth() - 3);
      return { from, to: now, key: `q:${toDateKey(from)}:${toDateKey(now)}` };
    }
    case 't12': {
      const from = new Date(now);
      from.setFullYear(from.getFullYear() - 1);
      return { from, to: now, key: `t12:${toDateKey(from)}:${toDateKey(now)}` };
    }
    default:
      return { key: 'all::' };
  }
}

// Keep the live four real options (RPC-backed, AC-1117) — do NOT drop YTD to
// match the mockup's three frames (plan Open Q3, default = keep the four).


const WinRateFigure: React.FC<{
  currency: string;
  label: string;
  figure: BidRateFigure;
  basis: 'count' | 'value';
  outcomeLabel: string;
  isPrimary?: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}> = ({ currency, label, figure, basis, outcomeLabel, isPrimary = false, t }) => {
  const percent = figure.rate === null ? null : formatPercent(figure.rate);
  const displayAmount = (value: number) => basis === 'count' ? String(value) : formatCurrency(value, currency);
  const detail = figure.denominator > 0
    ? t('dashboard:winRate.ratio', '{{won}} won of {{total}} {{outcomes}}', {
      won: displayAmount(figure.numerator),
      total: displayAmount(figure.denominator),
      outcomes: outcomeLabel,
    })
    : null;
  const ariaLabel = isPrimary
    ? t('dashboard:winRate.decidedProgress', '{{currency}} win rate on decided bids', { currency })
    : t('dashboard:winRate.allBidsProgress', '{{currency}} conversion of all bids', { currency });

  return (
    <div className="space-y-1">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          data-testid={isPrimary ? 'kpi-win-rate' : undefined}
          aria-live={isPrimary ? 'polite' : undefined}
          className="shrink-0 text-sm font-semibold tabular text-foreground"
        >
          {percent ?? '—'}
        </span>
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <span
          role="progressbar"
          aria-label={ariaLabel}
          aria-valuenow={figure.rate === null ? undefined : Math.round(figure.rate * 1000) / 10}
          aria-valuetext={percent ?? t('dashboard:winRate.unavailable', 'No rate available')}
          aria-valuemin={0}
          aria-valuemax={100}
          className="block h-3 min-w-12 flex-1 overflow-hidden rounded-full bg-secondary"
        >
          <span className="block h-full rounded-full bg-primary" style={{ width: `${figure.rate === null ? 0 : figure.rate * 100}%` }} />
        </span>
        {detail && <span className="min-w-0 break-words text-[11px] text-muted-foreground">{detail}</span>}
      </div>
    </div>
  );
};

export interface WinRateCardProps {
  currency: string;
  /** Omit the standalone card frame when this content sits in an area panel. */
  embedded?: boolean;
  /** A containing dashboard may own the date range and URL state. */
  range?: WinRateRange;
  hidePeriodControl?: boolean;
}

export const WinRateCard: React.FC<WinRateCardProps> = ({ currency, embedded = false, range: externalRange, hidePeriodControl = false }) => {
  const [mode, setMode] = useState<'count' | 'value'>('count');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const range = useMemo(() => buildWinRateRange(period), [period]);
  const activeRange = externalRange ?? range;
  const { data: wr, isError, refetch } = useWinRate(activeRange);
  const { t } = useTranslation();
  const basisOptions: ViewOption<'count' | 'value'>[] = [
    { value: 'count', label: t('dashboard.winRate.basisCount', 'By count'), testId: 'win-rate-toggle-count' },
    { value: 'value', label: t('dashboard.winRate.basisValue', 'By value'), testId: 'win-rate-toggle-value' },
  ];
  const periodOptions: ViewOption<PeriodKey>[] = [
    { value: 'all', label: t('dashboard.winRate.periodAll', 'All time'), testId: 'win-rate-period-all' },
    { value: 'ytd', label: t('dashboard.winRate.periodYtd', 'YTD'), testId: 'win-rate-period-ytd' },
    { value: 'q', label: t('dashboard.winRate.periodQuarter', 'Last quarter'), testId: 'win-rate-period-q' },
    { value: 't12', label: t('dashboard.winRate.periodTrailing', 'Trailing 12 mo'), testId: 'win-rate-period-t12' },
  ];
  // #774: declined-to-bid deals are outside both win-rate denominators, so they are reported
  // beside the rate — including when they are the ONLY decided deals in the window.
  const declined = wr?.declined_count ?? 0;
  const declinedNote = declined > 0 && (
    <p data-testid="win-rate-declined" className="mt-2 text-xs text-muted-foreground">
      {t('dashboard.winRate.declined', '{{n}} declined to bid, not counted in the win rate', { n: declined })}
    </p>
  );

  const legacyRows: BidCurrencyTotals[] = mode === 'value' && wr?.value_by_currency?.length
    ? wr.value_by_currency.map((row) => ({
      currency: row.currency,
      wins_count: 0,
      losses_count: 0,
      open_count: 0,
      wins_value: row.wins_value,
      losses_value: row.losses_value,
      open_value: 0,
    }))
    : wr && (wr.wins_count + wr.losses_count > 0 || (wr.open_count ?? 0) > 0
      || (wr.wins_value ?? 0) > 0 || (wr.losses_value ?? 0) > 0)
      ? [{
        currency,
        wins_count: wr.wins_count,
        losses_count: wr.losses_count,
        open_count: wr.open_count ?? 0,
        wins_value: wr.wins_value ?? 0,
        losses_value: wr.losses_value ?? 0,
        open_value: 0,
      }]
      : [];
  const rows: BidCurrencyTotals[] = wr?.bids_by_currency ?? legacyRows;
  const hasBids = rows.some((row) => row.wins_count + row.losses_count + row.open_count > 0
    || row.wins_value + row.losses_value + row.open_value > 0);
  const openCount = wr?.open_count ?? rows.reduce((sum, row) => sum + row.open_count, 0);
  const staleCount = wr?.stale_count ?? 0;
  const figures = rows.map((row) => ({ row, rates: calculateBidRates(row, mode) }));
  const unavailableMessage = (reason: UnavailableRateReason) => {
    switch (reason) {
      case 'no_bids':
        return t('dashboard:winRate.noBids', 'No bids in this period to calculate a rate.');
      case 'no_decided_bids':
        return t('dashboard:winRate.noDecidedBids', 'No decided bids in this currency for this period.');
      case 'no_bid_value':
        return t('dashboard:winRate.noBidValue', 'No bid value recorded for this currency in this period.');
      case 'no_decided_value':
        return t('dashboard:winRate.noDecidedValue', 'No decided bid value recorded for this currency in this period.');
    }
  };

  return (
    <section aria-label={t('dashboard.winRate.title', 'Win rate')} className={embedded ? 'grid gap-3' : 'rounded-lg border border-border bg-card p-4'}>
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('dashboard.winRate.title', 'Win rate')}</h3>
        <Tooltip content={t('dashboard:hub.company.help.winRate', 'Shows wins divided by decided bids and wins divided by all bids, including open bids, in the selected period. The basis can switch between count and value.')}>
          <button type="button" aria-label={t('dashboard:hub.company.aboutWinRate', 'About win rate')} className="touch-target grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><Icon name="help" className="size-3.5" /></button>
        </Tooltip>
        <span className="flex-1" />
        <ViewToggle<'count' | 'value'> options={basisOptions} value={mode} onChange={setMode} ariaLabel={t('dashboard.winRate.basis', 'Win-rate basis')} semantics="toggle" />
      </div>

      {!hidePeriodControl && <ViewToggle<PeriodKey>
        options={periodOptions}
        value={period}
        onChange={setPeriod}
        ariaLabel={t('dashboard.winRate.period', 'Time frame')}
        className="mb-3.5 flex-wrap"
        semantics="toggle"
      />}

      {isError ? (
        <ListState
          variant="error"
          title={t('dashboard.winRate.errorTitle', "Couldn't load win rate")}
          sub={t('dashboard.winRate.errorSub', 'Something went wrong. Try again.')}
          onRetry={() => refetch()}
        />
      ) : !hasBids ? (
        <>
          <ListState
            variant="empty"
            icon="pipe"
            title={t('dashboard.winRate.emptyTitle', 'No closed projects in this window')}
            sub={t('dashboard.winRate.emptySub', 'Try a wider time frame to see your win rate.')}
          />
          {declinedNote}
          <LossBreakdown range={activeRange} />
        </>
      ) : (
        <>
          <div className="space-y-3" data-testid="win-rate-breakdown">
            {figures.map(({ row, rates }, index) => {
              const reasons = [...new Set([rates.decided.reason, rates.allBids.reason]
                .filter((reason): reason is UnavailableRateReason => reason !== null))];
              return (
                <section
                  key={row.currency}
                  data-testid={`win-rate-currency-${row.currency}`}
                  aria-label={t('dashboard:winRate.currencyLabel', '{{currency}} bids', { currency: row.currency })}
                  className="space-y-2 border-b border-border pb-2 last:border-b-0 last:pb-0"
                >
                  <div className="text-xs font-semibold text-foreground">{row.currency}</div>
                  <WinRateFigure
                    currency={row.currency}
                    label={t('dashboard:winRate.decidedLabel', 'Win rate on decided bids')}
                    figure={rates.decided}
                    basis={mode}
                    outcomeLabel={t('dashboard:winRate.decidedOutcomes', 'decided')}
                    isPrimary={index === 0}
                    t={t}
                  />
                  <WinRateFigure
                    currency={row.currency}
                    label={t('dashboard:winRate.allBidsLabel', 'Conversion of all bids')}
                    figure={rates.allBids}
                    basis={mode}
                    outcomeLabel={t('dashboard:winRate.allOutcomes', 'bids')}
                    t={t}
                  />
                  {reasons.length > 0 && (
                    <p data-testid={`win-rate-reason-${row.currency}`} className="text-[11px] text-muted-foreground">
                      {reasons.map(unavailableMessage).join(' ')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span data-testid="win-rate-open-count">
              {t('dashboard:winRate.openCount', '{{n}} still open', { n: openCount })}
            </span>
            <span data-testid="win-rate-stale-count">
              {t('dashboard:winRate.staleCount', '{{n}} stale ({{days}}+ days)', { n: staleCount, days: STALE_BID_THRESHOLD_DAYS })}
            </span>
          </div>
          <p data-testid="win-rate-period-rule" className="mt-2 max-w-[60ch] text-xs text-muted-foreground">
            {t(
              'dashboard:winRate.periodRule',
              'Decided bids use their decision date; open bids use their creation date for this period; the stale count is current and age starts at the last stage change, falling back to project creation if none was recorded.',
            )}
          </p>
          <div className="mt-2.5 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {t('dashboard:winRate.won', 'Won')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-secondary-foreground/40" />
              {t('dashboard:winRate.notWon', 'Lost or still open')}
            </span>
          </div>
          {declinedNote}
          <LossBreakdown range={activeRange} />
        </>
      )}
    </section>
  );
};
