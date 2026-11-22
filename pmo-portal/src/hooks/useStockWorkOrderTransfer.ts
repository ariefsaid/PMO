import { useQuery, useQueryClient } from '@tanstack/react-query';
import { stockWorkOrderTransferRepository as repo } from '@/src/lib/repositories/stockWorkOrderTransfer';
import { repositories } from '@/src/lib/repositories';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The organisation setting "work-order transfers" (#2691), off by default. While unread or failed it is off: no link, no screen. */
export function useWoTransfersEnabled(): boolean {
  const orgId = useOrgId();
  const q = useQuery({ queryKey: ['stock-wo-transfers-enabled', orgId], queryFn: () => repo.enabled(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
  return q.data === true;
}
export function useReturnable(workOrderId: string | undefined) {
  return useOrgQuery(['wo-returnable', workOrderId], () => repo.returnable(workOrderId!), { enabled: Boolean(workOrderId) });
}
export function useWoTransfer(id: string | undefined) {
  return useOrgQuery(['stock-wo-transfer', id], () => repo.get(id!), { enabled: Boolean(id) });
}
export function useProjectWorkOrdersForStock(projectId: string | undefined) {
  return useOrgQuery(['stock-wot-work-orders', projectId], () => repositories.workOrder.list(projectId!), { enabled: Boolean(projectId) });
}
/** After a move the balances, the returnable lists, the document registers and on-hand are stale. */
export function useWoTransferRefresh() {
  const qc = useQueryClient();
  return () => Promise.all(['wo-returnable', 'wo-stock-balance', 'stock-wo-transfer', 'stock-documents', 'stock-on-hand', 'stock-ledger', 'stock-wo-transfers-enabled']
    .map((k) => qc.invalidateQueries({ queryKey: [k] })));
}
