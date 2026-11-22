import { describe, expect, it } from 'vitest';
import { doneNotClaimedAge, isOverLimit } from './billingPlan';

describe('done-not-claimed age (#2675)', () => {
  it('AC-DNC-001 is whole days from the acceptance date to the organisation today', () => {
    expect(doneNotClaimedAge('2026-11-11', '2026-11-21')).toBe(10);
    expect(doneNotClaimedAge('2026-10-31', '2026-11-01')).toBe(1);
    expect(doneNotClaimedAge('2025-12-31', '2026-01-01')).toBe(1);
    expect(doneNotClaimedAge('2024-02-28', '2024-03-01')).toBe(2);
  });
  it('AC-DNC-001 is 0 the same day or for a future date, and none without a date', () => {
    expect(doneNotClaimedAge('2026-11-21', '2026-11-21')).toBe(0);
    expect(doneNotClaimedAge('2026-11-25', '2026-11-21')).toBe(0);
    expect(doneNotClaimedAge(null, '2026-11-21')).toBeNull();
  });
  it('AC-DNC-002 only a line older than the limit is over, and only with the reminder on and a limit set', () => {
    expect([9, 10, 11].map((a) => isOverLimit(a, 10, true))).toEqual([false, false, true]);
    expect(isOverLimit(11, 10, false)).toBe(false);
    expect(isOverLimit(400, null, true)).toBe(false);
    expect(isOverLimit(null, 10, true)).toBe(false);
  });
});
