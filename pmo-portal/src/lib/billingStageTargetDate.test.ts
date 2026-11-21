import { describe, expect, it } from 'vitest';
import { stageDaysPastTargetDate } from './billingStages';

describe('stageDaysPastTargetDate (#2680)', () => {
  const open = { completedOn: null, skippedOn: null };
  it('is null without a target date', () => {
    expect(stageDaysPastTargetDate({ ...open }, '2026-03-12')).toBeNull();
  });
  it('is null on the target date and before it', () => {
    expect(stageDaysPastTargetDate({ ...open, targetOn: '2026-03-12' }, '2026-03-12')).toBeNull();
    expect(stageDaysPastTargetDate({ ...open, targetOn: '2026-03-12' }, '2026-03-01')).toBeNull();
  });
  it('counts the days after the target date', () => {
    expect(stageDaysPastTargetDate({ ...open, targetOn: '2026-03-12' }, '2026-03-15')).toBe(3);
  });
  it('is null for a completed or skipped step', () => {
    expect(stageDaysPastTargetDate({ completedOn: '2026-03-10', targetOn: '2026-03-01' }, '2026-03-15')).toBeNull();
    expect(stageDaysPastTargetDate({ completedOn: null, skippedOn: '2026-03-10', targetOn: '2026-03-01' }, '2026-03-15')).toBeNull();
  });
  it('crosses month ends', () => {
    expect(stageDaysPastTargetDate({ ...open, targetOn: '2026-02-27' }, '2026-03-02')).toBe(3);
  });
});
