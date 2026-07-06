import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { OrgFeatureKey } from '@/src/lib/features';

/**
 * useOrgFeatures — the caller's own-org entitlement map (ops-admin-surface S6, FR-ENT-001..004,
 * AC-ENT-003). Reads `org_features` rows (RLS scopes `org_id = auth_org_id()` so every member
 * reads their own org — entitlements are not intra-org secrets). Returns a
 * `Record<OrgFeatureKey, boolean>` keyed by feature_key; ABSENT keys are omitted (the
 * `useFeature` resolver falls back to the env default for those — FR-ENT-004 absence = included).
 *
 * `enabled` when there is a current user. While loading the data is `undefined`; consumers fall
 * back to env defaults so the first paint never hides an always-on module.
 */
export function useOrgFeatures() {
  const { currentUser } = useAuth();
  return useQuery<Record<OrgFeatureKey, boolean>>({
    queryKey: ['orgFeatures'],
    queryFn: () => repositories.orgFeature.listOwn(),
    enabled: Boolean(currentUser),
  });
}
