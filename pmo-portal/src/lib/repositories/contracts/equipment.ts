/** Equipment usage repository contract (#1519 S5). One-to-one with the DAL: the RPCs hold every rule. */
import type * as dal from '@/src/lib/db/equipment';

export interface EquipmentRepository {
  listAssets: typeof dal.listAssets;
  createAsset: typeof dal.createAsset;
  updateAsset: typeof dal.updateAsset;
  listUsage: typeof dal.listUsage;
  saveUsage: typeof dal.saveUsage;
  transitionUsage: typeof dal.transitionUsage;
  approveWeek: typeof dal.approveWeek;
  archiveUsage: typeof dal.archiveUsage;
  listUsageTotals: typeof dal.listUsageTotals;
  listCosting: typeof dal.listCosting;
  saveCosting: typeof dal.saveCosting;
  endCosting: typeof dal.endCosting;
  previewCosting: typeof dal.previewCosting;
  listAllocations: typeof dal.listAllocations;
}
