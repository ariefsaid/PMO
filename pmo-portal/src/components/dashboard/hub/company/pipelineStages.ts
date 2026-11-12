import { SALES_COLUMNS } from '@/components/salesPipeline';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const OPEN_STATUSES = new Set(SALES_COLUMNS.filter((column) => !column.terminal).flatMap((column) => column.statuses));

/** The pipeline stages that are still open (won and lost are not part of the funnel). */
export const openPipelineStages = (stages: PipelineStage[]) => stages.filter((stage) => OPEN_STATUSES.has(stage.status as string));

/** Only compare weighted bars when the whole open pipeline has one currency. */
export function stageCurrencyState(stages: PipelineStage[], projects: ReadonlyArray<{ status: string; currency: string }> | undefined) {
  const open = openPipelineStages(stages);
  const relevant = projects?.filter((p) => open.some((s) => s.status === p.status)) ?? [];
  const currencies = new Set(relevant.map((p) => p.currency));
  const complete = projects !== undefined && open.every((s) => relevant.filter((p) => p.status === s.status).length === s.count);
  return { complete, currencies, forStage: (stage: PipelineStage) => new Set(relevant.filter((p) => p.status === stage.status).map((p) => p.currency)) };
}
