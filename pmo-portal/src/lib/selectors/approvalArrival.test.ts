import { describe, expect, it } from 'vitest';
import { OVERDUE_AFTER_DAYS, arrivalGroupOf, groupByArrival } from './approvalUrgency';

const NOW = new Date('2026-11-20T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('approval arrival groups (built on the unchanged age rule)', () => {
  it('Overdue from the existing threshold, Today when it arrived today, Earlier between', () => {
    expect(arrivalGroupOf(daysAgo(OVERDUE_AFTER_DAYS), NOW)).toBe('overdue');
    expect(arrivalGroupOf(daysAgo(OVERDUE_AFTER_DAYS - 0.5), NOW)).toBe('earlier');
    expect(arrivalGroupOf(daysAgo(1), NOW)).toBe('earlier');
    expect(arrivalGroupOf(daysAgo(0.2), NOW)).toBe('today');
  });
  it('never hides an item with no usable date', () => {
    expect(arrivalGroupOf(null, NOW)).toBe('earlier');
    expect(arrivalGroupOf('nope', NOW)).toBe('earlier');
  });
  it('groups oldest first and drops empty groups', () => {
    const items = [{ id: 'a', at: daysAgo(0.1) }, { id: 'b', at: daysAgo(9) }, { id: 'c', at: daysAgo(20) }, { id: 'd', at: daysAgo(2) }];
    const g = groupByArrival(items, (i) => i.at, NOW);
    expect(g.map((x) => [x.group, x.items.map((i) => i.id)])).toEqual([['overdue', ['c', 'b']], ['today', ['a']], ['earlier', ['d']]]);
  });
});
