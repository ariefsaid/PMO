import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({ id: String(i).padStart(4, '0'), project_id: 'p1' }));
  let failSecond = false;
  const orders: string[] = [];
  const ranges: number[][] = [];
  const from = vi.fn(() => {
    let start = 0, end = 999;
    const q = {
      select: () => q, eq: () => q,
      order: (column: string) => { orders.push(column); return q; },
      range: (a: number, b: number) => { start = a; end = b; ranges.push([a, b]); return q; },
      then: (resolve: (value: unknown) => void) => resolve(failSecond && start > 0
        ? { data: null, error: { message: 'later page failed', code: 'XX001' } }
        : { data: rows.slice(start, Math.min(end + 1, start + 1000)), error: null }),
    };
    return q;
  });
  return { from, orders, ranges, setFail: (v: boolean) => { failSecond = v; } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { listProjectDocuments } from './documents';

describe('complete project document register', () => {
  it('reads beyond the response cap in a stable total order', async () => {
    h.orders.length = 0; h.ranges.length = 0; h.setFail(false);
    const rows = await listProjectDocuments('p1');
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map(row => row.id)).size).toBe(1005);
    expect(rows.at(-1)?.id).toBe('1004');
    expect(h.orders).toContain('id');
    expect(h.ranges).toEqual([[0, 999], [1000, 1999]]);
  });
  it('rejects a later page error instead of returning a partial register', async () => {
    h.setFail(true);
    await expect(listProjectDocuments('p1')).rejects.toMatchObject({ message: 'later page failed', code: 'XX001' });
    h.setFail(false);
  });
});
