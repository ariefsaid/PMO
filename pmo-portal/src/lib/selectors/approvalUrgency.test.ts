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

  it(`is overdue from ${OVERDUE_AFTER_DAYS} days, today while under a day old, later in between (boundaries)`, () => {
    expect(urgencyOf(daysAgo(OVERDUE_AFTER_DAYS), NOW)).toBe('overdue');
    expect(urgencyOf(daysAgo(OVERDUE_AFTER_DAYS - 0.01), NOW)).toBe('later');
    expect(urgencyOf(daysAgo(1), NOW)).toBe('later');
    expect(urgencyOf(daysAgo(0.99), NOW)).toBe('today');
    expect(urgencyOf(daysAgo(0), NOW)).toBe('today');
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
    expect(groups.map((g) => g.group)).toEqual(['overdue', 'today']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'b']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['a']);
  });

  it('puts each group oldest first, Later holding what waited one to two days', () => {
    const items = [
      { id: 'later-new', at: daysAgo(1) },
      { id: 'today', at: daysAgo(0.5) },
      { id: 'later-old', at: daysAgo(2.5) },
      { id: 'overdue', at: daysAgo(OVERDUE_AFTER_DAYS + 1) },
    ];
    const groups = groupByUrgency(items, (i) => i.at, NOW);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['overdue', ['overdue']],
      ['today', ['today']],
      ['later', ['later-old', 'later-new']],
    ]);
  });
});
