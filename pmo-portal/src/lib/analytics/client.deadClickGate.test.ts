// @vitest-environment jsdom
//
// SECURITY REGRESSION (2026-07-27): a live capture of the REAL SDK, with capture_dead_clicks:true
// (this file's whole reason to exist), returned a `$dead_click` event carrying
// `$el_text: "MYR 4,250,000.00"` and, on a second run, `attr__title: "Approve contract for
// Petronas Carigali"` — i.e. raw rendered business text. `client.test.ts`'s equivalent assertion
// (`capture_dead_clicks === true` at the time) passed against a MOCKED posthog-js and could never
// have caught this — a mock cannot tell you what a real SDK does with a config value.
//
// This file does NOT mock posthog-js. It inits the REAL SDK, as a separate NAMED instance (so it
// never touches the module-singleton `posthog` other test files import), with our EXACT production
// options object (`buildPosthogInitOptions`, not a hand-copied duplicate), and asserts against the
// SDK's OWN internal gating function for whether the leaky, event-emitting dead-click producer is
// enabled — not our assumption about what the config value does.
import { describe, expect, it } from 'vitest';
import posthog from 'posthog-js';
import type { DeadClicksAutocapture } from 'posthog-js/lib/src/extensions/dead-clicks-autocapture';
import {
  isDeadClicksEnabledForAutocapture,
  isDeadClicksEnabledForHeatmaps,
} from 'posthog-js/lib/src/extensions/dead-clicks-autocapture';
import { buildPosthogInitOptions } from './client';
import type { AnalyticsConfig } from './config';

const config: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  analyticsEnabled: true,
  replayAndAutocapture: false,
  posthogKey: 'phc_' + 'a'.repeat(24),
  posthogHost: 'https://ph-e2e.invalid',
  appEnv: 'test',
  isDev: false,
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

/** Stub the network for the duration of a real `posthog.init()` call — no request should actually
 * leave the process (there is nothing at `ph-e2e.invalid` to receive it, and it isn't the point:
 * the point is the SDK's in-memory gating decision, made synchronously during init). */
function withStubbedNetwork<T>(run: () => T): T {
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  })) as unknown as typeof fetch;
  try {
    return run();
  } finally {
    global.fetch = originalFetch;
  }
}

describe('capture_dead_clicks gate — the REAL SDK, not a mock (AC-CON-005 SECURITY)', () => {
  it('our production config disables the autocapture-gated $dead_click producer (the one that leaked "MYR 4,250,000.00" / a contract counterparty name via $el_text)', () => {
    const instance = withStubbedNetwork(() =>
      posthog.init(config.posthogKey, buildPosthogInitOptions(config), 'dead-click-gate-probe-1'),
    );

    expect(instance).toBeDefined();
    expect(instance!.config.capture_dead_clicks).toBe(false);
    expect(instance!.deadClicksAutocapture).toBeDefined();
    // The REAL function posthog-js itself uses to decide whether the leaky, element-text-carrying
    // `$dead_click` event ever fires. Not our assumption — the SDK's own logic, on our real config.
    expect(
      // The `posthog-js` default import types against `dist/`; the pure gating function is only
      // importable from `lib/src` — same class, compiled twice, so TS sees a nominal mismatch on
      // a private field. `unknown` first, per the compiler's own suggestion (TS2352).
      isDeadClicksEnabledForAutocapture(instance!.deadClicksAutocapture as unknown as DeadClicksAutocapture),
    ).toBe(false);
  });

  it('heatmaps keep their OWN, always-on dead-click coordinate detector — the unbilled, text-free signal spec §5.1 actually wanted is untouched by this fix', () => {
    // isDeadClicksEnabledForHeatmaps() takes no config at all — it is unconditionally true by
    // design (posthog-js/lib/src/extensions/dead-clicks-autocapture.js). Asserting that here
    // documents, rather than merely asserts, that setting capture_dead_clicks:false does not
    // silently also remove the heatmap-coordinate signal spec §5.1 justified this feature on.
    expect(isDeadClicksEnabledForHeatmaps()).toBe(true);
  });

  it('regression guard: if a future edit flips capture_dead_clicks back to true, this test fails against the REAL SDK\'s gate, not just a mocked assertion', () => {
    const instance = withStubbedNetwork(() =>
      posthog.init(
        config.posthogKey,
        { ...buildPosthogInitOptions(config), capture_dead_clicks: true },
        'dead-click-gate-probe-2',
      ),
    );
    expect(
      // The `posthog-js` default import types against `dist/`; the pure gating function is only
      // importable from `lib/src` — same class, compiled twice, so TS sees a nominal mismatch on
      // a private field. `unknown` first, per the compiler's own suggestion (TS2352).
      isDeadClicksEnabledForAutocapture(instance!.deadClicksAutocapture as unknown as DeadClicksAutocapture),
    ).toBe(true);
  });
});
