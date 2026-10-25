import React, { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useWinRate, type WinRateRange } from '@/src/hooks/useDashboard';
import { ViewToggle, type ViewOption } from '@/src/components/ui/ViewToggle';
import { formatCurrency, formatNumber } from '@/src/lib/format';
import { toIso } from '@/src/lib/calendar/monthMatrix';
import { useIsNarrow } from '@/src/components/ui/useIsNarrow';

type PeriodKey = 'all' | 'ytd' | 'q' | 't12';
type Basis = 'count' | 'value';
type RateRow = {
  id: string;
  currency?: string;
  wins: number | null;
  losses: number | null;
  rate: number | null;
  sampleCount: number;
  valuesLabel: string;
  sampleLabel: string;
  label: string;
};

const PERIOD_PARAM = 'winRatePeriod';
const BASIS_PARAM = 'winRateBasis';
const PERIODS: PeriodKey[] = ['all', 'ytd', 'q', 't12'];

function toDateKey(date?: Date): string {
  return date ? toIso(date) : '';
}

/** Keep the established rolling-window semantics for the Last quarter control. */
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

function readPeriod(value: string | null): PeriodKey {
  return PERIODS.includes(value as PeriodKey) ? value as PeriodKey : 'all';
}

export const WinRateCard: React.FC<{ currency: string }> = ({ currency }) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const period = readPeriod(searchParams.get(PERIOD_PARAM));
  const basis: Basis = searchParams.get(BASIS_PARAM) === 'value' ? 'value' : 'count';
  const isNarrow = useIsNarrow();
  const range = useMemo(() => buildWinRateRange(period), [period]);
  const { data, isPending, isError, refetch } = useWinRate(range);
  const { t } = useTranslation();

  const setFigureParam = (key: string, value: string, defaultValue: string) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value === defaultValue) next.delete(key);
      else next.set(key, value);
      return next;
    });
  };

  const periodLabel = t('dashboard.winRate.period', 'Time frame');
  const basisLabel = t('dashboard.winRate.basis', 'Win-rate basis');
  const periodOptions: ViewOption<PeriodKey>[] = [
    { value: 'all', label: t('dashboard.winRate.periodAll', 'All time'), testId: 'win-rate-period-all' },
    { value: 'ytd', label: t('dashboard.winRate.periodYtd', 'YTD'), testId: 'win-rate-period-ytd' },
    { value: 'q', label: t('dashboard.winRate.periodQuarter', 'Last quarter'), testId: 'win-rate-period-q' },
    { value: 't12', label: t('dashboard.winRate.periodTrailing', 'Trailing 12 mo'), testId: 'win-rate-period-t12' },
  ];
  const basisOptions: ViewOption<Basis>[] = [
    { value: 'count', label: t('dashboard.winRate.basisCount', 'By count'), testId: 'win-rate-toggle-count' },
    { value: 'value', label: t('dashboard.winRate.basisValue', 'By value'), testId: 'win-rate-toggle-value' },
  ];

  const sampleCount = (data?.wins_count ?? 0) + (data?.losses_count ?? 0);
  const valueRows = useMemo(() => {
    if (!data) return [];
    if (data.value_by_currency?.length) {
      return data.value_by_currency.map((row) => ({
        currency: row.currency,
        wins: row.wins_value,
        losses: row.losses_value,
        rate: row.win_rate_value,
      }));
    }
    return [{
      currency,
      wins: data.wins_value,
      losses: data.losses_value,
      rate: data.win_rate_value,
    }];
  }, [currency, data]);

  const activeRows = useMemo<RateRow[]>(() => {
    if (basis === 'count') {
      const wins = data?.wins_count ?? null;
      const losses = data?.losses_count ?? null;
      const count = wins !== null && losses !== null ? wins + losses : 0;
      return [{
        id: 'count',
        wins,
        losses,
        rate: data?.win_rate_count ?? null,
        sampleCount: count,
        label: t('dashboard.winRate.aggregateLabel', 'All outcomes'),
        sampleLabel: count === 1
          ? t('dashboard.winRate.sampleOne', '{{count}} closed outcome', { count })
          : t('dashboard.winRate.sampleMany', '{{count}} closed outcomes', { count }),
        valuesLabel: wins === null || losses === null
          ? t('dashboard.winRate.valuesUnavailable', 'Outcome values are unavailable')
          : t('dashboard.winRate.outcomeCounts', '{{wins}} won · {{losses}} lost', {
            wins: formatNumber(wins), losses: formatNumber(losses),
          }),
      }];
    }

    return valueRows.map((row) => {
      const knownTotal = row.wins !== null && row.losses !== null ? row.wins + row.losses : null;
      const amount = (value: number | null) => value === null
        ? t('dashboard.winRate.rateUnavailable', 'Rate unavailable')
        : formatCurrency(value, row.currency);
      const sampleLabel = sampleCount === 1
        ? t('dashboard.winRate.sampleAcrossCurrenciesOne', '{{count}} closed outcome across currencies', { count: sampleCount })
        : t('dashboard.winRate.sampleAcrossCurrenciesMany', '{{count}} closed outcomes across currencies', { count: sampleCount });
      return {
        id: row.currency,
        currency: row.currency,
        wins: row.wins,
        losses: row.losses,
        rate: row.rate,
        sampleCount,
        label: row.currency,
        sampleLabel,
        valuesLabel: knownTotal === null
          ? t('dashboard.winRate.valuesUnavailable', 'Outcome values are unavailable')
          : t('dashboard.winRate.outcomeBreakdown', '{{wins}} won · {{losses}} lost · {{total}} closed', {
            wins: amount(row.wins), losses: amount(row.losses), total: amount(knownTotal),
          }),
      };
    });
  }, [basis, data, sampleCount, t, valueRows]);

  const hasOutcomes = basis === 'count'
    ? sampleCount > 0
    : valueRows.some((row) => (row.wins ?? 0) + (row.losses ?? 0) > 0 || (sampleCount > 0 && row.rate !== null));
  const declined = !isPending && !isError ? data?.declined_count ?? 0 : 0;
  const unavailableLabel = t('dashboard.winRate.rateUnavailable', 'Rate unavailable');
  const scaleLabel = t('dashboard.winRate.scale', 'Win-rate scale, 0 to 100 percent');
  const rowSlots = Math.max(2, activeRows.length);
  const visibleRows = isPending || isError ? [] : activeRows;
  const hasDataRows = visibleRows.length > 0;

  const renderRow = (row: RateRow) => {
    const measured = row.sampleCount > 0 && row.rate !== null;
    const percent = measured ? Math.max(0, Math.min(100, row.rate! * 100)) : null;
    const spokenPercent = percent === null ? unavailableLabel : `${percent.toFixed(1)}%`;
    const rateTestId = basis === 'count' ? 'win-rate-rate-count' : `win-rate-rate-${row.id}`;
    const trackTestId = basis === 'count' ? 'win-rate-track-count' : `win-rate-track-${row.id}`;
    const valuesTestId = basis === 'count' ? 'win-rate-values-count' : `win-rate-values-${row.id}`;
    const sampleTestId = basis === 'count' ? 'win-rate-sample-count' : `win-rate-sample-${row.id}`;

    return (
      <div key={row.id} data-testid={`win-rate-row-${row.id}`} className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1.5 border-t border-border/70 py-2 md:grid-cols-[8rem_minmax(0,1fr)_11rem]">
        <span data-testid={basis === 'value' ? `win-rate-currency-${row.id}` : undefined} className="min-w-0 self-center text-sm font-medium">
          {row.label}
        </span>
        <span className="row-start-1 text-right md:col-start-3">
          <span data-testid={rateTestId} aria-live="polite" className="block text-sm font-semibold tabular">
            {measured ? spokenPercent : <><span aria-hidden="true">—</span><span className="sr-only">{unavailableLabel}</span></>}
          </span>
          <span data-testid={sampleTestId} className="block text-xs text-muted-foreground">
            {row.sampleLabel}
          </span>
        </span>
        <div
          data-testid={trackTestId}
          role="progressbar"
          aria-label={measured
            ? t('dashboard.winRate.progress', 'Win rate {{percent}}%', { percent: percent!.toFixed(1) })
            : unavailableLabel}
          aria-valuetext={measured ? undefined : unavailableLabel}
          aria-valuenow={measured ? Number(percent!.toFixed(1)) : undefined}
          aria-valuemin={0}
          aria-valuemax={100}
          className="col-span-2 flex h-3 min-w-0 overflow-hidden rounded-full bg-secondary md:col-span-1 md:col-start-2"
        >
          {measured && (
            <>
              <span
                data-testid={`win-rate-won-bar-${row.id}`}
                aria-hidden="true"
                className="h-full bg-success"
                style={{ width: `${percent}%` }}
              />
              <span
                data-testid={`win-rate-lost-bar-${row.id}`}
                aria-hidden="true"
                className="h-full bg-secondary-foreground/40"
                style={{ width: `${100 - percent!}%` }}
              />
            </>
          )}
        </div>
        <p data-testid={valuesTestId} className="col-span-2 min-w-0 break-words text-xs text-muted-foreground md:col-start-2 md:col-span-2">
          {row.valuesLabel}
        </p>
      </div>
    );
  };

  const emptyNote = !isPending && !isError && !hasOutcomes;
  const errorTitle = t('dashboard.winRate.errorTitle', "Couldn't load win rate");
  const emptyTitle = t('dashboard.winRate.emptyTitle', 'No closed projects in this window');

  return (
    <section aria-labelledby="win-rate-title" className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="win-rate-title" className="text-sm font-semibold">
          {t('dashboard.winRate.title', 'Win rate')}
        </h2>
      </div>

      <div className={isNarrow ? 'grid grid-cols-2 gap-2' : 'flex flex-wrap items-center gap-2'}>
        <div data-testid="win-rate-period-controls" className={isNarrow ? 'col-span-1 min-w-0' : 'min-w-0'}>
          {isNarrow ? (
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>{periodLabel}</span>
              <select
                aria-label={periodLabel}
                data-testid="win-rate-period-select"
                value={period}
                onChange={(event) => setFigureParam(PERIOD_PARAM, event.currentTarget.value, 'all')}
                className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <ViewToggle<PeriodKey>
              options={periodOptions}
              value={period}
              onChange={(value) => setFigureParam(PERIOD_PARAM, value, 'all')}
              ariaLabel={periodLabel}
              className="flex-nowrap"
              semantics="toggle"
            />
          )}
        </div>

        <div data-testid="win-rate-basis-controls" className={isNarrow ? 'col-span-1 min-w-0' : 'ml-auto min-w-0'}>
          {isNarrow ? (
            <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
              <span>{basisLabel}</span>
              <select
                aria-label={basisLabel}
                data-testid="win-rate-basis-select"
                value={basis}
                onChange={(event) => setFigureParam(BASIS_PARAM, event.currentTarget.value, 'count')}
                className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {basisOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          ) : (
            <ViewToggle<Basis>
              options={basisOptions}
              value={basis}
              onChange={(value) => setFigureParam(BASIS_PARAM, value, 'count')}
              ariaLabel={basisLabel}
              semantics="toggle"
            />
          )}
        </div>
      </div>

      <figure data-testid="win-rate-figure" aria-busy={isPending} className="mt-3.5 min-w-0">
        <div role="group" aria-label={scaleLabel} data-testid="win-rate-axis" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 pb-1 text-[11px] text-muted-foreground md:grid-cols-[8rem_minmax(0,1fr)_11rem]">
          <span className="sr-only">{scaleLabel}</span>
          <div className="col-span-2 flex justify-between md:col-span-1 md:col-start-2">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>

        <div className="min-w-0" aria-live="polite">
          {isPending ? (
            <div className="space-y-3" data-testid="win-rate-loading-rows">
              {Array.from({ length: 2 }, (_, index) => (
                <div key={index} aria-hidden="true" className="min-h-16 border-t border-border/70 py-2">
                  <div className="mb-2 h-3 w-2/5 rounded bg-muted" />
                  <div className="h-3 rounded-full bg-muted" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div data-testid="win-rate-error-rows" className="space-y-3" role="alert">
              <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-border/70 py-2 md:grid-cols-[8rem_minmax(0,1fr)_11rem]">
                <span className="text-sm font-medium">{basis === 'count' ? t('dashboard.winRate.aggregateLabel', 'All outcomes') : '—'}</span>
                <span className="text-right text-sm font-semibold tabular">—</span>
                <span
                  data-testid={basis === 'count' ? 'win-rate-track-count' : 'win-rate-track-unavailable-0'}
                  role="progressbar"
                  aria-label={unavailableLabel}
                  aria-valuetext={unavailableLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="col-span-2 h-3 rounded-full bg-secondary md:col-span-1 md:col-start-2"
                />
                <p className="col-span-2 text-xs text-muted-foreground md:col-start-2 md:col-span-2">
                  {t('dashboard.winRate.valuesUnavailable', 'Outcome values are unavailable')}
                </p>
              </div>
              <div className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-border/70 py-2 md:grid-cols-[8rem_minmax(0,1fr)_11rem]">
                <span className="text-sm text-muted-foreground">—</span>
                <span aria-hidden="true" className="text-right text-sm text-muted-foreground">—</span>
                <span
                  data-testid="win-rate-track-unavailable-1"
                  role="progressbar"
                  aria-label={unavailableLabel}
                  aria-valuetext={unavailableLabel}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="col-span-2 h-3 rounded-full bg-secondary md:col-span-1 md:col-start-2"
                />
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border/70 pt-3" role="group" aria-label={errorTitle}>
                <div>
                  <p className="text-sm font-medium">{errorTitle}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('dashboard.winRate.errorSub', 'Something went wrong. Try again.')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {t('common.retry', 'Retry')}
                </button>
              </div>
            </div>
          ) : hasDataRows ? (
            <>
              <div>{visibleRows.map(renderRow)}</div>
              {Array.from({ length: Math.max(0, rowSlots - visibleRows.length) }, (_, index) => (
                <div key={`unused-${index}`} data-testid={index === 0 ? 'win-rate-unused-slot' : undefined} aria-hidden="true" className="min-h-16 border-t border-border/70" />
              ))}
            </>
          ) : (
            <>
              {basis === 'count' && !isPending && !isError && data ? renderRow(activeRows[0]!) : null}
              {Array.from({ length: basis === 'count' && data ? 1 : 2 }, (_, index) => (
                <div key={`empty-${index}`} data-testid={index === 0 ? 'win-rate-unused-slot' : undefined} aria-hidden="true" className="min-h-16 border-t border-border/70" />
              ))}
            </>
          )}
        </div>

        <div data-testid="win-rate-legend" role="group" aria-label={t('dashboard.winRate.legend', 'Legend')} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-success" />
            {t('dashboard.winRate.won', 'Won')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-secondary-foreground/40" />
            {t('dashboard.winRate.lost', 'Lost')}
          </span>
        </div>
      </figure>

      {emptyNote && (
        <p data-testid="win-rate-empty-note" className="mt-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{emptyTitle}.</span>{' '}
          {t('dashboard.winRate.emptySub', 'Try a wider time frame to see your win rate.')}
        </p>
      )}
      {declined > 0 && (
        <p data-testid="win-rate-declined" className="mt-2 text-xs text-muted-foreground">
          {t('dashboard.winRate.declined', '{{n}} declined to bid — not counted in the win rate', { n: declined })}
        </p>
      )}
      {!isPending && !isError && hasOutcomes && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('uxs03.recordedOutcomesOnly', 'Recorded outcomes only; unrecorded decisions are not counted.')}
        </p>
      )}
    </section>
  );
};
