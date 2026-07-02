// Interim hardcoded UI feature flags ("UI-hide first"). The full per-org entitlement
// system (org_features + useFeature/<FeatureGate> + RLS) is backlogged — see
// docs/backlog.md §OPEN feature tracks. To re-enable a module, flip its flag to true.
// NOTE: this is UI-gating only — the module's tables/RPCs are NOT server-enforced yet,
// so a direct API call can still reach them. That's acceptable for hiding an unused
// module; it must be server-enforced before any feature becomes paid.
export const FEATURES = {
  incidents: false,
  userViews: import.meta.env.VITE_FEATURES_USERVIEWS === 'true' || false,  // I3: user-view renderer; flip to true to enable (FR-VR-001)
  // I5: AI composer sub-flag (AS-OD-003). Gated AND-wise with userViews.
  // Allows disabling AI compose without disabling the whole User Views feature
  // (e.g. when the function secret for the AI service is absent in an environment).
  aiComposer: import.meta.env.VITE_FEATURES_AI_COMPOSER === 'true' || false,
  // A2 (ADR-0040): the in-app agent AssistantPanel + ⌘J. UI-hide-first; off by default.
  agentAssistant: import.meta.env.VITE_FEATURES_AGENT_ASSISTANT === 'true' || false,
  // E3 (ADR-0040): mount agent-native's real UI (<AgentNativeEmbedded>) inside the PMO
  // shell, same React tree, themed by PMO tokens. Staged adoption — OFF by default so the
  // existing AssistantPanel (agentAssistant) stays the live surface. When ON, the shell is
  // wrapped by <AgentNativeEmbedded> and the legacy panel is hidden (staged retirement is E8).
  agentNativeEmbed: import.meta.env.VITE_AGENT_NATIVE_EMBED === 'true' || false,
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}
