/** repositories/workOrderMaterialProgress.ts (#2674) — the seam over the issued-versus-progress read and its threshold (ADR-0017). */
import { getWorkOrderIssueThreshold, getWorkOrderMaterialProgress, setWorkOrderIssueThreshold, type MaterialProgress, type MaterialProgressItem } from '@/src/lib/db/workOrderMaterialProgress';
import { wrap } from './repositoryErrors';

export type { MaterialProgress, MaterialProgressItem };

export const workOrderMaterialProgressRepository = {
  get: (workOrderId: string) => wrap(() => getWorkOrderMaterialProgress(workOrderId)),
  threshold: () => wrap(() => getWorkOrderIssueThreshold()),
  setThreshold: (thresholdPct: number | null) => wrap(() => setWorkOrderIssueThreshold(thresholdPct)),
};
