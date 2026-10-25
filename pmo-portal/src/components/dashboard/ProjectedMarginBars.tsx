import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { Link } from 'react-router';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { SALES_COLUMNS } from '@/components/salesPipeline';
import type { PipelineStage } from '@/src/lib/db/dashboard';

/** Open (non-terminal) statuses, from the shared sales model. */
const OPEN_STATUSES = new Set(
  SALES_COLUMNS.filter((c) => !c.terminal).flatMap((c) => c.statuses),
);
/**
 * Batch-3 polish: weighted-value bars are quiet indicators, not the page's primary
 * action. Use the neutral chart tone so the track+fill read as measurement, not CTA.
 */
const BAR_FILL = chartTheme.axis;

export interface ProjectedMarginBarsProps {
  /** Probability-adjusted portfolio margin (exec RPC, already loaded). */
  projectedMargin: number | null;
  /** Per-stage weighted breakdown from useSalesPipeline(). */
  stages: PipelineStage[];
  /** Org operating currency (pipeline stages are RPC-shaped, no per-row currency) — FR-L10N-020. */
  currency: string;
  /** Currency-separated totals avoid combining values with incomparable units. */
  currencyTotals?: Array<{
    currency: string;
    weightedValue: number | null;
    grossValue: number | null;
    forecastMargin: number | null;
  }>;
  /** Stage rows are unavailable when the sales aggregate spans multiple currencies. */
  allowStageBars?: boolean;
}

/**
 * Pipeline forecast margin: a 30px headline % (the weighted lens) over
 * per-open-stage weighted-value bars. Real data only — headline from the exec
 * payload, bars from `useSalesPipeline().stages` with Won/Lost terminal stages
 * excluded. Each bar direct-labels its weighted value and carries an aria label.
 */
export const ProjectedMarginBars: React.FC<ProjectedMarginBarsProps> = ({
  projectedMargin,
  stages,
  currency,
  currencyTotals = [],
  allowStageBars = true,
}) => {
  const { t } = useTranslation();
  const fullMoney = (value: number) => formatDashboardMoney(value, currency)
    ?? t('uxs03.notAvailableYet', 'Not available yet');
  const statusLabel = useProjectStatusLabel();
  const open = useMemo(
    () => allowStageBars ? stages.filter((s) => OPEN_STATUSES.has(s.status as string)) : [],
    [allowStageBars, stages],
  );
  const max = useMemo(() => Math.max(1, ...open.map((s) => s.weighted_value)), [open]);

  return (
    <div role="group" aria-label={t('dashboard.projectedMargin.group', 'Pipeline projected margin')} className="space-y-4">
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-semibold">{t('dashboard.chart.pipelineMargin.title', 'Pipeline forecast margin')}</h3>
        {projectedMargin !== null ? (
          <p className="mt-1 text-xl font-semibold tabular">{`${(projectedMargin * 100).toFixed(1)}%`}</p>
        ) : currencyTotals.length > 0 ? (
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            {currencyTotals.map((row) => (
              <div key={`margin-${row.currency}`} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">{row.currency}</dt>
                <dd className="text-sm font-semibold tabular">
                  {row.forecastMargin === null ? <a href="#executive-data-note">—</a> : `${(row.forecastMargin * 100).toFixed(1)}%`}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">—</p>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {currencyTotals.map((row) => (
          <React.Fragment key={`totals-${row.currency}`}>
            <div>
              <dt className="text-xs text-muted-foreground">{t('dashboard:exec.weightedPipeline', 'Weighted pipeline')} · {row.currency}</dt>
              <dd className="mt-0.5 font-semibold tabular">
                {row.weightedValue === null ? <a href="#executive-data-note">—</a> : formatDashboardMoney(row.weightedValue, row.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('dashboard:exec.grossPipeline', 'Gross pipeline')} · {row.currency}</dt>
              <dd className="mt-0.5 font-semibold tabular">
                {row.grossValue === null ? <a href="#executive-data-note">—</a> : formatDashboardMoney(row.grossValue, row.currency)}
              </dd>
            </div>
          </React.Fragment>
        ))}
      </dl>

      {/* D-1 (AC-JR-W3B-05): each stage row is a Link to /sales?status=<encoded> so
          the exec can drill into that stage's deals directly from the margin card. */}
      {!allowStageBars && (
        <p className="text-sm text-muted-foreground">{t('dashboard:exec.stageValuesMixedCurrency', 'Stage values cannot be compared across currencies.')}</p>
      )}
      {allowStageBars && open.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('dashboard.projectedMargin.emptyStages', 'No open pipeline stages')}</p>
      )}
      <div className="flex flex-col divide-y divide-border/70">
        {open.map((s) => {
          const pct = Math.round((s.weighted_value / max) * 100);
          return (
            <Link
              key={s.status as string}
              to={`/sales?status=${encodeURIComponent(s.status as string)}`}
              aria-label={statusLabel(s.status as string)}
              className="flex min-h-11 min-w-0 items-center gap-2.5 py-2 hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <span className="min-w-20 max-w-[9rem] shrink-0 text-[12px] text-muted-foreground">{statusLabel(s.status as string)}</span>
              <span
                role="progressbar"
                aria-label={t('dashboard.projectedMargin.barLabel', '{{stage}}: {{value}} weighted', { stage: statusLabel(s.status as string), value: fullMoney(s.weighted_value) })}
                aria-valuenow={s.weighted_value}
                aria-valuemin={0}
                aria-valuemax={max}
                className="h-[9px] flex-1 overflow-hidden rounded-full bg-secondary"
              >
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${pct}%`, background: BAR_FILL }}
                />
              </span>
              <span className="min-w-[6rem] shrink-0 whitespace-nowrap text-right text-xs font-semibold tabular">
                {fullMoney(s.weighted_value)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
