/** Third-party inspection repository (ADR-0017 seam) over the inspection DAL. */
import * as dal from '@/src/lib/db/thirdPartyInspections';
import type { ThirdPartyInspectionRepository } from './contracts/thirdPartyInspections';
import { wrap } from './repositoryErrors';

export const thirdPartyInspectionRepository: ThirdPartyInspectionRepository = {
  listForWorkOrder: (id) => wrap(() => dal.listWorkOrderInspections(id)),
  costs: (id) => wrap(() => dal.getInspectionCosts(id)),
  prerequisites: (id, gate) => wrap(() => dal.getInspectionPrerequisites(id, gate)),
  create: (input) => wrap(() => dal.createInspection(input)),
  raisePurchase: (id, procurementId) => wrap(() => dal.raiseInspectionPurchase(id, procurementId)),
  recordInvitation: (id, on, who, how) => wrap(() => dal.recordInspectionInvitation(id, on, who, how)),
  recordExecution: (id, on) => wrap(() => dal.recordInspectionExecution(id, on)),
  recordReport: (id, result) => wrap(() => dal.recordInspectionReport(id, result)),
  waive: (id, reason) => wrap(() => dal.waiveInspection(id, reason)),
  cancel: (id, reason) => wrap(() => dal.cancelInspection(id, reason)),
  listFilesBatch: (ids) => wrap(() => dal.listInspectionFilesBatch(ids)),
  addFile: (inspection, file, liveCount) => wrap(() => dal.addInspectionFile(inspection, file, liveCount)),
  fileUrl: (path) => wrap(() => dal.getInspectionFileUrl(path)),
};
