/**
 * Feature flag gate tests (FR-AS-014, AS-OD-003).
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { it, expect } from 'vitest';
import { isFeatureEnabled } from './features';

it('aiComposer flag defaults to ON when unset (FR-AS-014, AS-OD-003; owner 2026-07-14)', () => {
  // ON BY DEFAULT: VITE_FEATURES_AI_COMPOSER unset (not 'false') → enabled.
  expect(isFeatureEnabled('aiComposer')).toBe(true);
});

it('userViews flag defaults to ON when unset (owner 2026-07-14)', () => {
  // ON BY DEFAULT: VITE_FEATURES_USERVIEWS unset (not 'false') → My Views UI reachable.
  expect(isFeatureEnabled('userViews')).toBe(true);
});

it('AC-PLN-004 the core set mirrors every never-gatable module', async () => {
  // D5 fixes these as rules, not entitlement: projects, budgets vs actual, approvals with SoD,
  // roles, expense claims, dashboard and administration; the spec keeps tasks core as well. The
  // FE registry mirrors the DB core list so a hidden module can never be gated on the client
  // while the server calls it core (or the reverse).
  const { CORE_FEATURES, FEATURE_LABELS, isCoreFeature } = await import('./features');
  for (const key of [
    'projects',
    'dashboard',
    'approvals',
    'administration',
    'expense_claims',
    'roles',
    'budgets',
    'tasks',
  ] as const) {
    expect(CORE_FEATURES as readonly string[]).toContain(key);
    expect(isCoreFeature(key)).toBe(true);
    expect(FEATURE_LABELS[key]).toBeTruthy();
  }
});
