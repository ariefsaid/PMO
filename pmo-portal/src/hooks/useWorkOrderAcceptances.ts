import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { PrepareWorkOrderAcceptanceInput } from '@/src/lib/db/workOrderAcceptances';

/** provisional (Lane C1 supersedes): project-scoped reads once per project, grouped by WO in the UI. */
export function useWorkOrderLines(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['work-order-lines', orgId, projectId], queryFn: () => repositories.workOrderAcceptance.listLines(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

export function useWorkOrderAcceptances(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['work-order-acceptances', orgId, projectId], queryFn: () => repositories.workOrderAcceptance.listAcceptances(projectId), enabled: Boolean(orgId) && Boolean(projectId) });
}

export function useWorkOrderAcceptanceMutations(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const inv = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k, orgId, projectId] }));
  const api = repositories.workOrderAcceptance;
  const lines = () => inv('work-order-lines', 'project-billing');
  return {
    createLine: useMutation({ mutationFn: (v: { workOrderId: string; boqItemId: string; quantity: number }) => api.createLine(v.workOrderId, v.boqItemId, v.quantity), onSuccess: lines }),
    updateLine: useMutation({ mutationFn: (v: { id: string; quantity: number }) => api.updateLine(v.id, v.quantity), onSuccess: lines }),
    deleteLine: useMutation({ mutationFn: (id: string) => api.deleteLine(id), onSuccess: lines }),
    prepare: useMutation({ mutationFn: (input: PrepareWorkOrderAcceptanceInput) => api.prepare(input), onSuccess: () => inv('work-order-acceptances') }),
    withdraw: useMutation({ mutationFn: (id: string) => api.withdraw(id), onSuccess: () => inv('work-order-acceptances') }),
    confirm: useMutation({
      mutationFn: (id: string) => api.confirm(id),
      onSuccess: () => {
        inv('work-order-acceptances', 'project-billing', 'work-orders', 'project-drawdown', 'work-order-billing', 'work-order-lines');
        void qc.invalidateQueries({ queryKey: ['unbilled-work-orders', orgId] });
      },
    }),
  };
}
