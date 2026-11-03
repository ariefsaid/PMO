/**
 * Time-and-materials repository (#1514 T7, ADR-0017): the API seam over the T&M DAL.
 *
 * Thin by design — the 0515-0518 RPCs hold every rule, including who may see an amount and who may confirm a sign-off.
 * The `wrap` normalization only guarantees that a failure arrives as a code-bearing `AppError`.
 */
import * as dal from '@/src/lib/db/timeAndMaterials';
import { wrap } from './repositoryErrors';
import type { TimeAndMaterialsRepository } from './contracts/timeAndMaterials';

export const timeAndMaterialsRepository: TimeAndMaterialsRepository = {
  listRateLines: (projectId, opts) => wrap(() => dal.listRateLines(projectId, opts)),
  listRateAssignees: (projectId) => wrap(() => dal.listRateAssignees(projectId)),
  saveContractRateLine: (input) => wrap(() => dal.saveContractRateLine(input)),
  endContractRateLine: (input) => wrap(() => dal.endContractRateLine(input)),
  setContractRateAssignee: (input) => wrap(() => dal.setContractRateAssignee(input)),
  endContractRateAssignee: (input) => wrap(() => dal.endContractRateAssignee(input)),
  assembleTmClaim: (input) => wrap(() => dal.assembleTmClaim(input)),
  deselectTmSource: (claimId, claimSourceId) => wrap(() => dal.deselectTmSource(claimId, claimSourceId)),
  prepareTmSignoff: (input) => wrap(() => dal.prepareTmSignoff(input)),
  withdrawTmSignoff: (claimId) => wrap(() => dal.withdrawTmSignoff(claimId)),
  confirmTmSignoff: (claimId) => wrap(() => dal.confirmTmSignoff(claimId)),
  listTmClaims: (projectId) => wrap(() => dal.listTmClaims(projectId)),
  previewTmClaim: (input) => wrap(() => dal.previewTmClaim(input)),
  listTmClaimSources: (claimId) => wrap(() => dal.listTmClaimSources(claimId)),
};
