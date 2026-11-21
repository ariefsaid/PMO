/**
 * repositories/workOrderRevenuePlan.ts (#2671) — the seam over the dated revenue plan (ADR-0017). Standalone module
 * (same shape as `workOrderFinance.ts`): errors keep their Postgres code via `wrap`.
 */
import * as db from '@/src/lib/db/workOrderRevenuePlan';
import { wrap } from './repositoryErrors';

export type { RevenuePlanSettings } from '@/src/lib/db/workOrderRevenuePlan';

export const workOrderRevenuePlanRepository = {
  settings: () => wrap(() => db.getRevenuePlanSettings()),
  setSettings: (enabled: boolean, weekdays: number[]) => wrap(() => db.setRevenuePlanSettings(enabled, weekdays)),
  forWorkOrder: (workOrderId: string, asOf?: string) => wrap(() => db.getWorkOrderRevenuePlan(workOrderId, asOf)),
  forProject: (projectId: string, asOf?: string) => wrap(() => db.getProjectRevenuePlan(projectId, asOf)),
  setDay: (workOrderId: string, date: string, amount: string) => wrap(() => db.setPlanDay(workOrderId, date, amount)),
  setMonth: (workOrderId: string, month: string, amount: string, keepEdited: boolean) => wrap(() => db.setPlanMonth(workOrderId, month, amount, keepEdited)),
  clear: (workOrderId: string, from: string, to: string) => wrap(() => db.clearPlan(workOrderId, from, to)),
};
