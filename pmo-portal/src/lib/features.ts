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
} as const;

export type FeatureKey = keyof typeof FEATURES;

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key];
}

// ── Per-org entitlement registry (ops-admin-surface S6, FR-ENT-001..004) ──────────
//
// Two distinct but related notions of "feature" coexist here. Naming them explicitly so the
// relationship is clear and the two never collide at a type level:
//
//   • `FeatureKey` (above) — the INTERIM UI-hide flags (`incidents`/`userViews`/`aiComposer`/
//     `agentAssistant`). These are read directly from the env by call sites that pre-date the
//     entitlements system (Assistant panel, ViewBuilder compose button, analytics, …). They are
//     NOT org entitlements and stay env-driven. Other modules still import `isFeatureEnabled`.
//
//   • `OrgFeatureKey` (below) — the per-org ENTITLEMENT keys persisted in `public.org_features`
//     and resolved at runtime by `useFeature()`. A subset maps onto the interim flags
//     (`incidents`, `agent_assistant`↔`agentAssistant`, `user_views`↔`userViews`); the rest
//     (`crm`/`procurement`/`timesheets`/`import_export`) are new gatable candidates.
//
//   • `EntitleableKey` — the union of `OrgFeatureKey | CoreFeature`, the full argument set
//     accepted by `useFeature()` (core keys are always-on, never persisted, never queried).
//
// The interim `isFeatureEnabled('agentAssistant'|'userViews'|'aiComposer')` reads are KEPT as-is
// for the env-only sub-flags (plan M5 note). The new entitlement path (`useFeature`) is the
// forward system; the two coexist until the env flags are folded into entitlements (future issue).

/**
 * Gatable per-org entitlement keys persisted in `public.org_features` (FR-ENT-001).
 *
 * `agent_assistant` + `user_views` are INCLUDED in the registry (an Operator may toggle them —
 * the row is the forward system) but they are NOT in `FEATURE_KEYS_TOGGLEABLE`: their EFFECTIVE
 * gate today is still the env flag at the call site (AssistantPanel/ViewBuilder read
 * `isFeatureEnabled('agentAssistant'|'userViews')` directly, plan M5). So in the Admin › Features
 * UI these two render as a read-only "Preview" until the env flags are folded into entitlements
 * (future issue) — toggling them would otherwise look like a no-op. The other keys take effect
 * immediately via `useFeature` (Rail/FeatureRoute).
 */
export const FEATURE_KEYS = [
  'incidents',
  'crm',
  'procurement',
  'timesheets',
  'import_export',
  'agent_assistant',
  'user_views',
  'm365_integration',
] as const;
export type OrgFeatureKey = (typeof FEATURE_KEYS)[number];

/**
 * The subset whose toggle takes effect IMMEDIATELY in the UI ( Rail/FeatureRoute resolve them via
 * `useFeature`). The env-gated keys (`agent_assistant`/`user_views`) are excluded — they render
 * read-only in the Features section because their effective gate is still the deployment env flag.
 */
export const FEATURE_KEYS_TOGGLEABLE: readonly OrgFeatureKey[] = [
  'incidents',
  'crm',
  'procurement',
  'timesheets',
  'import_export',
  'm365_integration',
];

/** Core modules — always enabled, never gated, never persisted (FR-ENT-001/007, AC-ENT-002). */
export const CORE_FEATURES = ['projects', 'dashboard', 'approvals', 'administration'] as const;
export type CoreFeature = (typeof CORE_FEATURES)[number];

/** The full key set `useFeature()` accepts: gatable entitlements + core modules. */
export type EntitleableKey = OrgFeatureKey | CoreFeature;

/**
 * Env-default map — the value an org sees when it has NO `org_features` row for the key
 * (FR-ENT-004: absence = included; staging/demo unchanged until an Operator toggles). This is
 * the DEFAULT only; a stored row always overrides it (see `useFeature`).
 */
export const FEATURE_ENV_DEFAULT: Record<OrgFeatureKey, boolean> = {
  incidents: false,
  crm: import.meta.env.VITE_FEATURES_CRM === 'true' || false,
  procurement: true,
  timesheets: true,
  import_export: true,
  agent_assistant: import.meta.env.VITE_FEATURES_AGENT_ASSISTANT === 'true' || false,
  user_views: import.meta.env.VITE_FEATURES_USERVIEWS === 'true' || false,
  m365_integration: false,
};

/** Human-readable labels for the Admin › Features section (AC-ENT-004). */
export const FEATURE_LABELS: Record<EntitleableKey, string> = {
  incidents: 'Incidents',
  crm: 'CRM (Sales Pipeline, Companies, Contacts)',
  procurement: 'Procurement',
  timesheets: 'Timesheets',
  import_export: 'Import / Export',
  agent_assistant: 'Agent Assistant',
  user_views: 'User Views',
  m365_integration: 'Microsoft 365 integration',
  projects: 'Projects',
  dashboard: 'Dashboard',
  approvals: 'Approvals',
  administration: 'Administration',
};

/** Type guard: true for the four core modules (always-on, never gated). */
export function isCoreFeature(key: string): key is CoreFeature {
  return (CORE_FEATURES as readonly string[]).includes(key);
}
