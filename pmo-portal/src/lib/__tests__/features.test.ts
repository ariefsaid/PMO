/**
 * Unit tests for the interim UI feature flag seam (src/lib/features.ts).
 *
 * These tests assert the CURRENT (flag-off) state. The gate is proven real by
 * verifying that the flag is false (not deleted/missing), and the helper
 * isFeatureEnabled() correctly reflects it. Flipping `FEATURES.incidents` to
 * `true` in features.ts should make the "flag-off" assertions fail — that's the
 * mechanism proof. The full-stack re-enable path is documented in features.ts.
 */
import { describe, it, expect } from 'vitest';
import { FEATURES, isFeatureEnabled } from '../features';

describe('FEATURES interim flag registry', () => {
  it('incidents flag is false (module hidden from UI)', () => {
    // AC: flag-off = Incidents UI is hidden. Flip FEATURES.incidents to true to re-enable.
    expect(FEATURES.incidents).toBe(false);
  });

  it('isFeatureEnabled("incidents") returns false', () => {
    expect(isFeatureEnabled('incidents')).toBe(false);
  });

  it('isFeatureEnabled reflects the const — the flag object is the single authority', () => {
    // This test is the canary: if someone changes FEATURES.incidents to true,
    // the assertion above fails and the gate is visibly reversed.
    expect(isFeatureEnabled('incidents')).toBe(FEATURES.incidents);
  });
});
