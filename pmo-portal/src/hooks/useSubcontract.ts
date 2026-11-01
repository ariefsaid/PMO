import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type {
  SetPoLinesInput,
  PrepareSubcontractAcceptanceInput,
  RequestPoVariationInput,
  AttributeSubcontractBillLineInput,
} from '@/src/lib/db/subcontracts';

export function usePoPosition(poId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', poId, 'position'],
    queryFn: () => repositories.subcontracts.getPoPosition(poId!),
    enabled: Boolean(poId),
  });
}

export function useSubcontractAcceptances(poId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', poId, 'acceptances'],
    queryFn: () => repositories.subcontracts.listSubcontractAcceptances(poId!),
    enabled: Boolean(poId),
  });
}

export function usePoVariations(poId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', poId, 'variations'],
    queryFn: () => repositories.subcontracts.listPoVariations(poId!),
    enabled: Boolean(poId),
  });
}

export function useVariationRoute(id: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', 'variation-route', id],
    queryFn: () => repositories.subcontracts.getVariationRoute(id!),
    enabled: Boolean(id),
  });
}

export function useProjectSubcontractExposure(projectId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', 'project-exposure', projectId],
    queryFn: () => repositories.subcontracts.getProjectSubcontractExposure(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useWorkOrderCostVariations(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', 'work-order-variations', workOrderId],
    queryFn: () => repositories.subcontracts.listWorkOrderCostVariations(workOrderId!),
    enabled: Boolean(workOrderId),
  });
}

export function useSubcontractCapExceptions(procurementId: string | undefined) {
  return useQuery({
    queryKey: ['subcontract', 'cap-exceptions', procurementId],
    queryFn: () => repositories.subcontracts.listSubcontractCapExceptions(procurementId!),
    enabled: Boolean(procurementId),
  });
}

export function useSubcontractMutations(poId: string, procurementId?: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['subcontract', poId] });
    if (procurementId) {
      void qc.invalidateQueries({ queryKey: ['procurement'] });
    } else {
      void qc.invalidateQueries({ queryKey: ['procurement'] });
    }
  };

  const setPoLines = useMutation({
    mutationFn: (lines: SetPoLinesInput[]) => repositories.subcontracts.setPoLines(poId, lines),
    onSuccess: invalidate,
  });

  const issuePoLines = useMutation({
    mutationFn: () => repositories.subcontracts.issuePoLines(poId),
    onSuccess: invalidate,
  });

  const prepareAcceptance = useMutation({
    mutationFn: (input: Omit<PrepareSubcontractAcceptanceInput, 'poId'>) =>
      repositories.subcontracts.prepareSubcontractAcceptance({ ...input, poId }),
    onSuccess: invalidate,
  });

  const confirmAcceptance = useMutation({
    mutationFn: (id: string) => repositories.subcontracts.confirmSubcontractAcceptance(id),
    onSuccess: invalidate,
  });

  const withdrawAcceptance = useMutation({
    mutationFn: (id: string) => repositories.subcontracts.withdrawSubcontractAcceptance(id),
    onSuccess: invalidate,
  });

  const requestVariation = useMutation({
    mutationFn: (input: Omit<RequestPoVariationInput, 'poId'>) =>
      repositories.subcontracts.requestPoVariation({ ...input, poId }),
    onSuccess: invalidate,
  });

  const decideVariation = useMutation({
    mutationFn: ({ id, approve, notes }: { id: string; approve: boolean; notes?: string | null }) =>
      repositories.subcontracts.decidePoVariation(id, approve, notes),
    onSuccess: invalidate,
  });

  const issueRevision = useMutation({
    mutationFn: (variationId: string) => repositories.subcontracts.issuePoRevision(variationId),
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
    }) => repositories.subcontracts.linkPoVariation(variationId, workOrderId, reason),
    onSuccess: invalidate,
  });

  const attributeBillLines = useMutation({
    mutationFn: ({ invoiceId, lines }: { invoiceId: string; lines: AttributeSubcontractBillLineInput[] }) =>
      repositories.subcontracts.attributeSubcontractBillLines(invoiceId, lines),
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
