import { describe, expect, it } from 'vitest';
import { addDaysIso, defaultExtensionPeriod, inclusiveDays } from './rentalPeriod';

describe('rentalPeriod (#2697)', () => {
  it('AC-PTR-015 the next period starts the day after the end and runs one period long', () => {
    expect(defaultExtensionPeriod('2026-01-01', '2026-01-31')).toEqual({ from: '2026-02-01', to: '2026-03-03' });
    expect(defaultExtensionPeriod('2026-03-10', '2026-03-10')).toEqual({ from: '2026-03-11', to: '2026-03-11' });
  });
  it('crosses month and year ends, and a leap day, without drift', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2028-02-28', 1)).toBe('2028-02-29');
    expect(inclusiveDays('2026-01-01', '2026-01-31')).toBe(31);
  });
});
