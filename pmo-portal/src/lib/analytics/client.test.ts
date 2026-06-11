import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsConfig } from './config';

/** Type for PostHog's captured network request object */
type CapturedNetworkRequest = {
  name: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  [key: string]: unknown;
};

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient } from './client';

const base: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  analyticsEnabled: true,
  replayAndAutocapture: false,
  posthogKey: 'ph_test',
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isDev: false,
  isProd: false,
  demoAudience: 'internal',
  demoAccount: 'local',
};

beforeEach(() => {
  posthog.init.mockReset();
  posthog.capture.mockReset();
  posthog.identify.mockReset();
  posthog.register.mockReset();
  posthog.reset.mockReset();
  analyticsClient.__resetForTests();
});

describe('analyticsClient', () => {
  it('AC-PH-001: disabled mode does not init', () => {
    analyticsClient.init({ ...base, enabled: false });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('AC-PH-001: disabled mode does not init even with key', () => {
    analyticsClient.init({ ...base, enabled: false, posthogKey: 'ph_real' });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('AC-PH-002/003/004: initializes once with host and no replay/autocapture in analytics-only mode', () => {
    analyticsClient.init(base);
    analyticsClient.init(base);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith('ph_test', expect.objectContaining({
      api_host: 'https://us.i.posthog.com',
      autocapture: false,
      disable_session_recording: true,
      enable_heatmaps: false,
    }));
  });

  it('AC-PH-005: deployed prospect demo enables replay and click-only autocapture', () => {
    analyticsClient.init({
      ...base,
      demoMode: true,
      replayAndAutocapture: true,
      demoAudience: 'prospect',
      demoAccount: 'comp1',
    });
    expect(posthog.init).toHaveBeenCalledWith('ph_test', expect.objectContaining({
      disable_session_recording: false,
      autocapture: expect.objectContaining({
        dom_event_allowlist: ['click'],
        element_allowlist: ['a', 'button'],
        capture_copied_text: false,
      }),
    }));
  });

  it('AC-PH-009/010: identifies, registers org context, and resets', () => {
    analyticsClient.init(base);
    analyticsClient.identify({ userId: 'u1', role: 'Project Manager', orgId: 'o1' });
    expect(posthog.identify).toHaveBeenCalledWith('u1', { role: 'Project Manager' });
    expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({ org_id: 'o1', role: 'Project Manager' }));
    analyticsClient.reset();
    expect(posthog.reset).toHaveBeenCalled();
  });

  it('does not identify when not initialized', () => {
    analyticsClient.identify({ userId: 'u1', role: 'Project Manager', orgId: 'o1' });
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.register).not.toHaveBeenCalled();
  });

  it('does not capture when not initialized', () => {
    analyticsClient.capture('app_route_viewed', { route: '/', module: 'dashboard' });
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('does not reset when not initialized', () => {
    analyticsClient.reset();
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it('does not init when posthogKey is empty', () => {
    analyticsClient.init({ ...base, posthogKey: '' });
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it('capture passes safe properties through', () => {
    analyticsClient.init(base);
    analyticsClient.capture('app_route_viewed', { route: '/projects', module: 'projects' });
    expect(posthog.capture).toHaveBeenCalledWith('app_route_viewed', expect.objectContaining({
      route: '/projects',
      module: 'projects',
    }));
  });

  it('register passes safe properties through', () => {
    analyticsClient.init(base);
    analyticsClient.register({ environment: 'test', demo_audience: 'internal' });
    expect(posthog.register).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'test',
      demo_audience: 'internal',
    }));
  });

  describe('replay network masking (deployed prospect demo)', () => {
    it('AC-PH-NET-001: session_recording must set recordHeaders:false and recordBody:false', () => {
      analyticsClient.init({
        ...base,
        demoMode: true,
        replayAndAutocapture: true,
        demoAudience: 'prospect',
        demoAccount: 'comp1',
      });
      const [, opts] = posthog.init.mock.calls[0];
      expect(opts.session_recording).toEqual(expect.objectContaining({
        recordHeaders: false,
        recordBody: false,
      }));
    });

    it('AC-PH-NET-002: maskCapturedNetworkRequestFn strips query strings from URL', () => {
      analyticsClient.init(base);
      const [, opts] = posthog.init.mock.calls[0];
      const fn = opts.session_recording!.maskCapturedNetworkRequestFn!;
      const request: CapturedNetworkRequest = { name: 'https://api.example.com/data?token=secret&user=alice' };
      const result = fn(request);
      expect(result.name).toBe('https://api.example.com/data');
    });

    it('AC-PH-NET-003: maskCapturedNetworkRequestFn removes requestHeaders, responseHeaders, requestBody, responseBody', () => {
      analyticsClient.init(base);
      const [, opts] = posthog.init.mock.calls[0];
      const fn = opts.session_recording!.maskCapturedNetworkRequestFn!;
      const request: CapturedNetworkRequest = {
        name: 'https://api.example.com/data',
        requestHeaders: { authorization: 'Bearer secret' },
        responseHeaders: { 'set-cookie': 'session=abc' },
        requestBody: '{"password":"hunter2"}',
        responseBody: '{"token":"abc"}',
      };
      const result = fn(request);
      expect(result).not.toHaveProperty('requestHeaders');
      expect(result).not.toHaveProperty('responseHeaders');
      expect(result).not.toHaveProperty('requestBody');
      expect(result).not.toHaveProperty('responseBody');
      // name should still be present (with query stripped)
      expect(result.name).toBe('https://api.example.com/data');
    });
  });
});
