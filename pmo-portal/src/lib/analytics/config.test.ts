// @vitest-environment jsdom
// Uses sessionStorage (DOM global absent in the `node` test project — perf/test-speed split).
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getAnalyticsConfig, parseDemoContext, persistDemoContext } from './config';

// A valid PostHog public key is `phc_` + base62 (≥20). The mode tests use a valid key
// so they exercise the demo/analytics-flag logic, not the key guard (which has its own
// tests below). The old placeholder here was `ph_test` — exactly the invalid shape the
// guard now blocks (real defect: an invalid key spammed 401s on the demo deploy).
const baseEnv = {
  VITE_POSTHOG_KEY: 'phc_testTESTtestTESTtest0123456789',
  VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
  VITE_ANALYTICS_ENABLED: 'false',
  VITE_DEMO_MODE: 'false',
  VITE_APP_ENV: 'test',
  DEV: false,
  PROD: false,
  MODE: 'test',
};

beforeEach(() => {
  sessionStorage.clear();
  vi.unstubAllEnvs();
});

describe('parseDemoContext', () => {
  it('AC-PH-007: ?da=comp1 becomes prospect/comp1', () => {
    const ctx = parseDemoContext({
      search: '?da=comp1',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    });
    expect(ctx).toEqual({ demoAudience: 'prospect', demoAccount: 'comp1' });
  });

  it('AC-PH-006: ?da=internal marks deployed internal testing', () => {
    expect(parseDemoContext({
      search: '?da=internal',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'internal', demoAccount: 'default' });
  });

  it('AC-PH-008: no flag defaults deployed demo to prospect/default', () => {
    expect(parseDemoContext({
      search: '',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'prospect', demoAccount: 'default' });
  });

  it('AC-PH-008: no flag defaults local dev to internal/local', () => {
    expect(parseDemoContext({
      search: '',
      isDev: true,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'internal', demoAccount: 'local' });
  });

  it('ignores unsafe account slugs', () => {
    expect(parseDemoContext({
      search: '?da=../../bad',
      isDev: false,
      demoMode: true,
      storage: sessionStorage,
    })).toEqual({ demoAudience: 'prospect', demoAccount: 'default' });
  });

  it('is pure — does not write to storage', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const storage = { getItem, setItem };

    parseDemoContext({
      search: '?da=comp1',
      isDev: false,
      demoMode: true,
      storage,
    });

    // parseDemoContext may call getItem for reads but must NOT call setItem
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('persistDemoContext', () => {
  it('writes demo audience and account to storage', () => {
    const setItem = vi.fn();
    const storage = { setItem };

    persistDemoContext({ demoAudience: 'prospect', demoAccount: 'comp1' }, storage);

    expect(setItem).toHaveBeenCalledWith('pmo.demoAudience', 'prospect');
    expect(setItem).toHaveBeenCalledWith('pmo.demoAccount', 'comp1');
  });
});

describe('getAnalyticsConfig', () => {
  it('AC-PH-001: disables analytics when both flags are false', () => {
    expect(getAnalyticsConfig(baseEnv, '', sessionStorage).enabled).toBe(false);
  });

  it('AC-PH-002: enables analytics for demo mode', () => {
    const cfg = getAnalyticsConfig({ ...baseEnv, VITE_DEMO_MODE: 'true' }, '', sessionStorage);
    expect(cfg.enabled).toBe(true);
    expect(cfg.replayAndAutocapture).toBe(true);
  });

  it('AC-PH-004: analytics-only mode disables replay/autocapture', () => {
    const cfg = getAnalyticsConfig({ ...baseEnv, VITE_ANALYTICS_ENABLED: 'true' }, '', sessionStorage);
    expect(cfg.enabled).toBe(true);
    expect(cfg.replayAndAutocapture).toBe(false);
  });

  it('AC-PH-010: an invalid/placeholder PostHog key disables analytics even in demo mode (no 401 spam)', () => {
    for (const badKey of ['', undefined, 'ph_test', 'phc_short', 'changeme']) {
      const cfg = getAnalyticsConfig(
        { ...baseEnv, VITE_DEMO_MODE: 'true', VITE_POSTHOG_KEY: badKey },
        '',
        sessionStorage,
      );
      expect(cfg.enabled, `key=${JSON.stringify(badKey)}`).toBe(false);
      expect(cfg.posthogKey).toBe('');
    }
  });

  it('AC-PH-010: a valid phc_ key keeps analytics enabled in demo mode', () => {
    const cfg = getAnalyticsConfig(
      { ...baseEnv, VITE_DEMO_MODE: 'true', VITE_POSTHOG_KEY: 'phc_validKEYvalidKEYvalid123456' },
      '',
      sessionStorage,
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.posthogKey).toBe('phc_validKEYvalidKEYvalid123456');
  });

  it('is pure — does not write to storage', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const storage = { getItem, setItem };

    getAnalyticsConfig({ ...baseEnv, VITE_DEMO_MODE: 'true' }, '?da=comp1', storage);

    expect(setItem).not.toHaveBeenCalled();
  });
});
