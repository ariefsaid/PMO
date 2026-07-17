import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { ErpActualsSnapshotRow, ErpAgingSnapshotRow } from '@/src/lib/db/erpSnapshots';
import { useAuth } from '@/src/auth/useAuth';

/**
 * Read-only accounting-snapshot hooks over the repository seam (task FIX-2, Discover CRITICAL 2 —
 * ADR-0048 ledger-sourced-display). Each is org-scoped (queryKey includes org_id) and returns an
 * empty array when the org has never run an ERPNext accounting refresh (the unflipped default) —
 * never a fabricated figure. Read-only: there is no mutation counterpart (the snapshot tables are
 * machine-written by the sweep, slice 8).
 */
export function useActualsSnapshot() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ErpActualsSnapshotRow[]>({
    queryKey: ['erp-actuals-snapshot', orgId],
    queryFn: () => repositories.erpSnapshots.actuals(),
    enabled: Boolean(orgId),
  });
}

export function useApAgingSnapshot() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ErpAgingSnapshotRow[]>({
    queryKey: ['erp-ap-aging-snapshot', orgId],
    queryFn: () => repositories.erpSnapshots.apAging(),
    enabled: Boolean(orgId),
  });
}

export function useArAgingSnapshot() {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<ErpAgingSnapshotRow[]>({
    queryKey: ['erp-ar-aging-snapshot', orgId],
    queryFn: () => repositories.erpSnapshots.arAging(),
    enabled: Boolean(orgId),
  });
}
