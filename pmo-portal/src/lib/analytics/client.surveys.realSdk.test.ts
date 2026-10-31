// @vitest-environment jsdom
// AC-PHO-103: a mock cannot say what the real SDK does with the option, so init the real one.
import { describe, expect, it } from 'vitest';
import posthog from 'posthog-js';
import { buildPosthogInitOptions } from './client';
import type { AnalyticsConfig } from './config';

const config: AnalyticsConfig = {
  enabled: true, demoMode: false, analyticsEnabled: true, replayAndAutocapture: false,
  posthogKey: 'phc_' + 'a'.repeat(24), posthogHost: 'https://ph-e2e.invalid', appEnv: 'test',
  isDev: false, isProd: false, demoAudience: 'internal', demoAccount: 'local',
};

describe('AC-PHO-103 real SDK keeps survey display in the app\'s hands', () => {
  it('the live instance has automatic display off and surveys still enabled for the manual API', () => {
    const original = global.fetch;
    global.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })) as unknown as typeof fetch;
    try {
      const instance = posthog.init(config.posthogKey, buildPosthogInitOptions(config), 'survey-gate-probe');
      expect(instance?.config.disable_surveys_automatic_display).toBe(true);
      expect(instance?.config.disable_surveys).toBe(false);
    } finally {
      global.fetch = original;
    }
  });
});
