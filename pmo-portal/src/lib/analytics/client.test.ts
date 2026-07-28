// @vitest-environment jsdom
// The opt-out tests below use `window.localStorage` (DOM global absent in the `node` test
// project — perf/test-speed split); see src/lib/analytics/config.test.ts for the same pattern.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthog }));

import { analyticsClient, POSTHOG_PROPERTY_DENYLIST, getConsentState } from './client';

/** Aliases used by the E1/E3 signal-config and opt-out tests below. */
const initSpy = posthog.init;
const captureSpy = posthog.capture;
const optOutSpy = posthog.opt_out_capturing;
const optInSpy = posthog.opt_in_capturing;

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
      // FR-PHG-001/002 (Task E2): capture_heatmaps replaces the deprecated (and previously
      // wrong-valued) enable_heatmaps — heatmaps ARE captured even outside the demo/replay path.
      capture_heatmaps: true,
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

const enabledConfig = (): AnalyticsConfig => ({ ...base });

describe('analyticsClient.init — signal config (FR-PHG-001..004, FR-CON-001)', () => {
  it('AC-PHG-001: enables heatmaps via capture_heatmaps (NOT the deprecated enable_heatmaps)', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    const opts = initSpy.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.capture_heatmaps).toBe(true);
    expect(opts).not.toHaveProperty('enable_heatmaps');
  });

  it('AC-CON-005 (SECURITY): capture_dead_clicks is EXPLICITLY false — the autocapture-gated ' +
    '$dead_click event carries raw $el_text/$elements_chain/attr__title (real capture confirmed ' +
    '"MYR 4,250,000.00" and a contract counterparty name); none of our redaction controls apply to ' +
    'it, since the SDK emits it directly (see client.deadClickGate.test.ts for the real-SDK gate check)',
  () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_dead_clicks).toBe(false);
  });

  it('AC-PHG-001: web vitals on, network timing off', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_performance)
      .toEqual({ web_vitals: true, network_timing: false });
  });

  it('AC-PHG-004: sets capture_pageleave EXPLICITLY (its default defers to capture_pageview)', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).capture_pageleave).toBe(false);
  });

  it('AC-CON-001: sets respect_dnt', () => {
    analyticsClient.__resetForTests();
    analyticsClient.init(enabledConfig());
    expect((initSpy.mock.calls[0][1] as Record<string, unknown>).respect_dnt).toBe(true);
  });
});

describe('analytics opt-out (FR-CON-002/003)', () => {
  beforeEach(() => { window.localStorage.clear(); analyticsClient.__resetForTests(); initSpy.mockClear(); });

  it('AC-CON-002: opting out persists the preference', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    expect(analyticsClient.hasOptedOut()).toBe(true);
    expect(window.localStorage.getItem('pmo.analyticsOptOut')).toBe('true');
  });

  it('AC-CON-003: opting out calls posthog.opt_out_capturing (stops the CURRENT session)', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    expect(optOutSpy).toHaveBeenCalled();
  });

  it('AC-CON-003: a persisted opt-out means init NEVER calls posthog.init on the next session', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    analyticsClient.init(enabledConfig());
    expect(initSpy).not.toHaveBeenCalled();
    analyticsClient.capture('app_route_viewed', {});
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('AC-CON-002: opting back in clears the preference and initialises', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    analyticsClient.init(enabledConfig());
    analyticsClient.optIn();
    expect(analyticsClient.hasOptedOut()).toBe(false);
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});

describe('analytics opt-out survives logout (CRITICAL fix — reset() used to silently re-enable capture)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    analyticsClient.__resetForTests();
    initSpy.mockClear();
    optOutSpy.mockClear();
    posthog.reset.mockClear();
    posthog.capture.mockClear();
    posthog.captureException.mockClear();
    posthog.identify.mockClear();
    posthog.register.mockClear();
  });

  it('AC-CON-003: reset() (logout) re-asserts opt_out_capturing for an opted-out user — posthog.reset() deletes the SDK\'s own consent key, which would otherwise silently read PENDING/allowed again', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    optOutSpy.mockClear(); // the call from optOut() itself — we want to see reset() call it AGAIN
    analyticsClient.reset();
    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(optOutSpy).toHaveBeenCalledTimes(1);
  });

  it('reset() does not spuriously call opt_out_capturing for a user who never opted out', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.reset();
    expect(optOutSpy).not.toHaveBeenCalled();
  });

  it('AC-CON-003: capture/captureException/identify/register are all no-ops for an opted-out browser even while `initialized` is still true — belt-and-braces: a privacy promise must not depend on SDK-internal consent state surviving reset()', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut(); // sets OUR flag; does not by itself flip the module-level `initialized` bit
    analyticsClient.capture('app_route_viewed', {});
    analyticsClient.captureException({ name: 'TypeError', message: 'boom' });
    analyticsClient.identify({ userId: 'u1', role: 'Project Manager', orgId: 'o1' });
    analyticsClient.register({ environment: 'test' });
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.captureException).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.register).not.toHaveBeenCalled();
  });
});

describe('opting back in across a reload (MEDIUM fix — the SDK\'s own opt-out survives a fresh init())', () => {
  beforeEach(() => {
    window.localStorage.clear();
    analyticsClient.__resetForTests();
    initSpy.mockClear();
    optInSpy.mockClear();
  });

  it('AC-CON-002: opting in after a reload (init already ran and skipped this session) re-asserts posthog.opt_in_capturing without a billed event', () => {
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    analyticsClient.init(enabledConfig()); // skipped — our flag is set
    analyticsClient.optIn();
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(optInSpy).toHaveBeenCalledWith({ captureEventName: false });
  });

  it('AC-CON-002: opting in while already initialized also skips the billed $opt_in event', () => {
    analyticsClient.init(enabledConfig());
    analyticsClient.optOut();
    analyticsClient.optIn();
    expect(optInSpy).toHaveBeenCalledWith({ captureEventName: false });
  });
});

describe('Do Not Track (MEDIUM fix, FR-CON-001) — init() must not fire at all, not just suppress capture after', () => {
  const originalDNT = Object.getOwnPropertyDescriptor(navigator, 'doNotTrack');

  afterEach(() => {
    if (originalDNT) Object.defineProperty(navigator, 'doNotTrack', originalDNT);
  });

  it('AC-CON-001: init() never calls posthog.init when navigator.doNotTrack is "1"', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    analyticsClient.__resetForTests();
    initSpy.mockClear();
    analyticsClient.init(enabledConfig());
    expect(initSpy).not.toHaveBeenCalled();
  });

  it('a browser reporting no DNT preference still initialises normally', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: undefined, configurable: true });
    analyticsClient.__resetForTests();
    initSpy.mockClear();
    analyticsClient.init(enabledConfig());
    expect(initSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AC-CON-011: getConsentState — the three-state (+active) consent surface reflects the ACTUAL reason analytics is or is not running, mirroring doInit\'s own guard order exactly', () => {
  const originalDNT = Object.getOwnPropertyDescriptor(navigator, 'doNotTrack');

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    if (originalDNT) Object.defineProperty(navigator, 'doNotTrack', originalDNT);
    else delete (navigator as { doNotTrack?: string }).doNotTrack;
  });

  it('"disabled": the deployment has no valid PostHog key / analytics off — wins over everything else', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    expect(getConsentState({ ...base, enabled: false })).toBe('disabled');
  });

  it('"dnt": deployment enabled, browser DNT is set, user has NOT explicitly opted out', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    expect(getConsentState({ ...base, enabled: true })).toBe('dnt');
  });

  it('"opted-out": deployment enabled, no DNT, user explicitly opted out', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: undefined, configurable: true });
    window.localStorage.setItem('pmo.analyticsOptOut', 'true');
    expect(getConsentState({ ...base, enabled: true })).toBe('opted-out');
  });

  it('"active": deployment enabled, no DNT, not opted out — analytics is genuinely running', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: undefined, configurable: true });
    expect(getConsentState({ ...base, enabled: true })).toBe('active');
  });
});
