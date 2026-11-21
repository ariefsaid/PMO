import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, result: { data: [] as unknown, error: null as unknown } }));
vi.mock('@/src/lib/supabase/client', () => {
  const chain = (name: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'order', 'limit', 'eq']) c[m] = (...a: unknown[]) => { h.calls.push([`${name}.${m}`, a]); return c; };
    for (const m of ['insert', 'update']) c[m] = (v: unknown) => { h.calls.push([`${name}.${m}`, v]); return c; };
    c.delete = () => { h.calls.push([`${name}.delete`, null]); return c; };
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
    return c;
  };
  return { supabase: { from: (n: string) => chain(n), rpc: (n: string, a: unknown) => { h.calls.push([`rpc.${n}`, a]); return Promise.resolve(h.result); } } };
});

import { createClearanceItem, listPersonChecklist, saveClearanceState } from './clearance';

beforeEach(() => { h.calls.length = 0; h.result = { data: [], error: null }; });

describe('AC-CLR-008 clearance DAL sends no org_id', () => {
  it('creating an item sends the name and required flag only', async () => {
    await createClearanceItem({ name: ' Item ', is_required: true });
    const insert = h.calls.find(([k]) => k === 'clearance_items.insert')?.[1] as Record<string, unknown>;
    expect(insert).toEqual({ name: 'Item', is_required: true });
    expect(insert).not.toHaveProperty('org_id');
  });
  it('recording a state updates first, then inserts only person, item and the three fields', async () => {
    await saveClearanceState('p1', 'i1', { done_on: '2026-11-01', expires_on: null, note: null });
    const insert = h.calls.find(([k]) => k === 'person_clearances.insert')?.[1] as Record<string, unknown>;
    expect(Object.keys(insert).sort()).toEqual(['done_on', 'expires_on', 'item_id', 'note', 'person_id']);
  });
  it('the per-item state is read from the database function, not recomputed', async () => {
    await listPersonChecklist('p1');
    expect(h.calls).toContainEqual(['rpc.person_clearance_items', { p_person: 'p1' }]);
  });
});
