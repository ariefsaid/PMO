import type { PipelineProject, PipelineStage } from '@/src/lib/db/dashboard';
import {
  SALES_COLUMNS,
  type SalesColumn,
} from '../../components/salesPipeline';

/** The five open pipeline columns (Won/Lost excluded — terminal, not forecast). */
export const OPEN_COLUMNS = SALES_COLUMNS.filter((c) => !c.terminal);

export interface StageProjection {
  col: SalesColumn;
  status: string;
  stage: PipelineStage | undefined;
  stageCurrencies: Set<string>;
  stageCurrency: string;
  mixedStage: boolean;
  totalValue: number;
  weightedValue: number;
  winProbability: number | undefined;
  barPct: number | undefined;
}

export interface FunnelProjection {
  openColumns: typeof OPEN_COLUMNS;
  pipelineCurrencies: Set<string>;
  mixedPipeline: boolean;
  totalWeighted: number;
  maxWeighted: number;
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

  const totalWeighted = OPEN_COLUMNS.reduce(
    (sum, c) => sum + (stageByStatus.get(c.statuses[0])?.weighted_value ?? 0),
    0,
  );

  const maxWeighted = Math.max(
    0,
    ...OPEN_COLUMNS.map((c) => stageByStatus.get(c.statuses[0])?.weighted_value ?? 0),
  );

  const stageProjections: StageProjection[] = OPEN_COLUMNS.map((col) => {
    const s = stageByStatus.get(col.statuses[0]);
    const weighted = s?.weighted_value ?? 0;
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
      winProbability: s?.win_probability,
      barPct: mixedPipeline ? undefined : maxWeighted > 0 ? (weighted / maxWeighted) * 100 : 0,
    };
  });

  const effectiveCurrency = pipelineCurrencies.size === 1 ? [...pipelineCurrencies][0] : orgCurrency;

  return {
    openColumns: OPEN_COLUMNS,
    pipelineCurrencies,
    mixedPipeline,
    totalWeighted,
    maxWeighted,
    stageProjections,
    effectiveCurrency,
  };
}
