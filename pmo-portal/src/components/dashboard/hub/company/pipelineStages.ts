import { SALES_COLUMNS } from '@/components/salesPipeline';
import type { PipelineStage } from '@/src/lib/db/dashboard';

const OPEN_STATUSES = new Set(SALES_COLUMNS.filter((column) => !column.terminal).flatMap((column) => column.statuses));

/** The pipeline stages that are still open (won and lost are not part of the funnel). */
export const openPipelineStages = (stages: PipelineStage[]) => stages.filter((stage) => OPEN_STATUSES.has(stage.status as string));
