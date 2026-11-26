import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLocale } from '@/src/lib/locale/resolveLocale';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { useOrgToday } from './useOrgToday';

describe('useOrgToday() with no argument (#2914)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T18:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); resetActiveLocale(); });

  it("is the organisation's day, not the person's own timezone's day", () => {
    // Organisation Jakarta (26 Nov, 01:00); the person set New York (25 Nov, 13:00).
    setActiveLocale(resolveLocale({ locale: null, numberLocale: null, timezone: 'America/New_York' },
      { defaultLocale: null, defaultNumberLocale: null, defaultTimezone: 'Asia/Jakarta' }));
    setActiveOrgTimezone('Asia/Jakarta');
    const { result } = renderHook(() => useOrgToday());
    expect(result.current).toBe('2026-11-26');
  });
});

describe('fallback', () => {
  it('is UTC when the organisation has no timezone, as the server', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    resetActiveLocale();
    expect(renderHook(() => useOrgToday()).result.current).toBe('2026-11-25');
    vi.useRealTimers();
  });
});
