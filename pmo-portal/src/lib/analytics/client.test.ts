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
  captureException: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient, POSTHOG_PROPERTY_DENYLIST } from './client';

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
  posthog.captureException.mockReset();
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

  it('AC-PH-011: the SDK property_denylist excludes the PostHog auth field `token` but keeps PII keys (issue #3438 — denylisting token → tokenless /e/ → 401)', () => {
    // The exported constant: `token` removed (it IS PostHog's api_key field on capture),
    // PII keys retained.
    expect(POSTHOG_PROPERTY_DENYLIST).not.toContain('token');
    expect(POSTHOG_PROPERTY_DENYLIST).toContain('email');
    expect(POSTHOG_PROPERTY_DENYLIST).toContain('access_token');
    // And it's actually what gets handed to posthog.init.
    analyticsClient.init(base);
    const initConfig = posthog.init.mock.calls.at(-1)?.[1] as { property_denylist: string[] };
    expect(initConfig.property_denylist).not.toContain('token');
    expect(initConfig.property_denylist).toContain('email');
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

  describe('captureException', () => {
    it('AC-OF-008: no-ops (no posthog call) when not initialized', () => {
      analyticsClient.__resetForTests();
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).not.toHaveBeenCalled();
    });

    it('AC-OF-008: no-ops when initialized but activeConfig.enabled is false', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: false });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).not.toHaveBeenCalled();
    });

    it('AC-OF-009: enabled analytics calls posthog.captureException (not a hand-rolled $exception event)', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
      expect(posthog.captureException).toHaveBeenCalledTimes(1);
      expect(posthog.capture).not.toHaveBeenCalledWith('$exception', expect.anything());
    });

    it('AC-OF-009: componentStack is attached to the synthetic Error when supplied', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      analyticsClient.captureException({ name: 'TypeError', message: 'boom', componentStack: '    in Foo' });
      const passedError = posthog.captureException.mock.calls[0][0] as Error & { componentStack?: string };
      expect(passedError.componentStack).toBe('    in Foo');
    });

    it('FR-OF-011: the before_send hook registered at init() redacts $exception_* properties on an outbound exception event', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      // Pull the registered hook straight off the posthog.init call — proves redaction is wired
      // as a before_send hook at init(), not as inline string-munging inside captureException
      // itself (FR-OF-011/DC-OF-002: "via a before_send / payload-transform hook", not the call site).
      const [, initOpts] = posthog.init.mock.calls[0];
      const beforeSend = initOpts.before_send as (cr: unknown) => unknown;
      expect(typeof beforeSend).toBe('function');

      const rawEvent = {
        uuid: 'u1',
        event: '$exception',
        properties: {
          $exception_message: 'Cannot read props of /projects/abc?token=secret123',
          $exception_list: [{ value: 'token=secret123 in stack' }],
          other_prop: 'unchanged',
        },
      };
      const result = beforeSend(rawEvent) as typeof rawEvent;
      expect(result.properties.$exception_message).not.toContain('?token=secret123');
      expect(result.properties.$exception_message).not.toMatch(/token/i);
      expect(JSON.stringify(result.properties.$exception_list)).not.toMatch(/token/i);
      expect(result.properties.other_prop).toBe('unchanged');
    });

    it('FR-OF-011: the before_send hook passes through a non-exception event unchanged', () => {
      analyticsClient.__resetForTests();
      analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
      const [, initOpts] = posthog.init.mock.calls[0];
      const beforeSend = initOpts.before_send as (cr: unknown) => unknown;
      const rawEvent = { uuid: 'u2', event: 'app_route_viewed', properties: { route: '/projects' } };
      expect(beforeSend(rawEvent)).toEqual(rawEvent);
    });

    describe('FR-OF-011: redaction hardening — 4 named leak vectors (fix round)', () => {
      function redactViaBeforeSend(exceptionMessage: string): string {
        analyticsClient.__resetForTests();
        analyticsClient.init({ ...base, enabled: true, posthogKey: 'phc_' + 'a'.repeat(20) });
        const [, initOpts] = posthog.init.mock.calls[0];
        const beforeSend = initOpts.before_send as (cr: unknown) => { properties: { $exception_message: string } };
        const result = beforeSend({
          uuid: 'u1',
          event: '$exception',
          properties: { $exception_message: exceptionMessage },
        });
        return result.properties.$exception_message;
      }

      it('vector 1 — a JWT in a URL PATH (not a query string) is redacted', () => {
        const jwt =
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PYb4LddF';
        const redacted = redactViaBeforeSend(`GET https://api/reset/${jwt} failed`);
        expect(redacted).not.toContain(jwt);
        expect(redacted).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
      });

      it('vector 2 — a bearer token with no `key=` shape is redacted', () => {
        const redacted = redactViaBeforeSend('Authorization: Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890');
        expect(redacted).not.toContain('sk-or-v1-abcdefghijklmnopqrstuvwxyz1234567890');
        expect(redacted).not.toMatch(/Bearer\s+sk-/);
      });

      it('vector 3 — a JSON-shaped forbidden key ("key":value, no `key=`) is redacted, including the key name', () => {
        const redacted = redactViaBeforeSend(
          'Failed to save {"contract_value":5000000,"notes":"secret"}',
        );
        expect(redacted).not.toContain('5000000');
        expect(redacted).not.toContain('secret');
        expect(redacted).not.toMatch(/"contract_value"\s*:/);
        expect(redacted).not.toMatch(/"notes"\s*:/);
      });

      it('vector 4 — a bare email (no key= / key: prefix) is redacted', () => {
        const redacted = redactViaBeforeSend('User alice@acme.com not found');
        expect(redacted).not.toContain('alice@acme.com');
      });

      it('a generic 32+ char high-entropy secret-looking token is redacted even with no keyword nearby', () => {
        const redacted = redactViaBeforeSend('token dump: abcdEFGH1234ijklMNOP5678qrstUVWX');
        expect(redacted).not.toContain('abcdEFGH1234ijklMNOP5678qrstUVWX');
      });
    });
  });
});
