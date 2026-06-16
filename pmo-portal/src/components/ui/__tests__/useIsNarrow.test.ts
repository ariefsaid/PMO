import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIsNarrow } from '../useIsNarrow';

/**
 * Builds a controllable matchMedia mock for the `(max-width: 639px)` query.
 * `initialMatches` is the value the hook reads synchronously in its useState
 * initializer; `fire` simulates a viewport change firing the 'change' listener.
 */
function mockMatchMedia(initialMatches: boolean) {
  const listeners: ((e: MediaQueryListEvent) => void)[] = [];
  const mql = {
    matches: initialMatches,
    media: '(max-width: 639px)',
    onchange: null,
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => listeners.push(cb),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    mql,
    fire: (matches: boolean) =>
      listeners.forEach((cb) => cb({ matches } as MediaQueryListEvent)),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('useIsNarrow', () => {
  it('initializes synchronously to true when the viewport is <640px (no flash)', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsNarrow());
    // First value (no effect needed) is already correct — there is no false→true flip.
    expect(result.current).toBe(true);
  });

  it('initializes synchronously to false when the viewport is ≥640px', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
  });

  it('re-renders when the viewport crosses the 640px breakpoint', () => {
    const { fire } = mockMatchMedia(false);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
    act(() => fire(true));
    expect(result.current).toBe(true);
    act(() => fire(false));
    expect(result.current).toBe(false);
  });

  it('removes its change listener on unmount', () => {
    const { mql } = mockMatchMedia(true);
    const { unmount } = renderHook(() => useIsNarrow());
    unmount();
    expect(mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('defaults to NOT narrow (false) when matchMedia is unavailable (SSR/guard)', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useIsNarrow());
    expect(result.current).toBe(false);
  });
});
