import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from '@/src/lib/repositories/recordHistory';
import { groupHistoryEvents } from '../historyPresentation';

const instant = '2026-10-18T10:00:00.000Z';

const event = (id: string, overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id,
  source: 'change',
  seq: Number(id.replace(/\D/g, '')) || null,
  entityType: 'project',
  entityId: 'synthetic-project',
  op: 'insert',
  action: null,
  actorId: null,
  changes: {},
  detail: null,
  currency: null,
  createdAt: instant,
  ...overrides,
});

describe('historyPresentation', () => {
  it('AC-S23-003 groups only consecutive same-kind, same-time system inserts and preserves every event', () => {
    const primary = [
      event('system-1'),
      event('system-2'),
      event('system-3'),
      event('user-update', { actorId: 'synthetic-user', op: 'update' }),
      event('different-time', { createdAt: '2026-10-18T10:01:00.000Z' }),
    ];
    const groups = groupHistoryEvents(primary);

    expect(groups.map((group) => group.events.length)).toEqual([3, 1, 1]);
    expect(groups[0].key).toBe('change-system-1');
    const flattened = groups.flatMap((group) => group.events);
    expect(flattened).toHaveLength(primary.length);
    flattened.forEach((original, index) => expect(original).toBe(primary[index]));

    const exceptions = [
      event('user-insert', { actorId: 'synthetic-user' }),
      event('different-kind', { entityType: 'task' }),
    ];
    expect(groupHistoryEvents(exceptions).map((group) => group.events.length)).toEqual([1, 1]);

    const interleaved = [
      event('first-1'),
      event('first-2'),
      event('interleaving-user', { actorId: 'synthetic-user', op: 'update' }),
      event('second-1'),
      event('second-2'),
    ];
    expect(groupHistoryEvents(interleaved).map((group) => group.events.length)).toEqual([2, 1, 2]);

    const pageOne = groupHistoryEvents([event('page-one-1'), event('page-one-2')]);
    const pageTwo = groupHistoryEvents([event('page-two-1'), event('page-two-2')]);
    expect(pageOne.map((group) => group.events.length)).toEqual([2]);
    expect(pageTwo.map((group) => group.events.length)).toEqual([2]);
    expect([...pageOne, ...pageTwo].map((group) => group.events[0].id)).toEqual([
      'page-one-1', 'page-two-1',
    ]);
  });
});
