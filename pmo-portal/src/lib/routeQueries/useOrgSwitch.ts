import { SERVER_SESSION_QUERY_OPTIONS } from '../queryPolicies';
import { orgSwitchRepository, type OrgSwitchKey } from '../repositories/orgSwitches';

export const orgSwitchKey = (orgId: string | undefined, key: OrgSwitchKey) => ['org-setting', orgId, key] as const;

export const orgSwitchQuery = (orgId: string | undefined, key: OrgSwitchKey, enabled = true) => ({
  queryKey: orgSwitchKey(orgId, key),
  queryFn: () => orgSwitchRepository.read(key),
  enabled: enabled && Boolean(orgId),
  ...SERVER_SESSION_QUERY_OPTIONS,
});
