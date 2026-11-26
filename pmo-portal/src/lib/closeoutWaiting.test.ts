import { describe, expect, it } from 'vitest';
import { summariseWaitingCloseoutItems } from './closeoutWaiting';

const row = (itemId: string, workOrderId: string, dueOn: string | null) => ({
  itemId, workOrderId, projectId: 'p1', projectName: 'P', workOrderLabel: 'WO-1', itemName: `Item ${itemId}`, dueOn,
});

describe('waiting close-out items pointer (#2907)', () => {
  it('counts the items and the past-target ones, and links to the one work order they share', () => {
    expect(summariseWaitingCloseoutItems([row('i1', 'w1', '2026-03-01'), row('i2', 'w1', null)], '2026-03-04'))
      .toEqual({ count: 2, overdue: 1, href: '/work-orders/w1' });
  });

  it('links to the work-order list when the items span work orders', () => {
    expect(summariseWaitingCloseoutItems([row('i1', 'w1', null), row('i2', 'w2', null)], '2026-03-04'))
      .toEqual({ count: 2, overdue: 0, href: '/work-orders' });
  });

  it('never counts a due day still ahead as overdue, and is null when nothing waits', () => {
    expect(summariseWaitingCloseoutItems([row('i1', 'w1', '2026-03-05')], '2026-03-04'))
      .toEqual({ count: 1, overdue: 0, href: '/work-orders/w1' });
    expect(summariseWaitingCloseoutItems([], '2026-03-04')).toBeNull();
  });
});
