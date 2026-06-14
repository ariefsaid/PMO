import React, { useMemo, useState } from 'react';
import { useWinRate, type WinRateRange } from '@/src/hooks/useDashboard';
import { ViewToggle, type ViewOption } from '@/src/components/ui/ViewToggle';
import { ListState } from '@/src/components/ui/ListState';
import { formatCurrency } from '@/src/lib/format';

// ── Win-rate period options (PRESERVED VERBATIM from the legacy file — AC-1117) ──

type PeriodKey = 'all' | 'ytd' | 'q' | 't12';

/** ISO YYYY-MM-DD string for a Date, or '' if absent. */
function toDateKey(d?: Date): string {
  return d ? d.toISOString().slice(0, 10) : '';
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

const BASIS_OPTIONS: ViewOption<'count' | 'value'>[] = [
  { value: 'count', label: 'By count', testId: 'win-rate-toggle-count' },
  { value: 'value', label: 'By value', testId: 'win-rate-toggle-value' },
];

// Keep the live four real options (RPC-backed, AC-1117) — do NOT drop YTD to
// match the mockup's three frames (plan Open Q3, default = keep the four).
const PERIOD_OPTIONS: ViewOption<PeriodKey>[] = [
  { value: 'all', label: 'All time', testId: 'win-rate-period-all' },
  { value: 'ytd', label: 'YTD', testId: 'win-rate-period-ytd' },
  { value: 'q', label: 'Last quarter', testId: 'win-rate-period-q' },
  { value: 't12', label: 'Trailing 12 mo', testId: 'win-rate-period-t12' },
];

/**
 * Win Rate — count/value basis + period frame, re-skinned to DESIGN.md `seg`
 * segments. The basis/period state and `buildWinRateRange` are unchanged from
 * the legacy file (AC-1117). The rate is announced `aria-live`; the legend is
 * dot + text (color-not-only). Zero closed deals shows an honest empty message
 * rather than a fabricated 0%.
 */
export const WinRateCard: React.FC = () => {
  const [mode, setMode] = useState<'count' | 'value'>('count');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const range = useMemo(() => buildWinRateRange(period), [period]);
  const { data: wr } = useWinRate(range);

  const wins = wr ? (mode === 'count' ? wr.wins_count : wr.wins_value) : 0;
  const losses = wr ? (mode === 'count' ? wr.losses_count : wr.losses_value) : 0;
  const total = wins + losses;
  const rate = wr ? (mode === 'count' ? wr.win_rate_count : wr.win_rate_value) : null;
  const wonPct = total > 0 ? Math.round((wins / total) * 100) : 0;

  const fmt = (n: number) => (mode === 'count' ? String(n) : formatCurrency(n));

  return (
    <section aria-label="Win rate" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[13.5px] font-semibold">Win Rate</span>
        <span className="flex-1" />
        <ViewToggle<'count' | 'value'> options={BASIS_OPTIONS} value={mode} onChange={setMode} ariaLabel="Win-rate basis" />
      </div>

      <ViewToggle<PeriodKey>
        options={PERIOD_OPTIONS}
        value={period}
        onChange={setPeriod}
        ariaLabel="Time frame"
        className="mb-3.5 flex-wrap"
      />

      {total === 0 ? (
        <ListState
          variant="empty"
          icon="pipe"
          title="No closed projects in this window"
          sub="Try a wider time frame to see your win rate."
        />
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
              {fmt(wins)} won of {fmt(total)} closed
            </span>
          </div>

          <span
            role="progressbar"
            aria-label={`Win rate ${rate !== null ? (rate * 100).toFixed(1) : 0}%`}
            aria-valuenow={wonPct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="block h-3 overflow-hidden rounded-full bg-secondary"
          >
            <span className="block h-full rounded-full bg-success" style={{ width: `${wonPct}%` }} />
          </span>

          <div className="mt-2.5 flex gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-success" />
              Won
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-1.5 rounded-full bg-secondary-foreground/40" />
              Lost
            </span>
          </div>
        </>
      )}
    </section>
  );
};
