import React from 'react';
import { useOrgFeatures } from '@/src/hooks/useOrgFeatures';
import {
  FEATURE_ENV_DEFAULT,
  isCoreFeature,
  type EntitleableKey,
  type OrgFeatureKey,
} from '@/src/lib/features';

/**
 * useFeature — resolve a per-org entitlement (ops-admin-surface S6, FR-ENT-005/006,
 * AC-ENT-003).
 *
 *   - Core keys (projects/dashboard/approvals/administration) are ALWAYS true and never query
 *     `org_features` (AC-ENT-002).
 *   - A stored `org_features` row OVERRIDES the env default.
 *   - Absence of a row falls back to `FEATURE_ENV_DEFAULT` (FR-ENT-004: absence = included).
 *
 * NOTE: this is UX-gating only (UI-hide first). A module's tables/RPCs are NOT yet
 * server-enforced (ADR-0049). The interim `isFeatureEnabled` env-flag reads for the env-only
 * sub-flags (`agentAssistant`/`userViews`/`aiComposer`) remain at their call sites (plan M5).
 */
// eslint-disable-next-line react-refresh/only-export-components -- hook co-located with its <FeatureGate> render-gate; HMR-only lint concern
export function useFeature(key: EntitleableKey): boolean {
  // Hooks must run unconditionally (rules-of-hooks) — call the query even for core keys, then
  // short-circuit the resolution. The query is a no-op cost when every consumer is core-only
  // (cached + deduped by react-query across all useFeature callers in the tree).
  const { data } = useOrgFeatures();
  if (isCoreFeature(key)) return true; // core never gated (AC-ENT-002)
  const k = key as OrgFeatureKey;
  const row = data?.[k];
  return row ?? FEATURE_ENV_DEFAULT[k];
}

/**
 * <FeatureGate> — content gate: renders children when `useFeature(feature)` is true, else null.
 * The content analog of <FeatureRoute> (which redirects the route element). Use for in-page
 * affordances; use <FeatureRoute> for whole routes.
 */
export const FeatureGate: React.FC<{
  feature: EntitleableKey;
  children: React.ReactNode;
}> = ({ feature, children }) => {
  if (!useFeature(feature)) return null;
  return <React.Fragment>{children}</React.Fragment>;
};
