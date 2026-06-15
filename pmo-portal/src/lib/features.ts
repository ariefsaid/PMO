// Interim hardcoded UI feature flags ("UI-hide first"). The full per-org entitlement
// system (org_features + useFeature/<FeatureGate> + RLS) is backlogged — see
// docs/backlog.md §OPEN feature tracks. To re-enable a module, flip its flag to true.
// NOTE: this is UI-gating only — the module's tables/RPCs are NOT server-enforced yet,
// so a direct API call can still reach them. That's acceptable for hiding an unused
// module; it must be server-enforced before any feature becomes paid.
export const FEATURES = {
  incidents: false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}
