import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { DirectoryKind, ListMasterInput, OdooConfigProposalRead, OdooProjectLinksRead } from '@/src/lib/repositories/odoo';
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

/** Pages of the mirror appended as the user asks for more (the item picker); each page is a fresh bounded read. */
export function useMasterRecordsInfinite(input: Omit<ListMasterInput, 'page'>, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useInfiniteQuery({
    queryKey: ['odoo', 'master-infinite', orgId, input],
    queryFn: ({ pageParam }) => repositories.odoo.listMasterRecords({ ...input, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.rows.length > 0 && all.reduce((n, p) => n + p.rows.length, 0) < last.total ? all.length + 1 : undefined),
    enabled: Boolean(orgId) && enabled,
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

export function useMasterSummary(kind: DirectoryKind, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'master-summary', orgId, kind],
    queryFn: () => repositories.odoo.masterSummary(kind),
    enabled: Boolean(orgId) && enabled,
  });
}

/** The one-time map's proposal (FR-ODC-090): read when the screen opens, read again after a save or a sync (`['odoo']` is invalidated). */
export function useOdooConfigProposal(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'config-proposal', orgId],
    queryFn: () => repositories.odoo.setup<OdooConfigProposalRead>('propose-config'),
    enabled: Boolean(orgId) && enabled,
    retry: false,
  });
}

/** Cost accounts of the chosen plan and which project holds each (FR-ODC-070/071). Reads PMO's mirror; Odoo is not called. */
export function useOdooProjectLinks(enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: ['odoo', 'project-links', orgId],
    queryFn: () => repositories.odoo.setup<OdooProjectLinksRead>('list-projects'),
    enabled: Boolean(orgId) && enabled,
    retry: false,
  });
}
