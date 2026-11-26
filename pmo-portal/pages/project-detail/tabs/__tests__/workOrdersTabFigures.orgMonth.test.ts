import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { thisMonth } from '../workOrdersTabFigures';

describe('thisMonth (#2914)', () => {
  afterEach(() => { vi.useRealTimers(); resetActiveLocale(); });
  it("is the organisation's month at a month boundary, not the device's", () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-30T18:00:00Z') }); // 1 Dec 01:00 in Jakarta
    setActiveOrgTimezone('Asia/Jakarta');
    expect(thisMonth()).toBe('2026-12-01');
  });
});
