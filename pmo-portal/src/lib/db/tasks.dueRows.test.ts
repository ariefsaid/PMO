import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const state = { ins: [] as string[][], select: '', fail: false, delay: false, inflight: 0, maxInflight: 0 };
  const from = vi.fn(() => {
    const q = {
      select: (cols: string) => { state.select = cols; return q; },
      in: (_c: string, ids: string[]) => { state.ins.push(ids); return q; },
      is: () => q, order: () => q, range: () => q,
      then: (resolve: (v: unknown) => void) => state.delay
        ? (() => { state.inflight += 1; state.maxInflight = Math.max(state.maxInflight, state.inflight);
          return new Promise<void>((done) => setTimeout(done, 5)).then(() => { state.inflight -= 1; resolve({ data: [], error: null }); }); })()
        : resolve(state.fail
        ? { data: null, error: { message: 'boom', code: 'XX001' } }
        : { data: [{ id: 't', project_id: 'p', status: 'To Do', end_date: null }], error: null }),
    };
    return q;
  });
  return { state, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
import { listTaskDueRows } from './tasks';

beforeEach(() => { h.state.ins = []; h.state.fail = false; h.state.delay = false; h.state.inflight = 0; h.state.maxInflight = 0; h.from.mockClear(); });

describe('listTaskDueRows (#1741)', () => {
  it('reads nothing for no projects', async () => {
    expect(await listTaskDueRows([])).toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });
  it('batches projects into bounded .in chunks with a narrow select', async () => {
    const ids = Array.from({ length: 205 }, (_, i) => `p${i}`);
    await listTaskDueRows([...ids, 'p0']);
    expect(h.state.ins.map((c) => c.length)).toEqual([100, 100, 5]);
    expect(h.state.select).toBe('id, project_id, status, end_date');
  });
  it('#2109 reads chunks in parallel, at most four at once', async () => {
    h.state.delay = true;
    await listTaskDueRows(Array.from({ length: 650 }, (_, i) => `p${i}`));
    expect(h.state.ins).toHaveLength(7);
    expect(h.state.maxInflight).toBe(4);
  });
  it('throws instead of returning a partial set', async () => {
    h.state.fail = true;
    await expect(listTaskDueRows(['p1'])).rejects.toMatchObject({ message: 'boom' });
  });
});
