import { useQuery, type QueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { FeatureResolution, OrgFeatureKey, ResolvedFeatureSet } from '@/src/lib/features';

/**
 * useOrgFeatures — the caller's own-org RESOLVED entitlement set (FR-PLN-005).
 *
 * ONE read: `repositories.orgFeature.listOwn()` → the `resolved_org_features()` projection. The
 * database owns the order (global → override → plan, core keys, and the revenue display rule of
 * FR-PLN-005a), so this hook no longer re-implements any of it: the old `useRevenueMode()` merge
 * (OD-NAR-2) is gone, because `display_enabled` already carries that answer.
 *
 * `data` is the display map navigation/routes read; `states` is the per-key detail (entitlement,
 * display value, source) the Operator console and the Admin "Your plan" page read from the same
 * call — no second query, no divergence.
 *
 * ⚑ Per-org query key. Two org contexts (own vs. the org an Operator is inspecting) must never
 * share a cached result, so the key carries the org id and every mutation invalidates the prefixes
 * through `invalidateFeatureState`.
 *
 * While the query is in flight `data` is undefined: consumers fall back to their placeholder and
 * `<FeatureRoute>` holds the route rather than guessing (AC-PLN-008).
 */

/** Own-org resolved set. The org id is part of the key so two org contexts cannot collide. */
export function orgFeatureQueryKey(orgId?: string | null) {
  return ['orgFeatures', 'own', orgId ?? 'anonymous'] as const;
}

/** The org an Operator is inspecting (console). Distinct from the own-org key on purpose. */
export function operatorFeatureQueryKey(orgId: string) {
  return ['orgFeatures', 'operator', orgId] as const;
}

/** Operator console catalogue (plans, limits, matrix, all-orgs flags). */
export const PLAN_CATALOGUE_QUERY_KEY = ['planCatalogue'] as const;

/** One org's assigned plan (Operator console). */
export function orgPlanQueryKey(orgId: string) {
  return ['orgPlan', orgId] as const;
}

/** The Admin's own plan + limits (Your plan). */
export const OWN_PLAN_QUERY_KEY = ['ownPlan'] as const;

/** The Operator org directory (console picker). */
export const OPERATOR_ORGS_QUERY_KEY = ['operator', 'orgs'] as const;

/**
 * Every switch/plan change invalidates the three prefixes that can have moved: the resolved sets
 * (own + inspected org), the catalogue and the assigned plans. One helper so no mutation can
 * forget one — a stale console is how a toggle "works" but the nav never changes.
 */
export function invalidateFeatureState(qc: QueryClient): Promise<void> {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ['orgFeatures'] }),
    qc.invalidateQueries({ queryKey: ['planCatalogue'] }),
    qc.invalidateQueries({ queryKey: ['orgPlan'] }),
    qc.invalidateQueries({ queryKey: ['ownPlan'] }),
  ]).then(() => undefined);
}

export interface OrgFeaturesState {
  /** Display map (nav, routes, gates). Undefined until the resolved set lands. */
  data?: Record<OrgFeatureKey, boolean>;
  /** Per-key detail: entitlement, display value and source. */
  states?: Partial<Record<OrgFeatureKey, FeatureResolution>>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

export function useOrgFeatures(): OrgFeaturesState {
  const { currentUser } = useAuth();
  const query = useQuery<ResolvedFeatureSet>({
    queryKey: orgFeatureQueryKey(currentUser?.org_id),
    queryFn: () => repositories.orgFeature.listOwn(),
    enabled: Boolean(currentUser),
  });
  return {
    data: query.data?.display,
    states: query.data?.states,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: () => {
      void query.refetch();
    },
  };
}
