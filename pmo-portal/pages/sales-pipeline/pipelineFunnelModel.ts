import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import {
  SALES_COLUMNS,
  type SalesColumn,
} from '../../components/salesPipeline';
import { splitStageByCurrency, sumByCurrency, type CurrencyAmount, type StageCurrencySplit } from './pipelineCurrencySplit';

/** The five open pipeline columns (Won/Lost excluded — terminal, not forecast). */
export const OPEN_COLUMNS = SALES_COLUMNS.filter((c) => !c.terminal);

export interface StageProjection {
  col: SalesColumn;
  status: string;
  stage: PipelineStage | undefined;
  stageCurrencies: Set<string>;
  stageCurrency: string;
  mixedStage: boolean;
  /** Null when unknown: the aggregate lacks a stage that holds deals (#2199). Never read as 0. */
  totalValue: number | null;
  /** Null when unknown: as above, or the aggregate's weighted value is null. */
  weightedValue: number | null;
  barPct: number | undefined;
  /** The stage's figures per currency from its deals (#2199); null parts when they do not reconcile. */
  split: StageCurrencySplit;
}

export interface FunnelProjection {
  openColumns: typeof OPEN_COLUMNS;
  pipelineCurrencies: Set<string>;
  mixedPipeline: boolean;
  /** Null when any open stage's weighted value is unknown. */
  totalWeighted: number | null;
  /** Open value across the open stages; null when any stage total is unknown. */
  totalOpen: number | null;
  /** Open value per currency across the open stages (#2199); null unless every stage's split reconciles. */
  openByCurrency: CurrencyAmount[] | null;
  /** Weighted forecast per currency, under the same condition. */
  weightedByCurrency: CurrencyAmount[] | null;
  maxTotalValue: number;
  stageProjections: StageProjection[];
  effectiveCurrency: string;
  /** The organisation currency: it leads every per-currency figure. */
  orgCurrency: string;
}

/**
 * Pure model computing currency-safe stage projections and totals (THEME-CROSS-76).
 * Mixed-currency suppression: if multiple currencies exist across the pipeline or within a stage,
 * sums across unlike currencies are suppressed to avoid fabricating invalid totals.
 */
export function projectFunnelModel(
  stages: PipelineStage[],
  openProjects: PipelineProject[],
  orgCurrency: string,
): FunnelProjection {
  const stageByStatus = new Map(stages.map((s) => [s.status as string, s]));

  const currenciesOf = (statuses: readonly string[]) =>
    new Set(openProjects.filter((p) => statuses.includes(p.status)).map((p) => p.currency));

  const pipelineCurrencies = currenciesOf(OPEN_COLUMNS.flatMap((c) => c.statuses));
  const mixedPipeline = pipelineCurrencies.size > 1;

  // The aggregate omits a stage with no deals, so a missing stage is a real zero, unless the deal
  // list holds deals in it: then its figures are unknown, never 0.
  const figuresOf = (col: SalesColumn) => {
    const s = stageByStatus.get(col.statuses[0]);
    if (!s) {
      const unknown = openProjects.some((p) => col.statuses.includes(p.status));
      return unknown ? { totalValue: null, weightedValue: null } : { totalValue: 0, weightedValue: 0 };
    }
    const known = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? (s.count === 0 ? 0 : null) : v);
    return { totalValue: known(s.total_value), weightedValue: known(s.weighted_value) };
  };
  const figures = OPEN_COLUMNS.map(figuresOf);
  const sumKnown = (values: Array<number | null>) =>
    values.some((v) => v === null) ? null : values.reduce<number>((sum, v) => sum + (v ?? 0), 0);

  const totalWeighted = sumKnown(figures.map((f) => f.weightedValue));
  const totalOpen = sumKnown(figures.map((f) => f.totalValue));

  const maxTotalValue = Math.max(0, ...figures.map((f) => f.totalValue ?? 0));

  const stageProjections: StageProjection[] = OPEN_COLUMNS.map((col, i) => {
    const s = stageByStatus.get(col.statuses[0]);
    const { totalValue, weightedValue } = figures[i];
    const stageCurrencies = currenciesOf(col.statuses);
    const mixedStage = stageCurrencies.size > 1;
    const split = splitStageByCurrency(s, openProjects.filter((p) => col.statuses.includes(p.status)), orgCurrency);
    const stageCurrency = stageCurrencies.size === 1 ? [...stageCurrencies][0] : orgCurrency;

    return {
      col,
      status: col.statuses[0],
      stage: s,
      stageCurrencies,
      stageCurrency,
      mixedStage,
      totalValue,
      weightedValue,
      // ONE scale across the band: the largest stage is the full bar. A stage whose figure is
      // withheld (a mixed pipeline) draws no bar — a bar over a sum the band refuses to print
      // would be a second, invented number.
      barPct: mixedPipeline || !s || s.count === 0 || totalValue === null
        ? undefined
        : maxTotalValue > 0
          ? (totalValue / maxTotalValue) * 100
          : 0,
      split,
    };
  });

  const effectiveCurrency = pipelineCurrencies.size === 1 ? [...pipelineCurrencies][0] : orgCurrency;

  return {
    openColumns: OPEN_COLUMNS,
    pipelineCurrencies,
    mixedPipeline,
    totalWeighted,
    totalOpen,
    openByCurrency: sumByCurrency(stageProjections.map((p) => p.split.totals), orgCurrency),
    weightedByCurrency: sumByCurrency(stageProjections.map((p) => p.split.weighted), orgCurrency),
    maxTotalValue,
    stageProjections,
    effectiveCurrency,
    orgCurrency,
  };
}
