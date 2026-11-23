/**
 * repositories/workOrderDashboard.ts (#2805) — the seam over the work-order dashboard's org-wide reads (ADR-0017).
 * Standalone module, like `workOrderFinance.ts`. Errors keep their Postgres code via `wrap`.
 */
import { listAllConfirmedAcceptances, listAllocatedBoqItems, listAllWorkOrderLines } from '@/src/lib/db/workOrderDashboard';
import { listAllWorkOrderBilling } from '@/src/lib/db/workOrderBilling';
import { wrap } from './repositoryErrors';

export const workOrderDashboardRepository = {
  lines: () => wrap(() => listAllWorkOrderLines()),
  items: () => wrap(() => listAllocatedBoqItems()),
  acceptances: () => wrap(() => listAllConfirmedAcceptances()),
  billing: () => wrap(() => listAllWorkOrderBilling()),
};
