// @vitest-environment jsdom
//
// AC-PHO-042: a business event honours the user's analytics opt-out against the REAL posthog-js SDK.
// An absence test needs a positive control, so the same call is first shown to reach the network.
import { beforeEach, describe, expect, it } from 'vitest';
import posthog from 'posthog-js';
import { analyticsClient } from './client';
import { trackBudgetActivated } from './business';
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

/**
 * Runs `run` and returns the URLs the SDK tried to send to. `_send_request` is the SDK's single egress
 * for every transport (XHR, fetch, beacon), so it is the one place that cannot miss a request.
 */
async function sentUrls(run: () => void): Promise<string[]> {
  const urls: string[] = [];
  analyticsClient.init(config);
  posthog.set_config({ request_batching: false });
  posthog._send_request = (options) => { urls.push(options.url); };
  run();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return urls;
}

beforeEach(() => {
  window.localStorage.clear();
  analyticsClient.__resetForTests();
});

describe('AC-PHO-042 business events and the analytics opt-out (real SDK)', () => {
  it('control: an opted-in user sends the event to the PostHog host', async () => {
    const urls = await sentUrls(() => trackBudgetActivated('Finance'));
    expect(urls.some((u) => u.startsWith('https://ph-e2e.invalid/'))).toBe(true);
  });

  it('an opted-out user sends nothing', async () => {
    analyticsClient.optOut();
    const urls = await sentUrls(() => trackBudgetActivated('Finance'));
    expect(urls).toEqual([]);
  });
});
