/**
 * Feature flag gate tests (FR-AS-014, AS-OD-003).
 * AC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { it, expect } from 'vitest';
import { isFeatureEnabled } from './features';

it('aiComposer flag defaults to false (FR-AS-014, AS-OD-003)', () => {
  // In the test environment VITE_FEATURES_AI_COMPOSER is not set → defaults to false
  expect(isFeatureEnabled('aiComposer')).toBe(false);
});

it('userViews flag defaults to false unless VITE_FEATURES_USERVIEWS is set', () => {
  // In the test environment VITE_FEATURES_USERVIEWS is not set → defaults to false
  expect(isFeatureEnabled('userViews')).toBe(false);
});
