import { describe, it, expect } from 'vitest';
import { addDays, addMonths, daysInclusive, monthEnd, monthInputToIso, monthsBetween } from './months';

describe('reports/months (UTC calendar arithmetic, no host-timezone drift)', () => {
  it('AC-MMP-006 support: steps months across a year end', () => {
    expect(addMonths('2025-12-01', 1)).toBe('2026-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
  });
  it('AC-MMP-006 support: lists an inclusive window and an empty one when reversed', () => {
    expect(monthsBetween('2026-01-01', '2026-04-01')).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']);
    expect(monthsBetween('2026-05-01', '2026-04-01')).toEqual([]);
  });
  it('AC-MMP-006 support: month ends and inclusive day counts respect leap years', () => {
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysInclusive('2026-01-01', '2026-04-30')).toBe(120);
  });
  it('AC-MMP-014 support: reads an <input type="month"> value', () => {
    expect(monthInputToIso('2026-09')).toBe('2026-09-01');
    expect(monthInputToIso('2026-13')).toBeNull();
    expect(monthInputToIso('')).toBeNull();
  });
});
