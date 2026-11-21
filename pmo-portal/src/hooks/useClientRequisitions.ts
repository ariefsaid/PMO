import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientRequisitionRepository as repo } from '@/src/lib/repositories/clientRequisitions';
import type { ClientRequisitionLineInput } from '@/src/lib/repositories/clientRequisitions';
import { useAuth } from '@/src/auth/useAuth';

/** Client material requisitions (#2585) over the repository seam (ADR-0017). Keys carry org_id (tenant scope); every write refreshes the whole root. */
export const CLIENT_REQUISITION_QUERY_ROOT = 'client-requisitions';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

/** What the work order's "Client material" section shows. An empty `requisitions` list is "none raised yet", never zeros (AC-CSR-003). */
export function useWorkOrderClientMaterial(workOrderId: string | undefined, enabled = true) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [CLIENT_REQUISITION_QUERY_ROOT, orgId, 'work-order', workOrderId],
    queryFn: () => repo.forWorkOrder(workOrderId as string),
    enabled: Boolean(orgId) && Boolean(workOrderId) && enabled,
  });
}

export function useClientRequisitionMutations() {
  const qc = useQueryClient();
  const orgId = useOrgId();
  // A pickup also moves stock: refresh what the stock screens and the work order's stock balance read.
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: [CLIENT_REQUISITION_QUERY_ROOT, orgId] }),
    qc.invalidateQueries({ queryKey: ['wo-stock-balance', orgId] }),
  ]);
  const opts = { onSuccess: refresh };
  return {
    create: useMutation({
      mutationFn: (a: { workOrderId: string; clientReference?: string | null; lines: ClientRequisitionLineInput[]; clientRequestId?: string }) =>
        repo.create({ workOrderId: a.workOrderId, clientReference: a.clientReference }, a.lines, a.clientRequestId), ...opts,
    }),
    updateDraft: useMutation({
      mutationFn: (a: { id: string; clientReference?: string | null; lines: ClientRequisitionLineInput[] }) =>
        repo.updateDraft(a.id, { clientReference: a.clientReference }, a.lines), ...opts,
    }),
    send: useMutation({ mutationFn: (a: { id: string; clientRequestId?: string }) => repo.send(a.id, a.clientRequestId), ...opts }),
    cancel: useMutation({ mutationFn: (a: { id: string; reason?: string | null }) => repo.cancel(a.id, a.reason), ...opts }),
    recordReservation: useMutation({
      mutationFn: (a: { lineId: string; quantity: string; clientReference: string; reservedOn?: string | null; note?: string | null; clientRequestId?: string }) =>
        repo.recordReservation(a.lineId, { quantity: a.quantity, clientReference: a.clientReference, reservedOn: a.reservedOn, note: a.note }, a.clientRequestId), ...opts,
    }),
    recordRelease: useMutation({
      mutationFn: (a: { lineId: string; quantity: string; reason: string; clientRequestId?: string }) =>
        repo.recordRelease(a.lineId, { quantity: a.quantity, reason: a.reason }, a.clientRequestId), ...opts,
    }),
    recordPickup: useMutation({
      mutationFn: (a: { lineId: string; quantity: string; warehouseId: string; pickedUpOn?: string | null; collector?: string | null; paperReference?: string | null; clientRequestId?: string }) =>
        repo.recordPickup(a.lineId, { quantity: a.quantity, warehouseId: a.warehouseId, pickedUpOn: a.pickedUpOn, collector: a.collector, paperReference: a.paperReference }, a.clientRequestId), ...opts,
    }),
  };
}
