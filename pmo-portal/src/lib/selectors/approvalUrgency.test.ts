import { describe, expect, it } from 'vitest';
import { ageInDays, groupByUrgency, OVERDUE_AFTER_DAYS, urgencyOf } from './approvalUrgency';

const NOW = new Date('2026-11-09T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('approval urgency', () => {
  it('ages whole days, never negative', () => {
    expect(ageInDays(daysAgo(6), NOW)).toBe(6);
    expect(ageInDays(daysAgo(0.4), NOW)).toBe(0);
    expect(ageInDays('2026-11-20T00:00:00Z', NOW)).toBe(0);
  });

  it(`is overdue from ${OVERDUE_AFTER_DAYS} days, today from 1, later below that`, () => {
    expect(urgencyOf(daysAgo(OVERDUE_AFTER_DAYS), NOW)).toBe('overdue');
    expect(urgencyOf(daysAgo(OVERDUE_AFTER_DAYS - 1), NOW)).toBe('today');
    expect(urgencyOf(daysAgo(1), NOW)).toBe('today');
    expect(urgencyOf(daysAgo(0.2), NOW)).toBe('later');
  });

  it('treats a missing or unparsable date as later (never hides the item)', () => {
    expect(urgencyOf(null, NOW)).toBe('later');
    expect(urgencyOf('nope', NOW)).toBe('later');
  });

  it('groups in Overdue, Today, Later order, oldest first, dropping empty groups', () => {
    const items = [
      { id: 'a', at: daysAgo(0.1) },
      { id: 'b', at: daysAgo(5) },
      { id: 'c', at: daysAgo(9) },
    ];
    const groups = groupByUrgency(items, (i) => i.at, NOW);
    expect(groups.map((g) => g.group)).toEqual(['overdue', 'later']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'b']);
  });
});
