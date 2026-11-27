import { daysSince, daysSinceLatestTouch, isNeedsAttention, isStaleBid } from '../../components/salesPipeline';
import { formatMoneyLines } from '@/src/lib/format';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesModel } from './useSalesModel';

export interface FigureLines {
  /** One short tile figure per currency, the organisation's currency first. */
  lines: string[];
  /** The same figures as whole units, for hover and screen readers; same order. */
  exact: string[];
}

/**
 * The page's two headline figures. One currency in the open pipeline: one figure each. Two or more:
 * the organisation's currency is the figure and every other currency sits on a line of its own ("+ USD 5.3K"),
 * never summed. `weighted` is null when a stage's forecast is not reported (unknown, never a zero).
 */
export function pipelineFigures(m: SalesModel): { open: FigureLines | null; weighted: FigureLines | null } {
  const { funnel } = m;
  const home = funnel.effectiveCurrency;
  const lines = (totals: Array<{ currency: string; amount: number }>): FigureLines => ({
    lines: formatMoneyLines(totals, home, 'tile').lines,
    exact: formatMoneyLines(totals, home, 'table').lines,
  });
  if (funnel.mixedPipeline) {
    return {
      open: lines(funnel.byCurrency.map((c) => ({ currency: c.currency, amount: c.total }))),
      weighted: lines(funnel.byCurrency.map((c) => ({ currency: c.currency, amount: c.weighted }))),
    };
  }
  const open = funnel.stageProjections.some((p) => p.stage ? p.stage.total_value == null : p.unavailable) ? null : lines([{ currency: home, amount: funnel.stageProjections.reduce((s, p) => s + p.totalValue, 0) }]);
  return {
    open,
    weighted: funnel.totalWeighted === null ? null : lines([{ currency: home, amount: funnel.totalWeighted }]),
  };
}

/** Open deals that need a look: untouched 30+ days or in one stage 90+ days; longest first. */
export function attentionDeals(m: SalesModel): PipelineProject[] {
  const idle = (p: PipelineProject) => Math.max(daysSince(p.last_update) ?? 0, daysSince(p.stage_started_at) ?? 0);
  return m.openProjects
    .filter((p) => isNeedsAttention(p) || isStaleBid(p))
    .sort((a, b) => idle(b) - idle(a));
}

export const dash = '—';

/** Why a deal is in the attention list, in words. */
export const attentionReason = (m: SalesModel, p: PipelineProject): string => {
  const { t } = m;
  const stale = isStaleBid(p);
  const days = stale ? daysSince(p.stage_started_at) : daysSinceLatestTouch(p);
  return stale
    ? t('sales:options.staleReason', 'In {{stage}} for {{days}} days', { stage: m.stageName(p.status), days: days ?? dash })
    : t('sales:options.idleReason', 'Untouched for {{days}} days', { days: days ?? dash });
};

