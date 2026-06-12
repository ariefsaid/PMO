import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getAnalyticsConfig, parseDemoContext, persistDemoContext } from './config';

const baseEnv = {
  VITE_POSTHOG_KEY: 'ph_test',
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

  it('is pure — does not write to storage', () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const storage = { getItem, setItem };

    getAnalyticsConfig({ ...baseEnv, VITE_DEMO_MODE: 'true' }, '?da=comp1', storage);

    expect(setItem).not.toHaveBeenCalled();
  });
});
