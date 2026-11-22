import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useAuth } from '@/src/auth/useAuth';
import { useStockOwnedByErp } from '@/src/hooks/useStockOwnedByErp';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { orgSwitch, orgSwitchRepository, type OrgModuleKey, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';

/** Organisation switches (#2746, ADR-0121): one cached value per org and key, refreshed on focus and every 5 minutes. */
export const orgSwitchKey = (orgId: string | undefined, key: OrgSwitchKey) => ['org-setting', orgId, key] as const;

// The module read sits under shared chrome (rail, nav) and feature hooks that render without a session or a query provider: there it
// simply makes no request and the module counts as on.
const IDLE_CLIENT = new QueryClient();

/**
 * Whether a module is on (#2746). The one check every module screen reads: a module hides its nav entries, panels, fields and Admin
 * lists when off. UI only; no database guard reads it. While the read is loading or failed the module counts as on, so a page never
 * flashes empty for the organisations that use it. Shares one cached read with `useOrgSwitch(module)`.
 */
export function useModuleOn(module: OrgModuleKey | undefined, enabled = true): boolean {
  const qc = useContext(QueryClientContext);
  const orgId = useContext(AuthContext)?.currentUser?.org_id;
  const q = useQuery({
    queryKey: orgSwitchKey(orgId, module ?? 'modulePeopleCrews'),
    queryFn: () => orgSwitchRepository.read(module as OrgModuleKey),
    enabled: enabled && Boolean(qc && orgId && module),
    ...SERVER_SESSION_QUERY_OPTIONS,
  }, qc ?? IDLE_CLIENT);
  return q.data !== false;
}

/** A switch that lives in a module (the registry's `module`) reads off while its module is off, or while an ERP owns the stock for a stock feature; the stored value is untouched. */
export function useOrgSwitch(key: OrgSwitchKey, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  const moduleOn = useModuleOn(orgSwitch(key).module);
  const erpOwnsStock = useStockOwnedByErp();
  const q = useQuery({
    queryKey: orgSwitchKey(orgId, key),
    queryFn: () => orgSwitchRepository.read(key),
    enabled: enabled && Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
  const hidden = !moduleOn || (erpOwnsStock && orgSwitch(key).pmoStockOnly === true);
  return hidden && q.data !== undefined ? { ...q, data: false } : q;
}

/** Calls the switch's own server write once; the server decides (ADR-0016). Then re-reads it and what depends on it. */
export function useSetOrgSwitch(key: OrgSwitchKey) {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  return useMutation({
    mutationFn: (on: boolean) => orgSwitchRepository.write(key, on),
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: orgSwitchKey(orgId, key) }),
      ...(orgSwitch(key).refreshes ?? []).map((root) => qc.invalidateQueries({ queryKey: [root] })),
    ]),
  });
}
