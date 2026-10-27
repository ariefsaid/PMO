import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectStatusLabel } from '@/src/hooks/useProjectStatusLabel';
import { Link } from 'react-router';
import { formatDashboardMoney } from '@/src/lib/dashboardMoney';
import { formatCompactCurrency } from '@/src/lib/format';
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
}

/**
 * Pipeline forecast margin: a 30px headline % (the weighted lens) over
 * per-open-stage weighted-value bars. Real data only — headline from the exec
 * payload, bars from `useSalesPipeline().stages` with Won/Lost terminal stages
 * excluded. Each bar direct-labels its weighted value and carries an aria label.
 */
export const ProjectedMarginBars: React.FC<ProjectedMarginBarsProps> = ({ projectedMargin, stages, currency }) => {
  const { t } = useTranslation();
  const money = (value: number) => formatCompactCurrency(value, currency);
  const fullMoney = (value: number) => formatDashboardMoney(value, currency)
    ?? t('uxs03.notAvailableYet', 'Not available yet');
  const statusLabel = useProjectStatusLabel();
  const open = useMemo(
    () => stages.filter((s) => OPEN_STATUSES.has(s.status as string)),
    [stages],
  );
  const max = useMemo(() => Math.max(1, ...open.map((s) => s.weighted_value)), [open]);

  return (
    <div role="group" aria-label={t('dashboard.projectedMargin.group', 'Pipeline projected margin')}>
      {projectedMargin !== null && (
        <div className="mb-3.5 flex items-baseline gap-2.5">
          <span className="min-w-0 break-words text-[30px] font-bold leading-none tracking-[-0.02em] tabular">
            {`${(projectedMargin * 100).toFixed(1)}%`}
          </span>
          <span className="text-xs text-muted-foreground">
            {t('dashboard.projectedMargin.summary', 'probability-adjusted across {{count}} open {{stageNoun}}', { count: open.length, stageNoun: open.length === 1 ? t('dashboard.projectedMargin.stage', 'stage') : t('dashboard.projectedMargin.stages', 'stages') })}
          </span>
        </div>
      )}

      {/* D-1 (AC-JR-W3B-05): each stage row is a Link to /sales?status=<encoded> so
          the exec can drill into that stage's deals directly from the margin card. */}
      <div className="flex flex-col gap-1">
        {open.map((s) => {
          const pct = Math.round((s.weighted_value / max) * 100);
          return (
            <Link
              key={s.status as string}
              to={`/sales?status=${encodeURIComponent(s.status as string)}`}
              aria-label={statusLabel(s.status as string)}
              className="flex items-center gap-2.5 py-[5px] rounded hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
            >
              <span className="w-[88px] shrink-0 text-[12px] text-muted-foreground">{statusLabel(s.status as string)}</span>
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
              <span title={fullMoney(s.weighted_value)} className="min-w-[68px] shrink-0 whitespace-nowrap text-right text-xs font-semibold tabular">
                {money(s.weighted_value)}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
