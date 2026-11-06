// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  __loaded: true,
  has_opted_out_capturing: vi.fn(() => false),
  get_session_id: vi.fn(() => 'sess-1'),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

import { agentAnalyticsFlag } from './agentAnalyticsFlag';
import { analyticsClient } from './client';
import type { AnalyticsConfig } from './config';

const config: AnalyticsConfig = {
  enabled: true, demoMode: false, replayAndAutocapture: false, posthogKey: 'phc_' + 'a'.repeat(24),
  posthogHost: 'https://us.i.posthog.com', appEnv: 'test', isProd: false, demoAudience: 'internal', demoAccount: 'local',
};

afterEach(() => {
  posthog.__loaded = true;
  posthog.has_opted_out_capturing.mockReturnValue(false);
  posthog.get_session_id.mockReturnValue('sess-1');
  window.localStorage.clear();
  analyticsClient.__resetForTests();
});

describe('AC-PHO-092 consent flag sent to agent-chat', () => {
  it('active analytics => consent with the replay session id', async () => {
    analyticsClient.init(config);
    await analyticsClient.ready();
    expect(agentAnalyticsFlag()).toEqual({ consent: true, sessionId: 'sess-1' });
  });
  it('SDK not loaded yet (deferred load pending) or never initialised => no flag', () => {
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('SDK opted out => no flag', async () => {
    analyticsClient.init(config);
    await analyticsClient.ready();
    posthog.has_opted_out_capturing.mockReturnValue(true);
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('our own persisted opt-out => no flag', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('a throwing SDK => no flag, never throws', async () => {
    analyticsClient.init(config);
    await analyticsClient.ready();
    posthog.get_session_id.mockImplementation(() => { throw new Error('x'); });
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
});
