import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { analyticsClient } from '@/src/lib/analytics/client';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { orgPlanGroupQueryKey } from '@/src/hooks/useOrgFeatures';
import type { OrgPlan } from '@/src/lib/db/orgPlan';

/** PostHog group type for the organisation — one group per org, shared by every member. */
export const ORG_GROUP_TYPE = 'organisation';

/**
 * Plans S4 (FR-PLN-016): register the caller's org plan as a PostHog group property.
 *
 * Where the plan comes from: `repositories.orgFeature.currentPlan()` → S3's member-scoped
 * `resolved_org_plan()` projection (migration 0537). Nothing else in the app can read the plan — the
 * plan tables have no API-role path (0530) — so a `null` answer (RPC not deployed yet, no session,
 * transport error) means "register nothing". Analytics is never a gate: a missing plan degrades to no
 * group property and nothing else, and no error surfaces.
 *
 * One registration per (org, plan): the effect is keyed on both, so a plan change re-registers and a
 * re-render does not re-send. Consent is enforced inside `analyticsClient.group` (the same guard as
 * every other capture), so this hook never needs to know whether analytics is live.
 */
export function useOrgPlanGroup(): void {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id ?? null;
  const query = useQuery<OrgPlan | null>({
    // Own key: this reader returns an `OrgPlan` OBJECT, while the Operator console's
    // `useOrgPlan` returns the assigned plan id STRING. Sharing a key made each reader install a
    // value the other could not read.
    queryKey: orgPlanGroupQueryKey(orgId),
    queryFn: () => repositories.orgFeature.currentPlan(),
    enabled: Boolean(orgId),
    // Bounded freshness: a plan assigned from the Operator console in another session reaches this
    // tab within minutes; `invalidateFeatureState` still refreshes it immediately in the writer's own.
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
  const planId = query.data?.plan_id ?? null;

  useEffect(() => {
    if (!orgId || !planId) return;
    analyticsClient.group(ORG_GROUP_TYPE, orgId, { plan: planId });
  }, [orgId, planId]);
}
