import { daysSince, daysSinceLatestTouch, isNeedsAttention, isStaleBid } from '../../components/salesPipeline';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesModel } from './useSalesModel';

/** Open value across the open stages, or null when currencies are mixed or a stage total is unknown. */
export function openValueTotal(m: SalesModel): number | null {
  return m.funnel.mixedPipeline ? null : m.funnel.totalOpen;
}

/** Weighted forecast, or null when currencies are mixed or a stage's weighted value is unknown. */
export function weightedTotal(m: SalesModel): number | null {
  return m.funnel.mixedPipeline ? null : m.funnel.totalWeighted;
}

/** Why a pipeline figure is hidden: mixed currencies, else a stage figure missing from the totals. */
export const figureReason = (m: SalesModel): string => m.funnel.mixedPipeline
  ? m.t('sales:pipeline.mixedCurrency', 'Mixed currencies')
  : m.t('sales:pipeline.stageMissing', 'Stage figure missing');

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

