/**
 * repositories/materialRequests.ts (#2524) — the seam over material requests (ADR-0017). Standalone module (the
 * `workOrderCosts.ts` shape): imported directly by its consumers. Every rule is enforced by the database RPCs;
 * errors keep their Postgres code via `wrap`, and `materialRequestRefusal` turns the message into a stable key.
 */
import * as dal from '@/src/lib/db/materialRequests';
import { wrap } from './repositoryErrors';

export type {
  MaterialRequestStatus, StepStatus, StepDecision, MaterialRequestHeader, MaterialRequestLineInput, MaterialRequestRow,
  MaterialRequestLine, MaterialRequestStep, MaterialRequestEvent, MaterialRequestDetail, WaitingStep, ChainStep,
  ChainStepInput, StandIn, StepPin, LinePlan, PlanSource, UsageThresholds, UsageWarning, MaterialRequestFilter, MaterialRequestRefusal, DraftLineError,
} from '@/src/lib/db/materialRequests';
export { linePlanStatus, lineUsageWarning, parseUsageThresholds, draftLineErrors, materialRequestRefusal, MATERIAL_REQUEST_PAGE_SIZE } from '@/src/lib/db/materialRequests';

export const materialRequestRepository = {
  list: (f: dal.MaterialRequestFilter) => wrap(() => dal.listMaterialRequests(f)),
  get: (id: string) => wrap(() => dal.getMaterialRequest(id)),
  waitingForMe: () => wrap(() => dal.listWaitingForMe()),
  linePlans: (workOrderId: string, itemIds: string[], excludeRequestId?: string | null) =>
    wrap(() => dal.getLinePlans(workOrderId, itemIds, excludeRequestId)),
  saveDraft: (id: string | null, header: dal.MaterialRequestHeader, lines: dal.MaterialRequestLineInput[], clientRequestId?: string) =>
    wrap(() => dal.saveMaterialRequestDraft(id, header, lines, clientRequestId)),
  submit: (id: string, clientRequestId?: string) => wrap(() => dal.submitMaterialRequest(id, clientRequestId)),
  decideStep: (id: string, stepPosition: number, decision: dal.StepDecision, opts?: { reason?: string | null; sourceWarehouseId?: string | null }) =>
    wrap(() => dal.decideMaterialRequestStep(id, stepPosition, decision, opts)),
  cancel: (id: string, reason?: string | null) => wrap(() => dal.cancelMaterialRequest(id, reason)),
  retryTransfer: (id: string, sourceWarehouseId: string) => wrap(() => dal.retryMaterialRequestTransfer(id, sourceWarehouseId)),
  chain: () => wrap(() => dal.listApprovalChain()),
  setChain: (steps: dal.ChainStepInput[]) => wrap(() => dal.setApprovalChain(steps)),
  cutoff: () => wrap(() => dal.getMaterialRequestCutoff()),
  setCutoff: (cutoff: string | null) => wrap(() => dal.setMaterialRequestCutoff(cutoff)),
  usageThresholds: () => wrap(() => dal.getUsageThresholds()),
  setUsageThresholds: (th: dal.UsageThresholds) => wrap(() => dal.setUsageThresholds(th)),
  approverInbox: () => wrap(() => dal.getApproverInboxSetting()),
  setApproverInbox: (on: boolean) => wrap(() => dal.setApproverInboxSetting(on)),
  standIns: () => wrap(() => dal.listStandIns()),
  setStandIn: (s: { delegatorId: string; standInId: string; startsOn: string; endsOn: string }) => wrap(() => dal.setStandIn(s)),
  stepPins: (projectId: string) => wrap(() => dal.listStepPins(projectId)),
  setStepPin: (projectId: string, position: number, approverId: string | null) => wrap(() => dal.setStepPin(projectId, position, approverId)),
  revokeStandIn: (id: string) => wrap(() => dal.revokeStandIn(id)),
};
