import { orgSwitchKey, orgSwitchQuery } from '@/src/lib/routeQueries/useOrgSwitch';
export { orgSwitchKey, orgSwitchQuery } from '@/src/lib/routeQueries/useOrgSwitch';
import { useContext } from 'react';
import { QueryClient, QueryClientContext, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthContext } from '@/src/auth/AuthContext';
import { useAuth } from '@/src/auth/useAuth';
import { useStockOwnedByErp } from '@/src/hooks/useStockOwnedByErp';
import { orgSwitch, orgSwitchRepository, type OrgModuleKey, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';

/** Organisation switches (#2746, ADR-0121): one cached value per org and key, refreshed on focus and every 5 minutes. */

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
  const q = useQuery(orgSwitchQuery(orgId, module ?? 'modulePeopleCrews', enabled && Boolean(qc && module)), qc ?? IDLE_CLIENT);
  return q.data !== false;
}

/** Read the stored switch when a server-side rule uses it directly. */
export function useStoredOrgSwitch(key: OrgSwitchKey, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery(orgSwitchQuery(orgId, key, enabled));
}

/** A switch that lives in a module (the registry's `module`) reads off while its module is off, or while an ERP owns the stock for a stock feature; the stored value is untouched. */
export function useOrgSwitch(key: OrgSwitchKey, enabled = true) {
  const moduleOn = useModuleOn(orgSwitch(key).module);
  const erpOwnsStock = useStockOwnedByErp();
  const q = useStoredOrgSwitch(key, enabled);
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
