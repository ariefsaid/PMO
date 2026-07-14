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
