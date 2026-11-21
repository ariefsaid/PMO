import * as dal from '@/src/lib/db/workOrderCandidates';
import type { WorkOrderCandidateRepository } from './contracts/workOrderCandidates';

export const workOrderCandidateRepository: WorkOrderCandidateRepository = {
  list: dal.listCandidates,
  listTemplate: dal.listTemplate,
  saveTemplate: dal.saveTemplate,
  create: dal.createCandidate,
  decide: dal.decideCandidate,
  updateItem: dal.updateItem,
  addItem: dal.addItem,
  uploadProof: dal.uploadProof,
  archiveProof: dal.archiveProof,
  proofUrl: dal.proofUrl,
};
