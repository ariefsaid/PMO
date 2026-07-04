/**
 * useTheme — F2 dark-mode toggle behavior.
 *
 * Asserts BEHAVIOR (the `dark` class on documentElement + localStorage 'theme'
 * key), not implementation details. The DOM class is the single source of truth
 * the no-flash script seeds and CSS reads; localStorage is the persistence layer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTheme } from './useTheme';

describe('useTheme (F2 dark-mode toggle)', () => {
  beforeEach(() => {
    // Reset DOM truth + persistence between tests — the class/storage IS the
    // behavior under test, so they must start clean each run.
    document.documentElement.classList.remove('dark');
    localStorage.removeItem('theme');
  });

  it('(d) initial state reads an already-present `dark` class on <html>', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('initial state reads `light` when the `dark` class is absent', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('(a) toggle ADDS the `dark` class on documentElement (light → dark)', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('(a) toggle then REMOVES the `dark` class (dark → light)', () => {
    document.documentElement.classList.add('dark');
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('(b) the choice PERSISTS to localStorage "theme" on toggle', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle()); // → dark
    expect(localStorage.getItem('theme')).toBe('dark');
    act(() => result.current.toggle()); // → light
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('setTheme("dark") / setTheme("light") flip the class and persist explicitly', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');
    act(() => result.current.setTheme('light'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('syncs same-tab hook instances when one instance sets the theme', async () => {
    const first = renderHook(() => useTheme());
    const second = renderHook(() => useTheme());

    expect(first.result.current.theme).toBe('light');
    expect(second.result.current.theme).toBe('light');

    act(() => first.result.current.setTheme('dark'));

    await waitFor(() => expect(second.result.current.theme).toBe('dark'));
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('syncs from DOM truth when a same-tab themechange event is dispatched', async () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      document.documentElement.classList.add('dark');
      window.dispatchEvent(new Event('themechange'));
    });

    await waitFor(() => expect(result.current.theme).toBe('dark'));
  });

  it('syncs from DOM truth when a storage event is dispatched', async () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      document.documentElement.classList.add('dark');
      window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }));
    });

    await waitFor(() => expect(result.current.theme).toBe('dark'));
  });

  it('persists even though it must not throw when localStorage is unavailable (private mode)', () => {
    // Simulate Safari private-mode where localStorage.setItem throws.
    const original = localStorage.setItem;
    Object.defineProperty(localStorage, 'setItem', {
      configurable: true,
      value: () => {
        throw new Error('localStorage unavailable');
      },
    });
    const { result } = renderHook(() => useTheme());
    expect(() => act(() => result.current.toggle())).not.toThrow();
    // The class flip is the source of truth; it still applies even if storage fails.
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    localStorage.setItem = original;
  });
});
