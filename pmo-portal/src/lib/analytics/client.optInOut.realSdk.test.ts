// @vitest-environment jsdom
//
// The opt-out/opt-in round trip against the REAL posthog-js SDK, not `client.test.ts`'s mock.
// A mocked `posthog.opt_in_capturing`/`opt_out_capturing`/`has_opted_out_capturing` can prove we
// CALLED the right method, but not that the SDK's own internal consent state actually ends up
// where we think — which is exactly the MEDIUM defect this file exists to regression-test: opting
// back in after a reload used to leave the SDK's OWN persisted opt-out untouched (a separate key
// from ours), so traffic resumed but events silently never did.
//
// This file does not mock 'posthog-js'. `analyticsClient` (from ./client) drives the REAL default
// singleton; real `window.localStorage` (jsdom) is what both our own flag and the SDK's persisted
// consent state live in, which is what makes a simulated "reload" (resetting our module state
// without clearing storage) a faithful analogue of a real one.
import { beforeEach, describe, expect, it } from 'vitest';
import posthog from 'posthog-js';
import { analyticsClient } from './client';
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

beforeEach(() => {
  window.localStorage.clear();
  analyticsClient.__resetForTests();
});

describe('opt-out/opt-in round trip — the REAL SDK, not a mock', () => {
  it('AC-CON-003: optOut() makes the real SDK report has_opted_out_capturing() === true immediately, in the current session', () => {
    withStubbedNetwork(() => analyticsClient.init(config));
    analyticsClient.optOut();
    expect(posthog.has_opted_out_capturing()).toBe(true);
  });

  it('AC-CON-002 (MEDIUM fix): opting back in AFTER A SIMULATED RELOAD flips the REAL SDK\'s own persisted consent state, not just our localStorage flag', () => {
    // Session 1: opt out. This persists BOTH our own flag and the SDK's own consent key.
    withStubbedNetwork(() => analyticsClient.init(config));
    analyticsClient.optOut();
    expect(posthog.has_opted_out_capturing()).toBe(true);

    // Simulated reload: our in-memory module state resets (a real reload re-runs this whole
    // module from scratch); real localStorage — where BOTH consent keys live — survives, exactly
    // like an actual browser reload. `init()` is skipped because our own flag still says opted out.
    analyticsClient.__resetForTests();
    withStubbedNetwork(() => analyticsClient.init(config));
    expect(analyticsClient.hasOptedOut()).toBe(true);

    // The user opts back in.
    analyticsClient.optIn();

    expect(analyticsClient.hasOptedOut()).toBe(false);
    // The load-bearing assertion: the REAL SDK's own persisted consent state must ALSO have
    // flipped — not just our flag. Before the fix, `initialized` was false at this point (init()
    // had been skipped above), so `optIn()` only ran `doInit()` and never called
    // `posthog.opt_in_capturing()` — the SDK's own persisted opt-out survived, and this assertion
    // would have failed (traffic resumes, but the SDK privately still believes this browser opted
    // out, so events never do).
    expect(posthog.has_opted_out_capturing()).toBe(false);
  });
});
