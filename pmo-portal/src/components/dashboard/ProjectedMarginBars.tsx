import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/src/lib/format';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { SALES_COLUMNS } from '@/components/salesPipeline';
import type { PipelineStage } from '@/src/lib/db/dashboard';

/** Open (non-terminal) statuses, from the shared sales model. */
const OPEN_STATUSES = new Set(
  SALES_COLUMNS.filter((c) => !c.terminal).flatMap((c) => c.statuses),
);
/**
 * C1 de-rainbow: every bar uses the single `primary` token. These bars measure
 * weighted value, not status — so color need not vary; the per-stage `<span>`
 * label already gives each bar its identity (color-not-only). This removes the
 * categorical/violet rainbow the audit flagged on the PQ bar.
 */
const BAR_FILL = chartTheme.series.primary;

export interface ProjectedMarginBarsProps {
  /** Probability-adjusted portfolio margin (exec RPC, already loaded). */
  projectedMargin: number;
  /** Per-stage weighted breakdown from useSalesPipeline(). */
  stages: PipelineStage[];
}

/**
 * Pipeline forecast margin: a 30px headline % (the weighted lens) over
 * per-open-stage weighted-value bars. Real data only — headline from the exec
 * payload, bars from `useSalesPipeline().stages` with Won/Lost terminal stages
 * excluded. Each bar direct-labels its weighted value and carries an aria label.
 */
export const ProjectedMarginBars: React.FC<ProjectedMarginBarsProps> = ({ projectedMargin, stages }) => {
  const open = useMemo(
    () => stages.filter((s) => OPEN_STATUSES.has(s.status as string)),
    [stages],
  );
  const max = useMemo(() => Math.max(1, ...open.map((s) => s.weighted_value)), [open]);

  return (
    <div role="group" aria-label="Pipeline projected margin">
      <div className="mb-3.5 flex items-baseline gap-2.5">
        <span className="text-[30px] font-bold leading-none tracking-[-0.02em] tabular">
          {(projectedMargin * 100).toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">
          probability-adjusted across {open.length} open {open.length === 1 ? 'stage' : 'stages'}
        </span>
      </div>

      {/* D-1 (AC-JR-W3B-05): each stage row is a Link to /sales?status=<encoded> so
          the exec can drill into that stage's deals directly from the margin card. */}
      <div className="flex flex-col gap-1">
        {open.map((s) => {
          const pct = Math.round((s.weighted_value / max) * 100);
          return (
            <Link
              key={s.status as string}
              to={`/sales?status=${encodeURIComponent(s.status as string)}`}
              aria-label={`${s.status as string}`}
              className="flex items-center gap-2.5 py-[5px] rounded hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <span className="w-[88px] shrink-0 text-[12px] text-muted-foreground">{s.status}</span>
              <span
                role="progressbar"
                aria-label={`${s.status}: ${formatCurrency(s.weighted_value)} weighted`}
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
              <span className="w-[68px] shrink-0 text-right text-xs font-semibold tabular">
                {formatCurrency(s.weighted_value)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
