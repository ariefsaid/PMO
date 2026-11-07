import { daysSince, isNeedsAttention, isStaleBid } from '../../../components/salesPipeline';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesModel } from './useSalesModel';

/** Open value across the open stages, or null when currencies are mixed (no single total). */
export function openValueTotal(m: SalesModel): number | null {
  return m.funnel.mixedPipeline ? null : m.funnel.stageProjections.reduce((s, p) => s + p.totalValue, 0);
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
  const stale = isStaleBid(p);
  const days = stale ? daysSince(p.stage_started_at) : daysSince(p.last_update);
  return stale
    ? m.t('sales:options.staleReason', 'In {{stage}} for {{days}} days', { stage: m.stageName(p.status), days: days ?? 0 })
    : m.t('sales:options.idleReason', 'Untouched for {{days}} days', { days: days ?? 0 });
};

