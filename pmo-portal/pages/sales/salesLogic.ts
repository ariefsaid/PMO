import { daysSince, daysSinceLatestTouch, isNeedsAttention, isStaleBid } from '../../components/salesPipeline';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesModel } from './useSalesModel';
import { currencyLineTexts } from '../sales-pipeline/currencyLineTexts';
import type { CurrencyAmount } from '../sales-pipeline/pipelineCurrencySplit';

/** Open value across the open stages, or null when currencies are mixed or a stage total is unknown. */
export function openValueTotal(m: SalesModel): number | null {
  return m.funnel.mixedPipeline ? null : m.funnel.totalOpen;
}

/** Weighted forecast, or null when currencies are mixed or a stage's weighted value is unknown. */
export function weightedTotal(m: SalesModel): number | null {
  return m.funnel.mixedPipeline ? null : m.funnel.totalWeighted;
}

/** A per-currency figure: short lines for the tile, whole-unit lines for hover and screen readers. */
export interface CurrencyLinesFigure { tile: string[]; exact: string[] }

function linesFigure(amounts: CurrencyAmount[] | null, orgCurrency: string): CurrencyLinesFigure | null {
  if (amounts === null || amounts.length === 0) return null;
  const tile = currencyLineTexts(amounts, orgCurrency, 'tile');
  const exact = currencyLineTexts(amounts, orgCurrency, 'table');
  return tile && exact ? { tile, exact } : null;
}

/** #2199: a mixed pipeline's open value, one line per currency; null unless every stage reconciles. */
export const openValueLines = (m: SalesModel): CurrencyLinesFigure | null =>
  m.funnel.mixedPipeline ? linesFigure(m.funnel.openByCurrency, m.orgCurrency) : null;

/** #2199: a mixed pipeline's weighted forecast, one line per currency, under the same condition. */
export const weightedLines = (m: SalesModel): CurrencyLinesFigure | null =>
  m.funnel.mixedPipeline ? linesFigure(m.funnel.weightedByCurrency, m.orgCurrency) : null;

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

