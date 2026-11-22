import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { orgSwitch, orgSwitchRepository, type OrgSwitchKey } from '@/src/lib/repositories/orgSwitches';

/** Organisation switches (#2746, ADR-0121): one cached value per org and key, refreshed on focus and every 5 minutes. */
export const orgSwitchKey = (orgId: string | undefined, key: OrgSwitchKey) => ['org-setting', orgId, key] as const;

export function useOrgSwitch(key: OrgSwitchKey, enabled = true) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: orgSwitchKey(orgId, key),
    queryFn: () => orgSwitchRepository.read(key),
    enabled: enabled && Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
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
