import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import {
  SALES_COLUMNS,
  weightedValue,
  type SalesColumn,
} from '../../components/salesPipeline';

/** The five open pipeline columns (Won/Lost excluded — terminal, not forecast). */
export const OPEN_COLUMNS = SALES_COLUMNS.filter((c) => !c.terminal);

/** One currency's share of a stage (or of the whole open pipeline): never summed across currencies. */
export interface CurrencyTotal {
  currency: string;
  total: number;
  weighted: number;
}

export interface StageProjection {
  col: SalesColumn;
  status: string;
  stage: PipelineStage | undefined;
  stageCurrencies: Set<string>;
  stageCurrency: string;
  mixedStage: boolean;
  totalValue: number;
  weightedValue: number;
  barPct: number | undefined;
  /**
   * The stage's deals split by their own currency, from the deal rows already fetched (the stage
   * aggregate is grouped by status only and cannot be split). Used when the stage mixes currencies.
   */
  byCurrency: CurrencyTotal[];
  /** The aggregate has no row for this stage, or its figures are null: unknown, never zero. */
  unavailable: boolean;
}

export interface FunnelProjection {
  openColumns: typeof OPEN_COLUMNS;
  pipelineCurrencies: Set<string>;
  mixedPipeline: boolean;
  /** null when any open stage's weighted figure is unknown (never a partial sum drawn as the total). */
  totalWeighted: number | null;
  maxTotalValue: number;
  /** The open pipeline split by deal currency: the headline figures, one line per currency. */
  byCurrency: CurrencyTotal[];
  stageProjections: StageProjection[];
  effectiveCurrency: string;
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

  // The aggregate lists only stages that hold deals (grouped by status), so a stage it omits is empty:
  // zero is true there. A stage it omits while deal rows sit in that stage, or reports with null
  // figures, is unknown, never zero.
  const isUnavailable = (s: PipelineStage | undefined, statuses: readonly string[]) =>
    s ? s.total_value == null || s.weighted_value == null : currenciesOf(statuses).size > 0;

  const splitByCurrency = (statuses: readonly string[]): CurrencyTotal[] => {
    const byCurrency = new Map<string, CurrencyTotal>();
    for (const p of openProjects) {
      if (!statuses.includes(p.status)) continue;
      const entry = byCurrency.get(p.currency) ?? { currency: p.currency, total: 0, weighted: 0 };
      entry.total += p.contract_value;
      entry.weighted += weightedValue(p);
      byCurrency.set(p.currency, entry);
    }
    return [...byCurrency.values()];
  };

  const anyUnavailable = OPEN_COLUMNS.some((c) => isUnavailable(stageByStatus.get(c.statuses[0]), c.statuses));
  // A one-currency pipeline keeps the aggregate's own figures. A mixed one has no single figure at all:
  // its headline is `byCurrency`, the deal rows split per currency.
  const totalWeighted = mixedPipeline || anyUnavailable
      ? null
      : OPEN_COLUMNS.reduce((sum, c) => sum + (stageByStatus.get(c.statuses[0])?.weighted_value ?? 0), 0);

  const maxTotalValue = Math.max(
    0,
    ...OPEN_COLUMNS.map((c) => stageByStatus.get(c.statuses[0])?.total_value ?? 0),
  );

  const stageProjections: StageProjection[] = OPEN_COLUMNS.map((col) => {
    const s = stageByStatus.get(col.statuses[0]);
    const weighted = s?.weighted_value ?? 0;
    const unavailable = isUnavailable(s, col.statuses);
    const stageCurrencies = currenciesOf(col.statuses);
    const mixedStage = stageCurrencies.size > 1;
    const stageCurrency = stageCurrencies.size === 1 ? [...stageCurrencies][0] : orgCurrency;

    return {
      col,
      status: col.statuses[0],
      stage: s,
      stageCurrencies,
      stageCurrency,
      mixedStage,
      totalValue: s?.total_value ?? 0,
      weightedValue: weighted,
      // ONE scale across the band: the largest stage is the full bar. A stage whose figure is
      // withheld (a mixed pipeline) draws no bar — a bar over a sum the band refuses to print
      // would be a second, invented number.
      byCurrency: splitByCurrency(col.statuses),
      unavailable,
      barPct: mixedPipeline || !s || s.total_value == null || s.count === 0
        ? undefined
        : maxTotalValue > 0
          ? (s.total_value / maxTotalValue) * 100
          : 0,
    };
  });

  const pipelineByCurrency = splitByCurrency(OPEN_COLUMNS.flatMap((c) => c.statuses));

  const effectiveCurrency = pipelineCurrencies.size === 1 ? [...pipelineCurrencies][0] : orgCurrency;

  return {
    openColumns: OPEN_COLUMNS,
    pipelineCurrencies,
    mixedPipeline,
    totalWeighted,
    maxTotalValue,
    byCurrency: pipelineByCurrency,
    stageProjections,
    effectiveCurrency,
  };
}
