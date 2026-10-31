import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { ListMasterInput } from '@/src/lib/repositories/odoo';
import type { ConnectCredential } from '@/src/lib/repositories/types';
import { useAuth } from '@/src/auth/useAuth';

export function useOdooConnection() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'connection', orgId],
    queryFn: () => repositories.odoo.getConnection(),
    enabled: Boolean(orgId),
    refetchInterval: 60_000,
  });
}

export function useMasterRecords(input: ListMasterInput, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'master', orgId, input],
    queryFn: () => repositories.odoo.listMasterRecords(input),
    enabled: Boolean(orgId) && enabled,
    placeholderData: keepPreviousData,
  });
}

/** One setup verb through `external-set-company` (tier odoo). Refreshes everything Odoo and the integration cards read. */
export function useOdooSetup(verb: string) {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown> = {}) => repositories.odoo.setup(verb, input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['odoo'] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
    },
  });
}

export function useOdooConnect() {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (credential: ConnectCredential['credential']) => repositories.integrations.connectIntegration(orgId!, { tier: 'odoo', credential }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['odoo'] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId] });
    },
  });
}

export function useOdooDisconnect() {
  const orgId = useAuth().currentUser?.org_id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => repositories.integrations.disconnectIntegration(orgId!, 'odoo'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['odoo'] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'bindings', orgId] });
      void qc.invalidateQueries({ queryKey: ['integrations', 'health', orgId] });
    },
  });
}
