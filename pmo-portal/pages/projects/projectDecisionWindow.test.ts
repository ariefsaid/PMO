// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { projectDecidedWithinMonthWindow } from './useProjectListModel';

/**
 * #1461: the `won` and `decided` list drills must hold exactly the projects get_win_rate
 * counts — decided_at within the inclusive month window (`>= p_from`, `< p_to + 1`).
 */
describe('projectDecidedWithinMonthWindow — get_win_rate decided_at parity', () => {
  it('includes the window bounds and excludes anything outside them', () => {
    const from = '2026-01';
    const to = '2026-06';
    expect(projectDecidedWithinMonthWindow('2026-01-01T00:00:00+00:00', from, to)).toBe(true);
    expect(projectDecidedWithinMonthWindow('2026-06-30T23:59:59+00:00', from, to)).toBe(true);
    expect(projectDecidedWithinMonthWindow('2025-12-31T23:59:59+00:00', from, to)).toBe(false);
    expect(projectDecidedWithinMonthWindow('2026-07-01T00:00:00+00:00', from, to)).toBe(false);
  });

  it('handles a December window across the year boundary', () => {
    expect(projectDecidedWithinMonthWindow('2026-12-15T00:00:00+00:00', '2026-12', '2026-12')).toBe(true);
    expect(projectDecidedWithinMonthWindow('2027-01-01T00:00:00+00:00', '2026-12', '2026-12')).toBe(false);
  });

  it('never matches an undecided project', () => {
    expect(projectDecidedWithinMonthWindow(null, '2026-01', '2026-06')).toBe(false);
    expect(projectDecidedWithinMonthWindow(undefined, '2026-01', '2026-06')).toBe(false);
    expect(projectDecidedWithinMonthWindow('', '2026-01', '2026-06')).toBe(false);
  });

  it('treats an absent or malformed window as no bound (match any decided project)', () => {
    expect(projectDecidedWithinMonthWindow('2024-05-05T00:00:00+00:00', undefined, undefined)).toBe(true);
    expect(projectDecidedWithinMonthWindow('2024-05-05T00:00:00+00:00', 'bogus', '2026-06')).toBe(true);
  });
});
