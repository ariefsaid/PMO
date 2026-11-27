/** repositories/ownerMaterial.ts (#3010) — the seam over owner-supplied material stages (ADR-0017). */
import * as dal from '@/src/lib/db/ownerMaterial';
import { wrap } from './repositoryErrors';

export type { MaterialLine, MaterialRollupRow, Paged, ReconciliationStep, MaterialConfig, MaterialCategory, SectionStage, OrderNumbers } from '@/src/lib/db/ownerMaterial';
export { MATERIAL_PAGE_SIZE } from '@/src/lib/db/ownerMaterial';

export const ownerMaterialRepository = {
  lines: (workOrderId: string, sectionId: string | null, page: number) => wrap(() => dal.listMaterialLines(workOrderId, sectionId, page)),
  rollup: (projectId: string, page: number) => wrap(() => dal.listMaterialRollup(projectId, page)),
  orderNumbers: (ids: string[]) => wrap(() => dal.listOrderNumbers(ids)),
  config: () => wrap(() => dal.getMaterialConfig()),
  sectionStages: (workOrderId: string) => wrap(() => dal.listSectionStages(workOrderId)),
  setReconciliation: (sectionId: string, stepId: string, reason: string | null) => wrap(() => dal.setSectionReconciliation(sectionId, stepId, reason)),
};
