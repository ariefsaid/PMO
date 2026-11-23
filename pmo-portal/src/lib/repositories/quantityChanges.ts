import * as dal from '@/src/lib/db/quantityChanges';
import type { QuantityChangeRepository } from './contracts/quantityChanges';

export const quantityChangeRepository: QuantityChangeRepository = {
  list: dal.listRequests,
  get: dal.getRequest,
  overContract: dal.overContract,
  workOrderBudget: dal.workOrderBudget,
  approvalState: dal.approvalState,
  versions: dal.listVersions,
  raise: dal.raiseRequest,
  updateDraft: dal.updateDraft,
  submit: dal.submitRequest,
  approve: dal.approveRequest,
  returnRequest: dal.returnRequest,
  withdraw: dal.withdrawRequest,
  recordSent: dal.recordSent,
  recordDecision: dal.recordDecision,
  recordForecast: dal.recordForecast,
  getLimit: dal.getLimit,
  setLimit: dal.setLimit,
  getApproverRoles: dal.getApproverRoles,
  setApproverRoles: dal.setApproverRoles,
  uploadFile: dal.uploadFile,
  archiveFile: dal.archiveFile,
  fileUrl: dal.fileUrl,
};
