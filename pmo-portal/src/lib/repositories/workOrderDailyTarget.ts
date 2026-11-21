/**
 * repositories/workOrderDailyTarget.ts (#2672) — the seam over the daily target reads and the non-working dates (ADR-0017).
 * Same shape as `workOrderRevenuePlan.ts`: errors keep their Postgres code via `wrap`.
 */
import * as db from '@/src/lib/db/workOrderDailyTarget';
import { wrap } from './repositoryErrors';

export const workOrderDailyTargetRepository = {
  forWorkOrder: (workOrderId: string, asOf?: string | null) => wrap(() => db.getWorkOrderDailyTarget(workOrderId, asOf)),
  forProject: (projectId: string, asOf?: string | null) => wrap(() => db.getProjectDailyTarget(projectId, asOf)),
  nonWorkingDates: () => wrap(() => db.listNonWorkingDates()),
  addNonWorkingDate: (date: string, label: string) => wrap(() => db.addNonWorkingDate(date, label)),
  removeNonWorkingDate: (date: string) => wrap(() => db.removeNonWorkingDate(date)),
};
