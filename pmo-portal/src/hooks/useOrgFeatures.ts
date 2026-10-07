import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import { useRevenueMode } from '@/src/hooks/useRevenueMode';
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
 *
 * OD-NAR-2 (owner, 2026-10-07, #784): the `revenue` key is the one entitlement whose DEFAULT is
 * ownership-driven, so this hook — the single entitlement map every consumer (Rail, useFeature →
 * FeatureRoute/FeatureGate, Admin › Features) already reads — merges it here, ONE place:
 *   - an explicit `org_features` row always wins (an Operator can still turn revenue off);
 *   - with NO row, `revenue` follows ownership via `useRevenueMode()` (the repository's
 *     `routeWrite('revenue', map)` rule): ON when no ERP owns revenue (PMO-native invoicing is
 *     the default), OFF when an ERP owns it (ERP-connected orgs unchanged);
 *   - while ownership is still resolving the key stays OFF (hidden — no flash) and `isLoading`
 *     stays true so <FeatureRoute>'s null-hold (AC-ENT-005) covers the window too, instead of
 *     flash-redirecting a deep-link before ownership lands.
 */
export function useOrgFeatures() {
  const { currentUser } = useAuth();
  // Reused, not re-derived: useRevenueMode wraps the ownership query + routeWrite('revenue', map).
  const revenueMode = useRevenueMode();
  const query = useQuery<Record<OrgFeatureKey, boolean>>({
    queryKey: ['orgFeatures'],
    queryFn: () => repositories.orgFeature.listOwn(),
    enabled: Boolean(currentUser),
  });
  return useMemo(() => {
    const rows = query.data;
    if (!rows) return query; // org rows still loading → env defaults (unchanged behaviour)
    if (rows.revenue !== undefined) return query; // explicit row always wins (on or off)
    const revenue = revenueMode === 'native'; // unknown (undefined) and 'erp' both resolve OFF
    return {
      ...query,
      data: { ...rows, revenue },
      // Keep <FeatureRoute>'s null-hold engaged while the ownership default is still resolving.
      isLoading: query.isLoading || revenueMode === undefined,
    };
  }, [query, revenueMode]);
}
