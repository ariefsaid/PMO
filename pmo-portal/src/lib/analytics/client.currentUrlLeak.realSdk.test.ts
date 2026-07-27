// @vitest-environment jsdom
//
// SECURITY (2026-07-27 review round 2 #6): `routeAnalyticsForPath` carefully parameterises our
// OWN `route` property to `/projects/:projectId` — but posthog-js attaches its own `$current_url`
// / `$pathname` / `$initial_current_url` automatically to EVERY captured event, straight from
// `window.location`, independent of whatever properties we pass. Spec §6 forbids raw UUID paths.
// A config-only assertion (checking `POSTHOG_PROPERTY_DENYLIST` contains the right strings) is
// exactly the kind of check that missed the `capture_dead_clicks` leak two days ago — it proves
// what we told the SDK to do, never what the SDK actually does. This file inits the REAL SDK,
// captures a REAL event on a location containing a raw UUID, and inspects the actual returned
// captured payload (`posthog.capture()` returns the exact `{ event, properties, ... }` object
// enqueued for the network, after `property_denylist` deletion and `before_send` both ran).
import { describe, it, expect } from 'vitest';
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

const RAW_UUID_PATH = '/projects/550e8400-e29b-41d4-a716-446655440000';

describe('$current_url / $pathname raw-UUID leak — the REAL SDK captured payload (SECURITY #6)', () => {
  it('a route containing a raw record UUID never reaches $current_url/$pathname/$initial_current_url on the actual captured event', () => {
    window.history.pushState({}, '', RAW_UUID_PATH);
    expect(window.location.pathname).toBe(RAW_UUID_PATH);

    const data = withStubbedNetwork(() => {
      analyticsClient.init(config);
      // The app's own facade always passes the ALREADY-parameterised route (routeAnalyticsForPath)
      // — the point of this test is what the SDK adds on top, not what we passed in.
      return posthog.capture('app_route_viewed', { route: '/projects/:projectId' });
    });

    expect(data).toBeDefined();
    const props = data!.properties as Record<string, unknown>;
    expect(props['$current_url']).toBeUndefined();
    expect(props['$pathname']).toBeUndefined();
    expect(props['$initial_current_url']).toBeUndefined();
    // Nothing in the captured payload contains the raw UUID at all (belt + suspenders — catches
    // any OTHER SDK-attached property carrying the raw URL that isn't one of the 3 named above).
    expect(JSON.stringify(props)).not.toMatch(/550e8400-e29b-41d4-a716-446655440000/);
    // Our own sanitized, parameterized property is untouched.
    expect(props['route']).toBe('/projects/:projectId');
  });
});
