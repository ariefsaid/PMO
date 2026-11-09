/** Hooks behind the Odoo purchase screens (#1505 P8): which tier runs procurement, the case's unsettled commands, the connection's health. */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { odooRepository } from '@/src/lib/repositories/odoo';
import { useAuth } from '@/src/auth/useAuth';
import { displayedConnection } from '@/src/lib/adapterSeam/odoo/connectionState';
import { useOdooConnection } from './useOdoo';

export const odooPurchaseCommandsKey = (orgId: string | undefined, procurementId: string) => ['odoo', 'purchase-commands', orgId, procurementId] as const;

/** The case's commands Odoo has not settled. Mounted only on an Odoo-owned org (the component gates on the ownership cache). */
export function useOdooPurchaseCommands(procurementId: string) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: odooPurchaseCommandsKey(orgId, procurementId),
    queryFn: () => odooRepository.listPurchaseCommands(procurementId),
    enabled: Boolean(orgId),
    refetchInterval: 30_000,
  });
}

/** True while PMO cannot reach Odoo or the stored check is stale (FR-OPP-091). Unknown reads as reachable: the write itself fails honestly. */
export function useOdooUnreachable(enabled = true): { unreachable: boolean; lastOkAt: string | null } {
  const read = useOdooConnection(enabled).data;
  if (!enabled || !read) return { unreachable: false, lastOkAt: null };
  const state = displayedConnection(read.connection, new Date(), read);
  return { unreachable: state === 'unreachable' || state === 'unverified', lastOkAt: read.connection?.last_ok_at ?? null };
}

export function useResolveHeldPayment(procurementId: string) {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof odooRepository.resolveHeldPayment>[0]) => odooRepository.resolveHeldPayment(input),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: odooPurchaseCommandsKey(orgId, procurementId) }); },
  });
}
