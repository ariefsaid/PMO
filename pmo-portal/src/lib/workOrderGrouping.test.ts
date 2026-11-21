import { describe, it, expect } from 'vitest';
import { bucketWorkOrders } from './workOrderGrouping';

const entries = [
  { id: 'a', code: 'A', name: 'Alpha', archived_at: null },
  { id: 'b', code: 'B', name: 'Beta', archived_at: null },
];
const rows = [{ n: 1, area: 'b' }, { n: 2, area: null }, { n: 3, area: 'a' }, { n: 4, area: 'b' }, { n: 5, area: 'gone' }];

describe('bucketWorkOrders (AC-WAG-006)', () => {
  it('orders buckets by entry order, keeps row order inside, puts the unassigned (and unknown) rows last', () => {
    const out = bucketWorkOrders(rows, entries, (r) => r.area);
    expect(out.map((b) => [b.key, b.rows.map((r) => r.n)])).toEqual([['a', [3]], ['b', [1, 4]], [null, [2, 5]]]);
  });
  it('omits empty buckets, and the unassigned one when nothing is unassigned', () => {
    expect(bucketWorkOrders([rows[0]], entries, (r) => r.area).map((b) => b.key)).toEqual(['b']);
  });
});
