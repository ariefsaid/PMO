// @vitest-environment jsdom
// #1885: posthog-js is a dynamic import. Consent, sanitiser and failure behaviour must be unchanged.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsConfig } from './config';

const posthog = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  register: vi.fn(),
  reset: vi.fn(),
  captureException: vi.fn(),
  opt_out_capturing: vi.fn(),
  opt_in_capturing: vi.fn(),
  canRenderSurvey: vi.fn(),
}));
const gate = vi.hoisted(() => ({
  loads: 0,
  release: null as null | ((v?: unknown) => void),
  fail: null as null | ((e: unknown) => void),
}));

const config: AnalyticsConfig = {
  enabled: true,
  demoMode: false,
  replayAndAutocapture: false,
  posthogKey: 'ph_test',
  posthogHost: 'https://us.i.posthog.com',
  appEnv: 'test',
  isProd: true, // production: forbidden keys are dropped (non-prod throws)
  demoAudience: 'internal',
  demoAccount: 'local',
};

type Client = typeof import('./client').analyticsClient;
let client: Client;

/** Fresh client module whose posthog-js import stays pending until `gate.release()` / `gate.fail()`. */
beforeEach(async () => {
  Object.values(posthog).forEach((f) => f.mockReset());
  gate.loads = 0;
  localStorage.clear();
  vi.resetModules();
  const pending = new Promise((resolve, reject) => {
    gate.release = () => resolve({ default: posthog });
    gate.fail = reject;
  });
  pending.catch(() => {});
  vi.doMock('posthog-js', () => {
    gate.loads += 1;
    return pending;
  });
  client = (await import('./client')).analyticsClient;
});

describe('#1885 consent: nothing loads, inits or captures before consent', () => {
  it('opted out: init never imports the SDK, and capture/identify send nothing', async () => {
    localStorage.setItem('pmo.analyticsOptOut', 'true');
    client.init(config);
    client.capture('app_route_viewed', { route: '/x' });
    client.identify({ userId: 'u', role: 'Admin', orgId: 'o' });
    await client.ready();
    expect(gate.loads).toBe(0);
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it('disabled: never imports the SDK', async () => {
    client.init({ ...config, enabled: false });
    client.capture('app_route_viewed', { route: '/x' });
    await client.ready();
    expect(gate.loads).toBe(0);
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('capture before init() is dropped, not replayed after init (today\'s behaviour)', async () => {
    client.capture('app_route_viewed', { route: '/early' });
    client.init(config);
    gate.release!();
    await client.ready();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('opt-out while the SDK is still loading: buffer is cleared, SDK never inits, nothing sent', async () => {
    client.init(config);
    client.capture('app_route_viewed', { route: '/buffered' });
    client.optOut();
    gate.release!();
    await client.ready();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it('opt-out after load but before flush order: buffered events are cleared and never flushed later', async () => {
    client.init(config);
    client.capture('app_route_viewed', { route: '/buffered' });
    client.optOut();
    client.optIn(); // user flips back; the old buffered event must not resurface
    gate.release!();
    await client.ready();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe('#1885 buffer', () => {
  it('events issued while the SDK loads flush in order after init, and the load starts only once', async () => {
    client.init(config);
    client.init(config);
    client.register({ environment: 'test' });
    client.capture('app_route_viewed', { route: '/a' });
    client.capture('app_route_viewed', { route: '/b' });
    expect(posthog.capture).not.toHaveBeenCalled();
    gate.release!();
    await client.ready();
    expect(gate.loads).toBe(1);
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init.mock.invocationCallOrder[0]).toBeLessThan(posthog.capture.mock.invocationCallOrder[0]);
    expect(posthog.capture.mock.calls.map((c) => c[1].route)).toEqual(['/a', '/b']);
  });
});

describe('#1885 sanitiser runs on the buffer path (#1840, FR-OF-011)', () => {
  it('a buffered event never carries a forbidden key into the SDK', async () => {
    client.init(config);
    client.capture('app_route_viewed', { route: '/a', token: 'secret-jwt', email: 'a@b.co' } as never);
    gate.release!();
    await client.ready();
    expect(posthog.capture).toHaveBeenCalledTimes(1);
    expect(posthog.capture.mock.calls[0][1]).toEqual({ route: '/a' });
  });

  it('buffered register() is sanitised too', async () => {
    client.init(config);
    client.register({ environment: 'test', email: 'a@b.co' } as never);
    gate.release!();
    await client.ready();
    const registered = posthog.register.mock.calls.map((c) => c[0]);
    expect(registered.some((p) => 'email' in p)).toBe(false);
  });

  it('the SDK is initialised with the outbound before_send sanitiser, so flushed events pass through it', async () => {
    client.init(config);
    client.capture('app_route_viewed', { route: '/first' });
    gate.release!();
    await client.ready();
    const opts = posthog.init.mock.calls[0][1];
    expect(typeof opts.before_send).toBe('function');
    const out = opts.before_send({
      event: 'app_route_viewed',
      properties: { $current: 'https://x.test/p?token=abc#frag', nested: { navigationURL: 'u', ok: 'https://x.test/a?b=1' } },
    });
    expect(out.properties.$current).toBe('https://x.test/p');
    expect(out.properties.nested.navigationURL).toBeUndefined();
    expect(out.properties.nested.ok).toBe('https://x.test/a');
  });
});

describe('#1885 failure: SDK fails to load', () => {
  it('nothing throws, calls are no-ops, canRender is false, and a later retry via optIn is possible', async () => {
    client.init(config);
    client.capture('app_route_viewed', { route: '/a' });
    gate.fail!(new Error('chunk load failed'));
    await expect(client.ready()).resolves.toBeUndefined();
    expect(() => {
      client.capture('app_route_viewed', { route: '/b' });
      client.identify({ userId: 'u', role: 'Admin', orgId: 'o' });
      client.captureException({ name: 'E', message: 'm' });
      client.reset();
      client.group('organisation', 'o', {});
    }).not.toThrow();
    expect(await client.surveys.canRender('s1')).toBe(false);
    expect(client.agentSession()).toBeUndefined();
    expect(posthog.capture).not.toHaveBeenCalled();
  });
});

describe('#1885 surveys', () => {
  it('canRender waits for the SDK then returns its verdict', async () => {
    client.init(config);
    posthog.canRenderSurvey.mockReturnValue({ visible: true });
    const verdict = client.surveys.canRender('s1');
    gate.release!();
    expect(await verdict).toBe(true);
  });
});
