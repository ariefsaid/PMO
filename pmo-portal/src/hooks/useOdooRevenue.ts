/** Odoo revenue command reads and operator resolution for PMO invoice records. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';

export const odooRevenueCommandsKey = (orgId: string | undefined, invoiceId?: string) => ['odoo', 'revenue-commands', orgId, invoiceId ?? 'visible-invoices'] as const;

export function useOdooRevenueCommands(invoiceId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: odooRevenueCommandsKey(orgId, invoiceId),
    queryFn: () => repositories.odoo.listRevenueCommands(invoiceId!),
    enabled: Boolean(orgId && invoiceId && enabled),
    refetchInterval: 30_000,
  });
}

export function useOdooRevenueCommandsForInvoices(invoiceIds: string[], enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const ids = [...new Set(invoiceIds)].sort();
  return useQuery({
    queryKey: odooRevenueCommandsKey(orgId, ids.join(',')),
    queryFn: () => repositories.odoo.listRevenueCommandsForInvoices(ids),
    enabled: Boolean(orgId && enabled && ids.length),
    refetchInterval: 30_000,
  });
}

export function useOdooRevenueCreditNotes(invoiceId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'revenue-credit-notes', orgId, invoiceId],
    queryFn: () => repositories.odoo.listRevenueCreditNotes(invoiceId!),
    enabled: Boolean(orgId && invoiceId && enabled),
    retry: false,
  });
}

export function useResolveHeldRevenueCommand(invoiceId?: string) {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof repositories.odoo.resolveHeldRevenueCommand>[0]) => repositories.odoo.resolveHeldRevenueCommand(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: odooRevenueCommandsKey(orgId, invoiceId) });
      void qc.invalidateQueries({ queryKey: odooRevenueCommandsKey(orgId) });
    },
  });
}
