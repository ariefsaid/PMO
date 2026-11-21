/**
 * repositories/workOrderSectionMaterials.ts (#2576) — the seam over per-section material allocations and checks (ADR-0017).
 * The cap, the archived-section rule and the over-plan reason are enforced by the database (1099).
 */
import * as dal from '@/src/lib/db/workOrderSectionMaterials';
import { wrap } from './repositoryErrors';

export type { SectionOption, SectionLinePlan, SectionAllocation, MaterialCheckRow } from '@/src/lib/db/workOrderSectionMaterials';

export const workOrderSectionMaterialRepository = {
  liveSections: (workOrderId: string) => wrap(() => dal.listLiveSections(workOrderId)),
  linePlans: (workOrderId: string, sectionId: string, itemIds: string[], excludeRequestId?: string | null) =>
    wrap(() => dal.getSectionLinePlans(workOrderId, sectionId, itemIds, excludeRequestId)),
  allocations: (workOrderId: string) => wrap(() => dal.listAllocations(workOrderId)),
  setAllocation: (workOrderId: string, sectionId: string, itemId: string, quantity: string | null) =>
    wrap(() => dal.setAllocation(workOrderId, sectionId, itemId, quantity)),
  check: (workOrderId: string) => wrap(() => dal.getMaterialCheck(workOrderId)),
};
