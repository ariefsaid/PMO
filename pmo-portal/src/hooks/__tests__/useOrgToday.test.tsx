import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrgToday } from '../useOrgToday';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

describe('useOrgToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetActiveLocale();
  });

  it('THEME-FE-29: resolves business day in active locale timezone', () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    // 2026-06-13 18:00 UTC is 2026-06-14 01:00 in Asia/Jakarta (UTC+7)
    vi.setSystemTime(new Date('2026-06-13T18:00:00.000Z'));

    const { result } = renderHook(() => useOrgToday());
    expect(result.current).toBe('2026-06-14');
  });

  it('THEME-FE-29: resolves business day in explicit organization timezone', () => {
    // 2026-06-13 18:00 UTC is 2026-06-13 in Los Angeles, but 2026-06-14 in Jakarta
    vi.setSystemTime(new Date('2026-06-13T18:00:00.000Z'));

    const { result: jakarta } = renderHook(() => useOrgToday('Asia/Jakarta'));
    expect(jakarta.current).toBe('2026-06-14');

    const { result: la } = renderHook(() => useOrgToday('America/Los_Angeles'));
    expect(la.current).toBe('2026-06-13');
  });

  it('THEME-FE-29: rolls over automatically when midnight arrives', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    // 5 seconds before UTC midnight
    vi.setSystemTime(new Date('2026-06-13T23:59:55.000Z'));

    const { result } = renderHook(() => useOrgToday());
    expect(result.current).toBe('2026-06-13');

    // Advance 10 seconds past midnight
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(result.current).toBe('2026-06-14');
  });
});
