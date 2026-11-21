import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stockTransfersRepository as repo, type TransferStatus } from '@/src/lib/repositories/stockTransfers';
import { useAuth } from '@/src/auth/useAuth';

/** The organisation's transfer mode and proof timing (#2690). While it has not loaded, screens behave as one-step: nothing new shows. */
export function useTransferSettings() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-transfer-settings', orgId], queryFn: () => repo.settings.get(), enabled: Boolean(orgId), staleTime: 60_000, retry: false });
}
export const useIsTwoStep = (): boolean => useTransferSettings().data?.mode === 'two_step';

export function useStockTransfers(status?: TransferStatus, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-transfers', orgId, status ?? 'all'], queryFn: () => repo.list(status), enabled: Boolean(orgId) && enabled });
}
export function useStockTransfer(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-transfer', orgId, id], queryFn: () => repo.get(id!), enabled: Boolean(orgId) && Boolean(id) });
}
export function useTransferConfirmations(id: string | undefined) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-transfer-confirmations', orgId, id], queryFn: () => repo.confirmations(id!), enabled: Boolean(orgId) && Boolean(id) });
}
export function useProofStatus(status?: 'outstanding' | 'complete') {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({ queryKey: ['stock-proof-status', orgId, status ?? 'all'], queryFn: () => repo.proofStatus({ status }), enabled: Boolean(orgId) });
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
