import { describe, expect, it } from 'vitest';
import { fiscalYearOf } from './fiscalYear.ts';

describe('fiscalYearOf (DD-ODA-5)', () => {
  it('defaults to the calendar year', () => {
    expect(fiscalYearOf('2026-01-01', null)).toBe('2026');
    expect(fiscalYearOf('2026-12-31', null)).toBe('2026');
  });
  it('a year ending 31 March is named by its end year', () => {
    const end = { month: 3, day: 31 };
    expect(fiscalYearOf('2026-03-31', end)).toBe('2026');
    expect(fiscalYearOf('2026-04-01', end)).toBe('2027');
    expect(fiscalYearOf('2026-01-15', end)).toBe('2026');
  });
  it('a year ending 31 December equals the calendar year', () => {
    expect(fiscalYearOf('2026-12-31', { month: 12, day: 31 })).toBe('2026');
  });
  it('a 29 February year end falls on 28 February in a common year', () => {
    const end = { month: 2, day: 29 };
    expect(fiscalYearOf('2024-02-29', end)).toBe('2024');
    expect(fiscalYearOf('2024-03-01', end)).toBe('2025');
    expect(fiscalYearOf('2025-02-28', end)).toBe('2025');
    expect(fiscalYearOf('2025-03-01', end)).toBe('2026');
  });
  it('a malformed date is null, never a guessed year', () => {
    expect(fiscalYearOf('2026-13-01', null)).toBeNull();
    expect(fiscalYearOf('nope', { month: 3, day: 31 })).toBeNull();
  });
});
