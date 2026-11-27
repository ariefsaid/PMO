import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  const from = vi.fn(() => {
    const q: Record<string, unknown> = {};
    for (const name of ['select', 'eq', 'or', 'order', 'range']) q[name] = (...args: unknown[]) => { calls.push([name, args]); return q; };
    q.then = (resolve: (value: unknown) => void) => resolve({ data: [{ id: 'd1' }], error: null });
    return q;
  });
  return { from, calls };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { listWorkOrderDocuments } from './documents';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('one work order\'s document slice', () => {
  it('reads the order\'s own documents plus the named linked ones in one project-scoped, same-order query', async () => {
    h.calls.length = 0;
    expect(await listWorkOrderDocuments('p1', 'wo-1', [A, B, A])).toEqual([{ id: 'd1' }]);
    expect(h.calls.filter(([n]) => n === 'eq')).toEqual([['eq', ['project_id', 'p1']]]);
    expect(h.calls.find(([n]) => n === 'or')?.[1]).toEqual([`work_order_id.eq.wo-1,id.in.(${A},${B})`]);
    expect(h.calls.filter(([n]) => n === 'order').map(([, a]) => a[0])).toEqual(['code', 'created_at', 'id']);
  });
  it('filters on the work order alone when nothing is linked, and drops ids that are not uuids', async () => {
    h.calls.length = 0;
    await listWorkOrderDocuments('p1', 'wo-1', ['x),id.neq.(1']);
    expect(h.calls.find(([n]) => n === 'or')?.[1]).toEqual(['work_order_id.eq.wo-1']);
  });
});
