import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { repositories } from '@/src/lib/repositories';
import type {
  InspectionRow, InspectionFileRow, InspectionInput, InspectionResult, InspectionCostRow,
} from '@/src/lib/db/thirdPartyInspections';

/** #2580: the inspections of one work order, their cost read (server-fenced) and the step writes over the repository seam. */
export function useWorkOrderInspections(workOrderId: string | null | undefined) {
  return useOrgQuery<InspectionRow[]>(['third-party-inspections', workOrderId], () => repositories.thirdPartyInspection.listForWorkOrder(workOrderId as string), { enabled: Boolean(workOrderId) });
}

export function useInspectionCosts(workOrderId: string | null | undefined) {
  return useOrgQuery<InspectionCostRow[]>(['third-party-inspection-costs', workOrderId], () => repositories.thirdPartyInspection.costs(workOrderId as string), { enabled: Boolean(workOrderId) });
}

export function useInspectionFiles(inspectionId: string | null | undefined) {
  return useOrgQuery<InspectionFileRow[]>(['third-party-inspection-files', inspectionId], () => repositories.thirdPartyInspection.listFiles(inspectionId as string), { enabled: Boolean(inspectionId) });
}

export function useInspectionMutations(workOrderId: string) {
  const qc = useQueryClient();
  const orgId = useOrgId();
  const repo = repositories.thirdPartyInspection;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['third-party-inspections', orgId, workOrderId] });
    void qc.invalidateQueries({ queryKey: ['third-party-inspection-costs', orgId, workOrderId] });
    void qc.invalidateQueries({ queryKey: ['work-order-cost-lines'] });
  };
  return {
    create: useMutation({ mutationFn: (input: InspectionInput) => repo.create(input), onSuccess: refresh }),
    raisePurchase: useMutation({ mutationFn: (v: { id: string; procurementId?: string | null }) => repo.raisePurchase(v.id, v.procurementId), onSuccess: refresh }),
    invite: useMutation({ mutationFn: (v: { id: string; on: string; who: string | null; how: string | null }) => repo.recordInvitation(v.id, v.on, v.who, v.how), onSuccess: refresh }),
    execute: useMutation({ mutationFn: (v: { id: string; on: string }) => repo.recordExecution(v.id, v.on), onSuccess: refresh }),
    report: useMutation({ mutationFn: (v: { id: string; result: InspectionResult }) => repo.recordReport(v.id, v.result), onSuccess: refresh }),
    waive: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo.waive(v.id, v.reason), onSuccess: refresh }),
    cancel: useMutation({ mutationFn: (v: { id: string; reason: string }) => repo.cancel(v.id, v.reason), onSuccess: refresh }),
    addFile: useMutation({
      mutationFn: (v: { inspection: Pick<InspectionRow, 'id' | 'org_id'>; file: File; liveCount: number }) =>
        repo.addFile(v.inspection, v.file, v.liveCount),
      onSuccess: (_d, v) => void qc.invalidateQueries({ queryKey: ['third-party-inspection-files', orgId, v.inspection.id] }),
    }),
  };
}
