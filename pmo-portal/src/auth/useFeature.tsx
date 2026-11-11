import React from 'react';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import {
  ENV_FEATURE_GATES,
  FEATURE_ENV_DEFAULT,
  isCoreFeature,
  isFeatureEnabled,
  type EntitleableKey,
  type OrgFeatureKey,
} from '@/src/lib/features';

/**
 * useFeature — resolve a per-org entitlement (FR-PLN-005, AC-PLN-008).
 *
 *   - Core keys (see CORE_FEATURES in lib/features) are ALWAYS true and never wait for a read
 *     (AC-ENT-002).
 *   - Everything else is the database projection's `display_enabled`: global → override → plan is
 *     resolved ONCE in the database (`resolved_org_features()`, 0532/0533), never re-implemented
 *     here. `revenue`'s ERP-ownership display rule arrives inside that answer (FR-PLN-005a).
 *   - Until the read lands, the placeholder (`FEATURE_ENV_DEFAULT`) is used so the rail can paint;
 *     routes hold instead of guessing (see <FeatureRoute>).
 *   - `agent_assistant` and `user_views` AND their deployment kill switch (VITE_FEATURES_*): a
 *     capability the deployment turned off cannot be granted by an Operator, and this is the ONE
 *     place the AND lives, so no caller can forget it.
 *
 * NOTE: this is still UX-gating only. Since S2 the server refuses writes for a disabled module
 * (FR-PLN-006); the FE gate exists so the affordance is not offered at all.
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its declarative render gate
export function useFeature(key: EntitleableKey): boolean {
  // Hooks must run unconditionally (rules-of-hooks) — call the query even for core keys, then
  // short-circuit. The query is cached and deduped across every useFeature caller in the tree.
  const { data } = useOrgFeatures();
  if (isCoreFeature(key)) return true; // core never gated (AC-PLN-002, D5)
  const k = key as OrgFeatureKey;
  const gate = ENV_FEATURE_GATES[k];
  if (gate && !isFeatureEnabled(gate)) return false; // deployment kill switch wins
  return data?.[k] ?? FEATURE_ENV_DEFAULT[k];
}

export const FeatureGate: React.FC<{
  feature: EntitleableKey;
  children: React.ReactNode;
}> = ({ feature, children }) => {
  if (!useFeature(feature)) return null;
  return <React.Fragment>{children}</React.Fragment>;
};
