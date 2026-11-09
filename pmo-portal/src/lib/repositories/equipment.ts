/** Equipment usage repository (#1519 S5, ADR-0017): the API seam over the equipment DAL. Thin by design — the RPCs hold
 *  every rule, including who may see an amount. */
import * as dal from '@/src/lib/db/equipment';
import { wrap } from './repositoryErrors';
import type { EquipmentRepository } from './contracts/equipment';

export const equipmentRepository: EquipmentRepository = {
  listAssets: () => wrap(() => dal.listAssets()),
  createAsset: (input) => wrap(() => dal.createAsset(input)),
  updateAsset: (id, patch) => wrap(() => dal.updateAsset(id, patch)),
  deleteAsset: (id) => wrap(() => dal.deleteAsset(id)),
  listUsage: (range) => wrap(() => dal.listUsage(range)),
  saveUsage: (input) => wrap(() => dal.saveUsage(input)),
  transitionUsage: (id, to, notes) => wrap(() => dal.transitionUsage(id, to, notes)),
  approveWeek: (assetId, weekStart) => wrap(() => dal.approveWeek(assetId, weekStart)),
  archiveUsage: (id) => wrap(() => dal.archiveUsage(id)),
  listUsageTotals: (q) => wrap(() => dal.listUsageTotals(q)),
  listCosting: (includeHistory) => wrap(() => dal.listCosting(includeHistory)),
  saveCosting: (draft) => wrap(() => dal.saveCosting(draft)),
  endCosting: (settingKey, effectiveTo, expectedVersion) => wrap(() => dal.endCosting(settingKey, effectiveTo, expectedVersion)),
  previewCosting: (draft) => wrap(() => dal.previewCosting(draft)),
  listAllocations: (q) => wrap(() => dal.listAllocations(q)),
  listRegister: () => wrap(() => dal.listRegister()),
  listMaintenance: (ref) => wrap(() => dal.listMaintenance(ref)),
  listPickers: (kind) => wrap(() => dal.listPickers(kind)),
  listPendingChanges: (recordIds) => wrap(() => dal.listPendingChanges(recordIds)),
  listAssetMatches: () => wrap(() => dal.listAssetMatches()),
  acceptAssetMatches: (pairs) => wrap(() => dal.acceptAssetMatches(pairs)),
  sendEquipmentCommand: (operation, record, idempotencyKey) => wrap(() => dal.sendEquipmentCommand(operation, record, idempotencyKey)),
};
