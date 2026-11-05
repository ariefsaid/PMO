import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { PlanCatalogue, PlanRow } from '@/src/lib/db/orgFeatures';
import type { ResolvedFeatureSet } from '@/src/lib/features';
import type { OrgFeatureKey } from '@/src/lib/features';
import {
  OPERATOR_ORGS_QUERY_KEY,
  ownPlanQueryKey,
  PLAN_CATALOGUE_QUERY_KEY,
  operatorFeatureQueryKey,
  orgOverridesQueryKey,
  orgPlanQueryKey,
} from '@/src/hooks/useOrgFeatures';
import type { OperatorOrgRow } from '@/src/lib/db/usage';
import { SERVER_SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/**
 * Plan-surface reads (S3).
 *
 *   • `useOwnPlan` — the Admin "Your plan" page's plan + limits (FR-PLN-014, own org only).
 *   • `usePlanCatalogue` — the Operator console's plans, plan matrix and all-orgs flags.
 *   • `useOrgPlan` / `useOperatorOrgs` — the console's org picker and its assigned plan.
 *   • `useOperatorResolvedFeatures` — the selected org's resolved set (state + source per key).
 *   • `useOperatorOrgOverrides` — which override ROWS exist, even ones an all-orgs off outranks.
 *
 * Every key comes from `useOrgFeatures` so ONE `invalidateFeatureState` after any change refreshes
 * them all; none of these is cross-org shared. Freshness is bounded (`SERVER_SESSION_QUERY_OPTIONS`):
 * these are server-arbitrated facts an operator can change from another session, so they revalidate
 * on a 5-minute window, on focus and on an interval rather than being cached for the session.
 */

export function useOwnPlan() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery<PlanRow | null>({
    // Scoped by org: a same-user profile refresh can move the caller to another org (see AuthProvider).
    queryKey: ownPlanQueryKey(orgId),
    queryFn: () => repositories.orgFeature.getOwnPlan(),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}

export function usePlanCatalogue() {
  return useQuery<PlanCatalogue>({
    queryKey: PLAN_CATALOGUE_QUERY_KEY,
    queryFn: () => repositories.orgFeature.getPlanCatalogue(),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}

export function useOrgPlan(orgId: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: orgPlanQueryKey(orgId ?? 'none'),
    queryFn: () => repositories.orgFeature.getOrgPlan(orgId as string),
    enabled: Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}

export function useOperatorOrgs() {
  return useQuery<OperatorOrgRow[]>({
    queryKey: OPERATOR_ORGS_QUERY_KEY,
    queryFn: () => repositories.usage.listOperatorOrgs(),
  });
}

export function useOperatorResolvedFeatures(orgId: string | null | undefined) {
  return useQuery<ResolvedFeatureSet>({
    queryKey: operatorFeatureQueryKey(orgId ?? 'none'),
    queryFn: () => repositories.orgFeature.listForOrg(orgId as string),
    enabled: Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}

/**
 * The override keys that EXIST for one org. Read separately from the resolved set because an
 * all-orgs off makes the resolved source `global` whether or not a dormant override row is there —
 * and an Operator must still be able to clear that row.
 */
export function useOperatorOrgOverrides(orgId: string | null | undefined) {
  return useQuery<OrgFeatureKey[]>({
    queryKey: orgOverridesQueryKey(orgId ?? 'none'),
    queryFn: () => repositories.orgFeature.listOverrides(orgId as string),
    enabled: Boolean(orgId),
    ...SERVER_SESSION_QUERY_OPTIONS,
  });
}
