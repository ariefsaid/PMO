import { describe, it, expect } from 'vitest';
import { monthEnd, monthStart, planRefusal, planTotal } from './equipmentPlans';

describe('equipment plan helpers (#2700)', () => {
  it('AC-EQP-005 a month starts on its first day and ends on its last, leap years included', () => {
    expect(monthStart(new Date(2026, 2, 17))).toBe('2026-03-01');
    expect(monthEnd('2026-03-01')).toBe('2026-03-31');
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(monthEnd('2028-02-01')).toBe('2028-02-29');
  });
  it('AC-EQP-016 the month total is exact to the cent', () => {
    expect(planTotal([{ quantity: 2, rate: 1000 }, { quantity: 1.5, rate: 333.33 }])).toBe(2500);
    expect(planTotal([])).toBe(0);
  });
  it('AC-EQP-016 a refusal keeps its key and its words from the database message', () => {
    expect(planRefusal(new Error('EQP_SELF_APPROVAL: you cannot approve your own plan'))).toEqual({ key: 'SELF_APPROVAL', message: 'you cannot approve your own plan' });
    expect(planRefusal(new Error('something else'))).toBeNull();
  });
});
