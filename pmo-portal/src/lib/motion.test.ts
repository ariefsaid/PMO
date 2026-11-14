// @vitest-environment jsdom
/**
 * #2126 (motion slice M5) — JS-started motion must honour prefers-reduced-motion.
 * The CSS reduced-motion rule cannot reach motion started from JS (scrollTo/scrollIntoView
 * behaviour strings, WAAPI drop animations), so those call sites ask this helper.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefersReducedMotion, scrollBehavior } from './motion';

function stubMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prefersReducedMotion / scrollBehavior (#2126)', () => {
  it('scrollBehavior() is instant when prefers-reduced-motion matches', () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(scrollBehavior()).toBe('instant');
  });

  it('scrollBehavior() is smooth when the user has no reduced-motion preference', () => {
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('falls back to smooth/no-preference where matchMedia is missing (SSR, old webviews)', () => {
    const original = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    try {
      expect(prefersReducedMotion()).toBe(false);
      expect(scrollBehavior()).toBe('smooth');
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: original });
    }
  });
});
