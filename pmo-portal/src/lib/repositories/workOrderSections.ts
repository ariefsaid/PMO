/**
 * repositories/workOrderSections.ts (#2576) — the seam over work-order sections (ADR-0017). Standalone module
 * (same shape as `workOrderFinance.ts`): imported directly by its hooks. Errors keep their Postgres code via `wrap`.
 */
import * as sections from '@/src/lib/db/workOrderSections';
import { setWorkOrderPlan, type PlanChange } from '@/src/lib/db/workOrderFinance';
import { wrap } from './repositoryErrors';

export type { SectionRollupRow, SectionProgressRow, SectionInput, Readiness, ReadinessEvent } from '@/src/lib/db/workOrderSections';
export { READINESS_VALUES } from '@/src/lib/db/workOrderSections';
export type { PlanChange };

export const workOrderSectionRepository = {
  rollup: (workOrderId: string) => wrap(() => sections.listSectionRollup(workOrderId)),
  progress: (workOrderId: string) => wrap(() => sections.listSectionProgress(workOrderId)),
  readiness: (workOrderId: string) => wrap(() => sections.getReadinessCounts(workOrderId)),
  events: (sectionId: string) => wrap(() => sections.listReadinessEvents(sectionId)),
  create: (workOrderId: string, input: sections.SectionInput) => wrap(() => sections.createSection(workOrderId, input)),
  update: (id: string, input: sections.SectionInput) => wrap(() => sections.updateSection(id, input)),
  setReadiness: (id: string, readiness: sections.Readiness, note: string | null) => wrap(() => sections.setSectionReadiness(id, readiness, note)),
  setArchived: (id: string, archived: boolean) => wrap(() => sections.setSectionArchived(id, archived)),
  remove: (id: string) => wrap(() => sections.deleteSection(id)),
  /** Plan figures per section: one transaction through `set_work_order_plan`. */
  setPlan: (projectId: string, workOrderId: string, changes: readonly PlanChange[]) => wrap(() => setWorkOrderPlan(projectId, workOrderId, changes)),
};
