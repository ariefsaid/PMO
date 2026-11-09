import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { subcontractRepository } from '@/src/lib/repositories/subcontracts';
import type {
  SetPoLinesInput,
  PrepareSubcontractAcceptanceInput,
  RequestPoVariationInput,
  AttributeSubcontractBillLineInput,
} from '@/src/lib/db/subcontracts';

// ---------------------------------------------------------------------------
// Query key factory — org-scoped (mirrors useProcurementDetail pattern, AC-816)
// ---------------------------------------------------------------------------
export const subcontractKeys = {
  all: (orgId: string | undefined) => ['subcontract', orgId] as const,
  po: (orgId: string | undefined, poId: string | undefined) => ['subcontract', orgId, poId] as const,
  poPosition: (orgId: string | undefined, poId: string | undefined) =>
    ['subcontract', orgId, poId, 'position'] as const,
  acceptances: (orgId: string | undefined, poId: string | undefined) =>
    ['subcontract', orgId, poId, 'acceptances'] as const,
  variations: (orgId: string | undefined, poId: string | undefined) =>
    ['subcontract', orgId, poId, 'variations'] as const,
  variationRoute: (orgId: string | undefined, id: string | undefined) =>
    ['subcontract', orgId, 'variation-route', id] as const,
  projectExposure: (orgId: string | undefined, projectId: string | undefined) =>
    ['subcontract', orgId, 'project-exposure', projectId] as const,
  workOrderVariations: (orgId: string | undefined, workOrderId: string | undefined) =>
    ['subcontract', orgId, 'work-order-variations', workOrderId] as const,
  draftLines: (orgId: string | undefined, poId: string | undefined) =>
    ['subcontract', orgId, poId, 'draft-lines'] as const,
  capExceptions: (orgId: string | undefined, procurementId: string | undefined) =>
    ['subcontract', orgId, 'cap-exceptions', procurementId] as const,
};

export function usePoPosition(poId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.poPosition(orgId, poId),
    queryFn: () => subcontractRepository.getPoPosition(poId!),
    enabled: Boolean(orgId && poId),
  });
}

/** Revision-1 lines of a PO that has no issued revision yet (the editable draft). */
export function usePoDraftLines(poId: string | undefined, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.draftLines(orgId, poId),
    queryFn: () => subcontractRepository.listPoLines(poId!, 1),
    enabled: Boolean(orgId && poId && enabled),
  });
}

export function useSubcontractAcceptances(poId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.acceptances(orgId, poId),
    queryFn: () => subcontractRepository.listSubcontractAcceptances(poId!),
    enabled: Boolean(orgId && poId),
  });
}

export function usePoVariations(poId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.variations(orgId, poId),
    queryFn: () => subcontractRepository.listPoVariations(poId!),
    enabled: Boolean(orgId && poId),
  });
}

export function useVariationRoute(id: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.variationRoute(orgId, id),
    queryFn: () => subcontractRepository.getVariationRoute(id!),
    enabled: Boolean(orgId && id),
  });
}

export function useProjectSubcontractExposure(projectId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.projectExposure(orgId, projectId),
    queryFn: () => subcontractRepository.getProjectSubcontractExposure(projectId!),
    enabled: Boolean(orgId && projectId),
  });
}

export function useWorkOrderCostVariations(workOrderId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.workOrderVariations(orgId, workOrderId),
    queryFn: () => subcontractRepository.listWorkOrderCostVariations(workOrderId!),
    enabled: Boolean(orgId && workOrderId),
  });
}

export function useSubcontractCapExceptions(procurementId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: subcontractKeys.capExceptions(orgId, procurementId),
    queryFn: () => subcontractRepository.listSubcontractCapExceptions(procurementId!),
    enabled: Boolean(orgId && procurementId),
  });
}

export function useSubcontractMutations(poId: string, procurementId?: string) {
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: subcontractKeys.po(orgId, poId) });
    if (procurementId) {
      void qc.invalidateQueries({ queryKey: ['procurement', orgId, procurementId] });
    } else {
      void qc.invalidateQueries({ queryKey: ['procurement', orgId] });
    }
  };

  const setPoLines = useMutation({
    mutationFn: (lines: SetPoLinesInput[]) => subcontractRepository.setPoLines(poId, lines),
    onSuccess: invalidate,
  });

  const issuePoLines = useMutation({
    mutationFn: () => subcontractRepository.issuePoLines(poId),
    onSuccess: invalidate,
  });

  const prepareAcceptance = useMutation({
    mutationFn: (input: Omit<PrepareSubcontractAcceptanceInput, 'poId'>) =>
      subcontractRepository.prepareSubcontractAcceptance({ ...input, poId }),
    onSuccess: invalidate,
  });

  const confirmAcceptance = useMutation({
    mutationFn: (id: string) => subcontractRepository.confirmSubcontractAcceptance(id),
    onSuccess: invalidate,
  });

  const withdrawAcceptance = useMutation({
    mutationFn: (id: string) => subcontractRepository.withdrawSubcontractAcceptance(id),
    onSuccess: invalidate,
  });

  const requestVariation = useMutation({
    mutationFn: (input: Omit<RequestPoVariationInput, 'poId'>) =>
      subcontractRepository.requestPoVariation({ ...input, poId }),
    onSuccess: invalidate,
  });

  const decideVariation = useMutation({
    mutationFn: ({ id, approve, notes }: { id: string; approve: boolean; notes?: string | null }) =>
      subcontractRepository.decidePoVariation(id, approve, notes),
    onSuccess: invalidate,
  });

  const issueRevision = useMutation({
    mutationFn: (variationId: string) => subcontractRepository.issuePoRevision(variationId),
    onSuccess: invalidate,
  });

  const linkVariation = useMutation({
    mutationFn: ({
      variationId,
      workOrderId,
      reason,
    }: {
      variationId: string;
      workOrderId: string | null;
      reason: string | null;
    }) => subcontractRepository.linkPoVariation(variationId, workOrderId, reason),
    onSuccess: () => {
      invalidate();
      // A relink removes the variation from its old work order as well as adding it to the new one.
      void qc.invalidateQueries({ queryKey: ['subcontract', orgId, 'work-order-variations'] });
    },
  });

  const attributeBillLines = useMutation({
    mutationFn: ({ invoiceId, lines }: { invoiceId: string; lines: AttributeSubcontractBillLineInput[] }) =>
      subcontractRepository.attributeSubcontractBillLines(invoiceId, lines),
    onSuccess: invalidate,
  });

  return {
    setPoLines,
    issuePoLines,
    prepareAcceptance,
    confirmAcceptance,
    withdrawAcceptance,
    requestVariation,
    decideVariation,
    issueRevision,
    linkVariation,
    attributeBillLines,
  };
}
