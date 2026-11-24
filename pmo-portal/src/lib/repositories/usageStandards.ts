/**
 * repositories/usageStandards.ts (#2577) — the seam over consumable usage standards and the work-order consumable plan
 * (ADR-0017). Standalone module (the `materialRequests.ts` shape). Every rule is enforced by the database (1075/1076);
 * errors keep their Postgres code via `wrap`, and `consumablePlanRefusal` turns a refusal into a stable key.
 */
import * as dal from '@/src/lib/db/usageStandards';
import { wrap } from './repositoryErrors';

export type {
  UsageStandardRow, UsageStandardInput, UsageStandardFilter, ConsumablePlan, ConsumablePlanApproval, ConsumablePlanLine, ConsumablePlanBasis,
  UnplannedItem, NoStandardLine, ConsumablePlanSource,
} from '@/src/lib/db/usageStandards';
export { consumablePlanRefusal, USAGE_STANDARDS_PAGE_SIZE } from '@/src/lib/db/usageStandards';

export const usageStandardRepository = {
  list: (f: dal.UsageStandardFilter) => wrap(() => dal.listUsageStandards(f)),
  matchCounts: () => wrap(() => dal.getStandardMatchCounts()),
  create: (i: dal.UsageStandardInput) => wrap(() => dal.createUsageStandard(i)),
  update: (id: string, i: dal.UsageStandardInput) => wrap(() => dal.updateUsageStandard(id, i)),
  setArchived: (id: string, archived: boolean) => wrap(() => dal.setUsageStandardArchived(id, archived)),
  plan: (workOrderId: string) => wrap(() => dal.getConsumablePlan(workOrderId)),
  planInputs: (workOrderId: string) => wrap(() => dal.getPlanInputs(workOrderId)),
  generate: (workOrderId: string) => wrap(() => dal.generateConsumablePlan(workOrderId)),
  adjust: (a: { workOrderId: string; itemId: string; adjustedQty: string | null; reason: string | null }) => wrap(() => dal.adjustConsumablePlanLine(a)),
  approve: (workOrderId: string) => wrap(() => dal.approveConsumablePlan(workOrderId)),
};
