// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { shouldReloadForChunkError, installChunkReloadGuard, CHUNK_RELOAD_SESSION_KEY } from './chunkReload';

describe('shouldReloadForChunkError — a one-time guarded reload for a stale lazy-route chunk', () => {
  it('matches a Vite dynamic-import failure message and has not already reloaded', () => {
    expect(
      shouldReloadForChunkError(
        "Failed to fetch dynamically imported module: https://pmo-bfb.pages.dev/assets/SalesPipeline-a1b2c3.js",
        false,
      ),
    ).toBe(true);
  });

  it('matches the Firefox-shaped "Importing a module script failed" message', () => {
    expect(shouldReloadForChunkError('Importing a module script failed', false)).toBe(true);
  });

  it('matches the Safari-shaped "error loading dynamically imported module" message', () => {
    expect(shouldReloadForChunkError('error loading dynamically imported module', false)).toBe(true);
  });

  it('returns false when a reload already happened this session — never loops', () => {
    expect(
      shouldReloadForChunkError('Failed to fetch dynamically imported module: x.js', true),
    ).toBe(false);
  });

  it('returns false for an unrelated error message', () => {
    expect(shouldReloadForChunkError('TypeError: Cannot read properties of undefined', false)).toBe(false);
  });

  it('returns false for an empty/undefined message', () => {
    expect(shouldReloadForChunkError('', false)).toBe(false);
  });

  it('is case-insensitive on the matched phrase', () => {
    expect(shouldReloadForChunkError('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE: x.js', false)).toBe(true);
  });
});

describe('installChunkReloadGuard — the window-level wiring', () => {
  const reloadMock = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reloadMock.mockClear();
    // jsdom's `window.location.reload` is a non-configurable navigation stub —
    // replace the whole `location` object rather than spying on one property.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC: a stale-chunk unhandledrejection sets the session flag and reloads exactly once', () => {
    installChunkReloadGuard();

    const rejection = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(new Error('x')).catch(() => {}),
      reason: new TypeError('Failed to fetch dynamically imported module: /assets/SalesPipeline-abc.js'),
    });
    window.dispatchEvent(rejection);

    expect(sessionStorage.getItem(CHUNK_RELOAD_SESSION_KEY)).toBe('1');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload for an unrelated unhandledrejection', () => {
    installChunkReloadGuard();
    const rejection = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(new Error('unrelated')).catch(() => {}),
      reason: new Error('unrelated network failure'),
    });
    window.dispatchEvent(rejection);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('does NOT reload a second time once the session flag is already set (no loop)', () => {
    sessionStorage.setItem(CHUNK_RELOAD_SESSION_KEY, '1');
    installChunkReloadGuard();
    const rejection = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(new Error('x')).catch(() => {}),
      reason: new TypeError('Failed to fetch dynamically imported module: /assets/x.js'),
    });
    window.dispatchEvent(rejection);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('a guard fault (e.g. sessionStorage throwing) never propagates out of the handler', () => {
    installChunkReloadGuard();
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const rejection = new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(new Error('x')).catch(() => {}),
      reason: new TypeError('Failed to fetch dynamically imported module: /assets/x.js'),
    });
    expect(() => window.dispatchEvent(rejection)).not.toThrow();
    getItemSpy.mockRestore();
  });
});
