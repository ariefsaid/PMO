/** Odoo revenue command reads and operator resolution for PMO invoice records. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { odooRepository } from '@/src/lib/repositories/odoo';
import { useAuth } from '@/src/auth/useAuth';

export const odooRevenueCommandsKey = (orgId: string | undefined, invoiceId?: string) => ['odoo', 'revenue-commands', orgId, invoiceId ?? 'visible-invoices'] as const;

export function useOdooRevenueCommands(invoiceId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: odooRevenueCommandsKey(orgId, invoiceId),
    queryFn: () => odooRepository.listRevenueCommands(invoiceId!),
    enabled: Boolean(orgId && invoiceId && enabled),
    refetchInterval: 30_000,
  });
}

export function useOdooRevenueCommandsForInvoices(invoiceIds: string[], enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const ids = [...new Set(invoiceIds)].sort();
  return useQuery({
    queryKey: odooRevenueCommandsKey(orgId, ids.join(',')),
    queryFn: () => odooRepository.listRevenueCommandsForInvoices(ids),
    enabled: Boolean(orgId && enabled && ids.length),
    refetchInterval: 30_000,
  });
}

export function useOdooRevenueCreditNotes(invoiceId: string | undefined, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'revenue-credit-notes', orgId, invoiceId],
    queryFn: () => odooRepository.listRevenueCreditNotes(invoiceId!),
    enabled: Boolean(orgId && invoiceId && enabled),
    retry: false,
  });
}

export function useResolveHeldRevenueCommand(invoiceId?: string) {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof odooRepository.resolveHeldRevenueCommand>[0]) => odooRepository.resolveHeldRevenueCommand(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: odooRevenueCommandsKey(orgId, invoiceId) });
      void qc.invalidateQueries({ queryKey: odooRevenueCommandsKey(orgId) });
    },
  });
}
