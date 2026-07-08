import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * ADR-0042 §4: the version identity is build-time-inlined via Vite `define`.
 * Vitest does NOT run that replacement, so the `__*__` tokens are bare globals
 * here — stub them, then load the module FRESH (it reads them at module-eval).
 */
describe('lib/version', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('__APP_VERSION__', '9.9.9');
    vi.stubGlobal('__GIT_SHA__', 'abc1234');
    vi.stubGlobal('__BUILD_TIME__', '2026-07-08T12:00:00.000Z');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the build-time version / sha / build-time globals', async () => {
    const mod = await import('./version');
    expect(mod.APP_VERSION).toBe('9.9.9');
    expect(mod.GIT_SHA).toBe('abc1234');
    expect(mod.BUILD_TIME).toBe('2026-07-08T12:00:00.000Z');
  });

  it('VERSION_LABEL formats as v<version> · <sha>', async () => {
    const mod = await import('./version');
    expect(mod.VERSION_LABEL).toBe('v9.9.9 · abc1234');
  });

  it('reflects a different build without cross-test bleed (re-evaluates globals)', async () => {
    vi.stubGlobal('__APP_VERSION__', '0.4.2');
    vi.stubGlobal('__GIT_SHA__', 'deadbee');
    const mod = await import('./version');
    expect(mod.VERSION_LABEL).toBe('v0.4.2 · deadbee');
  });
});
