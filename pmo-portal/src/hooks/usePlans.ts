import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import type { PlanCatalogue, PlanRow } from '@/src/lib/db/orgFeatures';
import type { ResolvedFeatureSet } from '@/src/lib/features';
import {
  OPERATOR_ORGS_QUERY_KEY,
  OWN_PLAN_QUERY_KEY,
  PLAN_CATALOGUE_QUERY_KEY,
  operatorFeatureQueryKey,
  orgPlanQueryKey,
} from '@/src/hooks/useOrgFeatures';
import type { OperatorOrgRow } from '@/src/lib/db/usage';

/**
 * Plan-surface reads (S3).
 *
 *   • `useOwnPlan` — the Admin "Your plan" page's plan + limits (FR-PLN-014, own org only).
 *   • `usePlanCatalogue` — the Operator console's plans, plan matrix and all-orgs flags.
 *   • `useOrgPlan` / `useOperatorOrgs` — the console's org picker and its assigned plan.
 *   • `useOperatorResolvedFeatures` — the selected org's resolved set (state + source per key).
 *
 * Every key comes from `useOrgFeatures` so ONE `invalidateFeatureState` after any change refreshes
 * them all; none of these is cross-org shared.
 */

export function useOwnPlan() {
  return useQuery<PlanRow | null>({
    queryKey: OWN_PLAN_QUERY_KEY,
    queryFn: () => repositories.orgFeature.getOwnPlan(),
  });
}

export function usePlanCatalogue() {
  return useQuery<PlanCatalogue>({
    queryKey: PLAN_CATALOGUE_QUERY_KEY,
    queryFn: () => repositories.orgFeature.getPlanCatalogue(),
  });
}

export function useOrgPlan(orgId: string | null | undefined) {
  return useQuery<string | null>({
    queryKey: orgPlanQueryKey(orgId ?? 'none'),
    queryFn: () => repositories.orgFeature.getOrgPlan(orgId as string),
    enabled: Boolean(orgId),
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
  });
}
