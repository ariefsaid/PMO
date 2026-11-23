/**
 * repositories/equipmentPlans.ts (#2700) — the seam over the monthly equipment and service plan (ADR-0017). Standalone
 * module imported directly by its consumers. Rules live in the database; errors keep their Postgres code via `wrap`.
 */
import * as dal from '@/src/lib/db/equipmentPlans';
import { wrap } from './repositoryErrors';

export type { PlanSettings, PlanCategory, PlanCategoryInput, PlanLine, PlanLineInput, EquipmentPlan, PlanStatus, ApprovalStep,
  PlanRouteKind, PlanApprover, PlanApprovalRoute } from '@/src/lib/db/equipmentPlans';
export { monthStart, monthEnd, planTotal } from '@/src/lib/db/equipmentPlans';

export const equipmentPlanRepository = {
  settings: () => wrap(() => dal.getPlanSettings()),
  setSettings: (s: dal.PlanSettings) => wrap(() => dal.setPlanSettings(s)),
  categories: () => wrap(() => dal.listPlanCategories()),
  upsertCategory: (i: dal.PlanCategoryInput) => wrap(() => dal.upsertPlanCategory(i)),
  setCategoryActive: (id: string, active: boolean) => wrap(() => dal.setPlanCategoryActive(id, active)),
  plansForMonth: (month: string) => wrap(() => dal.listPlansForMonth(month)),
  save: (i: Parameters<typeof dal.savePlan>[0]) => wrap(() => dal.savePlan(i)),
  submit: (id: string) => wrap(() => dal.submitPlan(id)),
  reopen: (id: string) => wrap(() => dal.reopenPlan(id)),
  approve: (id: string) => wrap(() => dal.approvePlan(id)),
  reject: (id: string, reason: string) => wrap(() => dal.rejectPlan(id, reason)),
  canApprove: (id: string) => wrap(() => dal.canApprovePlan(id)),
  /** DISPLAY ONLY: who a Submitted plan waits for, from the database's own route (1565). */
  route: (id: string) => wrap(() => dal.getPlanApprovalRoute(id)),
};
