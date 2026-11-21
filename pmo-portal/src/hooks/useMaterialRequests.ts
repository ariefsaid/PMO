import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { materialRequestRepository as repo } from '@/src/lib/repositories/materialRequests';
import type {
  ChainStepInput, MaterialRequestFilter, MaterialRequestHeader, MaterialRequestLineInput, StepDecision,
} from '@/src/lib/repositories/materialRequests';
import { useOrgId } from '@/src/hooks/useOrgId';

/** Material requests (#2524) over the repository seam (ADR-0017). Keys carry org_id (tenant scope); every write refreshes the whole root. */
export const MATERIAL_REQUEST_QUERY_ROOT = 'material-requests';


export function useMaterialRequests(filter: MaterialRequestFilter) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'list', filter], queryFn: () => repo.list(filter), enabled: Boolean(orgId) });
}

export function useMaterialRequest(id: string | undefined) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'one', id], queryFn: () => repo.get(id as string), enabled: Boolean(orgId) && Boolean(id) });
}

/** FR-MRQ-017: the caller's open steps. The server already applies role, stand-in window and one-step-per-person. */
export function useWaitingForMe() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'waiting'], queryFn: () => repo.waitingForMe(), enabled: Boolean(orgId) });
}

/** FR-MRQ-002: plan and already-requested figures for the lines being drafted. */
export function useLinePlans(workOrderId: string | undefined, itemIds: string[], excludeRequestId?: string | null) {
  const orgId = useOrgId();
  const key = [...itemIds].sort();
  return useQuery({
    queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'plans', workOrderId, key, excludeRequestId ?? null],
    queryFn: () => repo.linePlans(workOrderId as string, key, excludeRequestId),
    enabled: Boolean(orgId) && Boolean(workOrderId) && key.length > 0,
  });
}

export function useApprovalChain() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'chain'], queryFn: () => repo.chain(), enabled: Boolean(orgId) });
}
export function useMaterialRequestCutoff() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'cutoff'], queryFn: () => repo.cutoff(), enabled: Boolean(orgId) });
}
export function useDeliveryNoteSettings() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'delivery-note-settings'], queryFn: () => repo.deliveryNoteSettings(), enabled: Boolean(orgId) });
}
export function useStandIns() {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'stand-ins'], queryFn: () => repo.standIns(), enabled: Boolean(orgId) });
}

/** #2598: the approval steps pinned to a person on one project. */
export function useStepPins(projectId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId, 'step-pins', projectId], queryFn: () => repo.stepPins(projectId as string), enabled: Boolean(orgId) && Boolean(projectId) });
}

export function useMaterialRequestMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const refresh = () => qc.invalidateQueries({ queryKey: [MATERIAL_REQUEST_QUERY_ROOT, orgId] });
  const opts = { onSuccess: refresh };
  return {
    saveDraft: useMutation({
      mutationFn: (a: { id: string | null; header: MaterialRequestHeader; lines: MaterialRequestLineInput[]; clientRequestId?: string }) =>
        repo.saveDraft(a.id, a.header, a.lines, a.clientRequestId), ...opts,
    }),
    submit: useMutation({ mutationFn: (a: { id: string; clientRequestId?: string }) => repo.submit(a.id, a.clientRequestId), ...opts }),
    decide: useMutation({
      mutationFn: (a: { id: string; position: number; decision: StepDecision; reason?: string | null; sourceWarehouseId?: string | null }) =>
        repo.decideStep(a.id, a.position, a.decision, { reason: a.reason, sourceWarehouseId: a.sourceWarehouseId }), ...opts,
    }),
    cancel: useMutation({ mutationFn: (a: { id: string; reason?: string | null }) => repo.cancel(a.id, a.reason), ...opts }),
    retryTransfer: useMutation({ mutationFn: (a: { id: string; sourceWarehouseId: string }) => repo.retryTransfer(a.id, a.sourceWarehouseId), ...opts }),
    setChain: useMutation({ mutationFn: (steps: ChainStepInput[]) => repo.setChain(steps), ...opts }),
    setCutoff: useMutation({ mutationFn: (c: string | null) => repo.setCutoff(c), ...opts }),
    setDeliveryNoteSettings: useMutation({
      mutationFn: (a: { enabled: boolean; signatureBlocks: string[] }) => repo.setDeliveryNoteSettings(a.enabled, a.signatureBlocks),
      ...opts,
    }),
    setStandIn: useMutation({ mutationFn: (s: { delegatorId: string; standInId: string; startsOn: string; endsOn: string }) => repo.setStandIn(s), ...opts }),
    setStepPin: useMutation({ mutationFn: (a: { projectId: string; position: number; approverId: string | null }) => repo.setStepPin(a.projectId, a.position, a.approverId), ...opts }),
    revokeStandIn: useMutation({ mutationFn: (id: string) => repo.revokeStandIn(id), ...opts }),
  };
}
