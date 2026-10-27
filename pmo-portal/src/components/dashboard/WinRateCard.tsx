import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWinRate, type WinRateRange } from '@/src/hooks/useDashboard';
import { ViewToggle, type ViewOption } from '@/src/components/ui/ViewToggle';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';
import { toIso } from '@/src/lib/calendar/monthMatrix';

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


/**
 * Win Rate — count/value basis + period frame, re-skinned to DESIGN.md `seg`
 * segments. The basis/period state and `buildWinRateRange` are unchanged from
 * the legacy file (AC-1117). The rate is announced `aria-live`; the legend is
 * dot + text (color-not-only). Zero closed deals shows an honest empty message
 * rather than a fabricated 0%.
 */
export const WinRateCard: React.FC<{ currency: string }> = ({ currency }) => {
  const [mode, setMode] = useState<'count' | 'value'>('count');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const range = useMemo(() => buildWinRateRange(period), [period]);
  const { data: wr, isError, refetch } = useWinRate(range);
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
      {t('dashboard.winRate.declined', '{{n}} declined to bid — not counted in the win rate', { n: declined })}
    </p>
  );

  const valueRows = mode === 'value' ? wr?.value_by_currency : undefined;
  const wins = wr ? (mode === 'count' ? wr.wins_count : wr.wins_value ?? 0) : 0;
  const losses = wr ? (mode === 'count' ? wr.losses_count : wr.losses_value ?? 0) : 0;
  const total = wins + losses;
  const rate = wr ? (mode === 'count' ? wr.win_rate_count : wr.win_rate_value) : null;
  const hasValueOutcomes = valueRows
    ? valueRows.some((row) => row.wins_value + row.losses_value > 0)
    : total > 0;
  const hasOutcomes = mode === 'value' ? hasValueOutcomes : total > 0;
  const wonPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  const fmt = (n: number, valueCurrency = currency) =>
    mode === 'count' ? String(n) : formatCurrency(n, valueCurrency);

  return (
    <section aria-label={t('dashboard.winRate.title', 'Win rate')} className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold">{t('dashboard.winRate.title', 'Win Rate')}</span>
        <span className="flex-1" />
        <ViewToggle<'count' | 'value'> options={basisOptions} value={mode} onChange={setMode} ariaLabel={t('dashboard.winRate.basis', 'Win-rate basis')} semantics="toggle" />
      </div>

      <ViewToggle<PeriodKey>
        options={periodOptions}
        value={period}
        onChange={setPeriod}
        ariaLabel={t('dashboard.winRate.period', 'Time frame')}
        className="mb-3.5 flex-wrap"
        semantics="toggle"
      />

      {isError ? (
        <ListState
          variant="error"
          title={t('dashboard.winRate.errorTitle', "Couldn't load win rate")}
          sub={t('dashboard.winRate.errorSub', 'Something went wrong. Try again.')}
          onRetry={() => refetch()}
        />
      ) : !hasOutcomes ? (
        <>
          <ListState
            variant="empty"
            icon="pipe"
            title={t('dashboard.winRate.emptyTitle', 'No closed projects in this window')}
            sub={t('dashboard.winRate.emptySub', 'Try a wider time frame to see your win rate.')}
          />
          {declinedNote}
        </>
      ) : (
        <>
          {valueRows ? (
            <div aria-live="polite" className="space-y-2" data-testid="win-rate-value-breakdown">
              {valueRows.filter((row) => row.wins_value + row.losses_value > 0).map((row) => (
                <p key={row.currency} data-testid={`win-rate-value-${row.currency}`} className="text-sm text-muted-foreground">
                  {row.win_rate_value === null
                    ? t('dashboard.winRate.noRecordedLosses', '{{currency}} — no recorded losses; {{wins}} won', { currency: row.currency, wins: fmt(row.wins_value, row.currency) })
                    : t('dashboard.winRate.currencyResult', '{{currency}} {{percent}}% — {{wins}} won of {{total}} closed', {
                      currency: row.currency,
                      percent: (row.win_rate_value * 100).toFixed(1),
                      wins: fmt(row.wins_value, row.currency),
                      total: fmt(row.wins_value + row.losses_value, row.currency),
                    })}
                </p>
              ))}
            </div>
          ) : (
          <>
          <div className="mb-3 flex items-baseline gap-2.5">
            <span
              data-testid="kpi-win-rate"
              aria-live="polite"
              className="text-[34px] font-bold leading-none tracking-[-0.02em] tabular"
            >
              {rate !== null ? `${(rate * 100).toFixed(1)}%` : '—'}
            </span>
            <span className="text-xs text-muted-foreground">
              {t('dashboard.winRate.result', '{{wins}} won of {{total}} closed', { wins: fmt(wins), total: fmt(total) })}
            </span>
          </div>

          <span
            role="progressbar"
            aria-label={t('dashboard.winRate.progress', 'Win rate {{percent}}%', { percent: rate !== null ? (rate * 100).toFixed(1) : 0 })}
            aria-valuenow={wonPct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="block h-3 overflow-hidden rounded-full bg-secondary"
          >
            <span className="block h-full rounded-full bg-success" style={{ width: `${wonPct}%` }} />
          </span>
          </>
          )}

          <div className="mt-2.5 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              {t('dashboard.winRate.won', 'Won')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-secondary-foreground/40" />
              {t('dashboard.winRate.lost', 'Lost')}
            </span>
          </div>
          {declinedNote}
          <p className="mt-2 text-xs text-muted-foreground">{t('uxs03.recordedOutcomesOnly', 'Recorded outcomes only; unrecorded decisions are not counted.')}</p>
        </>
      )}
    </section>
  );
};
