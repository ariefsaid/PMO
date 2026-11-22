import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stockTransfersRepository as repo, type TransferStatus } from '@/src/lib/repositories/stockTransfers';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** The organisation's transfer mode and proof timing (#2690). While it has not loaded, screens behave as one-step: nothing new shows. */
export function useTransferSettings() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['stock-transfer-settings', orgId], queryFn: () => repo.settings.get(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
}
export const useIsTwoStep = (): boolean => useTransferSettings().data?.mode === 'two_step';

export function useStockTransfers(status?: TransferStatus, enabled = true) {
  return useOrgQuery(['stock-transfers', status ?? 'all'], () => repo.list(status), { enabled });
}
export function useStockTransfer(id: string | undefined) {
  return useOrgQuery(['stock-transfer', id], () => repo.get(id!), { enabled: Boolean(id) });
}
export function useTransferConfirmations(id: string | undefined) {
  return useOrgQuery(['stock-transfer-confirmations', id], () => repo.confirmations(id!), { enabled: Boolean(id) });
}
export function useProofStatus(status?: 'outstanding' | 'complete', enabled = true) {
  // react-query refetches on window focus by default; the explicit true below was that default restated.
  return useOrgQuery(['stock-proof-status', status ?? 'all'], () => repo.proofStatus({ status }), { enabled });
}
/** After any transfer write the transfers, on-hand and proof reads are stale. */
export function useTransferRefresh() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ['stock-transfers'] }), qc.invalidateQueries({ queryKey: ['stock-transfer'] }),
    qc.invalidateQueries({ queryKey: ['stock-transfer-confirmations'] }), qc.invalidateQueries({ queryKey: ['stock-proof-status'] }),
    qc.invalidateQueries({ queryKey: ['stock-on-hand'] }), qc.invalidateQueries({ queryKey: ['stock-transfer-settings'] }),
  ]);
}
export { useMutation };
