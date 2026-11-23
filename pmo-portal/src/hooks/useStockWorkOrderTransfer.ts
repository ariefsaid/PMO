import { useQueryClient } from '@tanstack/react-query';
import { stockWorkOrderTransferRepository as repo } from '@/src/lib/repositories/stockWorkOrderTransfer';
import { repositories } from '@/src/lib/repositories';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

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
