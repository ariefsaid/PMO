// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  __loaded: true,
  has_opted_out_capturing: vi.fn(() => false),
  get_session_id: vi.fn(() => 'sess-1'),
}));
vi.mock('posthog-js', () => ({ default: posthog }));

import { agentAnalyticsFlag } from './agentAnalyticsFlag';

afterEach(() => {
  posthog.__loaded = true;
  posthog.has_opted_out_capturing.mockReturnValue(false);
  posthog.get_session_id.mockReturnValue('sess-1');
  window.localStorage.clear();
});

describe('AC-PHO-092 consent flag sent to agent-chat', () => {
  it('active analytics => consent with the replay session id', () => {
    expect(agentAnalyticsFlag()).toEqual({ consent: true, sessionId: 'sess-1' });
  });
  it('SDK never initialised (disabled, DNT, opted out at load) => no flag', () => {
    posthog.__loaded = false;
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('SDK opted out => no flag', () => {
    posthog.has_opted_out_capturing.mockReturnValue(true);
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('our own persisted opt-out => no flag', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
  it('a throwing SDK => no flag, never throws', () => {
    posthog.get_session_id.mockImplementation(() => { throw new Error('x'); });
    expect(agentAnalyticsFlag()).toBeUndefined();
  });
});
