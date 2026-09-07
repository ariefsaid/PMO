import { describe, it, expect } from 'vitest';
import { toDatetimeLocalValue } from './datetimeLocal';

describe('toDatetimeLocalValue', () => {
  it('formats a Date as YYYY-MM-DDTHH:mm in LOCAL time (the datetime-local shape)', () => {
    // Constructed from local components, so the output is timezone-independent for this assert.
    const d = new Date(2026, 7, 25, 9, 5); // 2026-08-25 09:05 local
    expect(toDatetimeLocalValue(d)).toBe('2026-08-25T09:05');
  });

  it('zero-pads month, day, hour and minute', () => {
    const d = new Date(2026, 0, 3, 4, 7); // 2026-01-03 04:07 local
    expect(toDatetimeLocalValue(d)).toBe('2026-01-03T04:07');
  });

  it('round-trips: new Date(value) landing back on the same wall-clock components', () => {
    const d = new Date(2026, 10, 30, 23, 59);
    const back = new Date(toDatetimeLocalValue(d));
    expect([back.getFullYear(), back.getMonth(), back.getDate(), back.getHours(), back.getMinutes()]).toEqual([
      2026, 10, 30, 23, 59,
    ]);
  });
});
