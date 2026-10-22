import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { PrepareWorkOrderAcceptanceInput, WorkOrderLineInput } from '@/src/lib/db/workOrderAcceptances';

/** Every acceptance on a project in ONE query (the tab groups them by work order). Keys carry org_id. */
export function useWorkOrderAcceptances(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-acceptances', orgId, projectId],
    queryFn: () => repositories.workOrderAcceptance.listByProject(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/** Every allocation on a project's work orders in ONE query (grouped by work order in the tab). */
export function useProjectWorkOrderLines(projectId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['work-order-lines', orgId, 'project', projectId],
    queryFn: () => repositories.workOrderAcceptance.listProjectLines(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/**
 * Cache design (ADR-0091). Allocation writes refresh the allocation lists and the billing summary (ordered and
 * balance facts). Preparing or withdrawing a BAST refreshes the acceptances only — it moves no money. Confirming
 * additionally refreshes everything a close can change: the summary, the work orders, the drawdown, per-order
 * billing and the org-wide still-to-invoice card. Invalidate on success only: never optimistically close a work
 * order or guess `dp_held`; a refused confirm leaves the cache untouched.
 */
export function useWorkOrderAcceptanceMutations(projectId: string) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const refreshAcceptances = () => qc.invalidateQueries({ queryKey: ['work-order-acceptances', orgId, projectId] });
  const refreshAllocations = () => {
    void qc.invalidateQueries({ queryKey: ['work-order-lines', orgId] });
    void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
  };
  const refreshClose = () => {
    void refreshAcceptances();
    void qc.invalidateQueries({ queryKey: ['project-billing', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['work-orders', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['project-drawdown', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['work-order-billing', orgId, projectId] });
    void qc.invalidateQueries({ queryKey: ['unbilled-work-orders', orgId] });
  };
  const createLine = useMutation({ mutationFn: (input: WorkOrderLineInput) => repositories.workOrderAcceptance.createLine(input), onSuccess: refreshAllocations });
  const updateLine = useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) => repositories.workOrderAcceptance.updateLine(id, quantity),
    onSuccess: refreshAllocations,
  });
  const deleteLine = useMutation({ mutationFn: (id: string) => repositories.workOrderAcceptance.deleteLine(id), onSuccess: refreshAllocations });
  const prepare = useMutation({
    mutationFn: (input: PrepareWorkOrderAcceptanceInput) => repositories.workOrderAcceptance.prepare(input),
    onSuccess: () => void refreshAcceptances(),
  });
  const withdraw = useMutation({ mutationFn: (id: string) => repositories.workOrderAcceptance.withdraw(id), onSuccess: () => void refreshAcceptances() });
  const confirm = useMutation({ mutationFn: (id: string) => repositories.workOrderAcceptance.confirm(id), onSuccess: refreshClose });
  return { createLine, updateLine, deleteLine, prepare, withdraw, confirm };
}
