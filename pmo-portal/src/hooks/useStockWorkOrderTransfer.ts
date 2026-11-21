import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockWorkOrderTransferRepository as repo } from '@/src/lib/repositories/stockWorkOrderTransfer';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

/** The organisation setting "work-order transfers" (#2691), off by default. While unread or failed it is off: no link, no screen. */
export function useWoTransfersEnabled(): boolean {
  const orgId = useAuth().currentUser?.org_id;
  const q = useQuery({ queryKey: ['stock-wo-transfers-enabled', orgId], queryFn: () => repo.enabled(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
  return q.data === true;
}
export function useReturnable(workOrderId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['wo-returnable', orgId, workOrderId], queryFn: () => repo.returnable(workOrderId!), enabled: Boolean(orgId) && Boolean(workOrderId) });
}
export function useWoTransfer(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-wo-transfer', orgId, id], queryFn: () => repo.get(id!), enabled: Boolean(orgId) && Boolean(id) });
}
export function useProjectWorkOrdersForStock(projectId: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-wot-work-orders', orgId, projectId], queryFn: () => repositories.workOrder.list(projectId!), enabled: Boolean(orgId) && Boolean(projectId) });
}
/** After a move the balances, the returnable lists, the document registers and on-hand are stale. */
export function useWoTransferRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(['wo-returnable', 'wo-stock-balance', 'stock-wo-transfer', 'stock-documents', 'stock-on-hand', 'stock-ledger', 'stock-wo-transfers-enabled']
    .map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
