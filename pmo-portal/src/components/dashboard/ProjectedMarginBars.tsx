import React, { useMemo } from 'react';
import { formatCurrency } from '@/src/lib/format';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { SALES_COLUMNS } from '@/components/salesPipeline';
import type { PipelineStage } from '@/src/lib/db/dashboard';

/** Open (non-terminal) statuses + their categorical dot, from the shared model. */
const STAGE_META = SALES_COLUMNS.filter((c) => !c.terminal).flatMap((c) =>
  c.statuses.map((status) => ({ status, color: c.dotColor })),
);
const OPEN_STATUSES = new Set(STAGE_META.map((m) => m.status));
const colorFor = (status: string, i: number) =>
  STAGE_META.find((m) => m.status === status)?.color ??
  chartTheme.categorical[i % chartTheme.categorical.length];

export interface ProjectedMarginBarsProps {
  /** Probability-adjusted portfolio margin (exec RPC, already loaded). */
  projectedMargin: number;
  /** Per-stage weighted breakdown from useSalesPipeline(). */
  stages: PipelineStage[];
}

/**
 * Pipeline — Projected Margin: a 30px headline % (the weighted lens) over
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

      <div className="flex flex-col gap-1">
        {open.map((s, i) => {
          const pct = Math.round((s.weighted_value / max) * 100);
          const color = colorFor(s.status as string, i);
          return (
            <div key={s.status as string} className="flex items-center gap-2.5 py-[5px]">
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
                  style={{ width: `${pct}%`, background: color }}
                />
              </span>
              <span className="w-[68px] shrink-0 text-right text-xs font-semibold tabular">
                {formatCurrency(s.weighted_value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
