import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]>, result: { data: [] as unknown, error: null as unknown } }));
vi.mock('@/src/lib/supabase/client', () => {
  const chain = (name: string): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'order', 'limit', 'range', 'eq']) c[m] = (...a: unknown[]) => { h.calls.push([`${name}.${m}`, a]); return c; };
    for (const m of ['insert', 'update']) c[m] = (v: unknown) => { h.calls.push([`${name}.${m}`, v]); return c; };
    c.delete = () => { h.calls.push([`${name}.delete`, null]); return c; };
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
    return c;
  };
  return {
    supabase: {
      from: (n: string) => chain(n),
      // A `returns table` function is paged, so the rpc result is a chainable, awaitable page builder too.
      rpc: (n: string, a: unknown) => {
        h.calls.push([`rpc.${n}`, a]);
        const c: Record<string, unknown> = {};
        for (const m of ['order', 'range']) c[m] = (...args: unknown[]) => { h.calls.push([`rpc.${n}.${m}`, args]); return c; };
        c.then = (res: (v: unknown) => unknown) => Promise.resolve(h.result).then(res);
        return c;
      },
    },
  };
});

import { createClearanceItem, listClearanceItems, listPersonChecklist, listPersonClearanceDue, saveClearanceState, updateClearanceItem } from './clearance';

beforeEach(() => { h.calls.length = 0; h.result = { data: [], error: null }; });

describe('AC-CLR-008 clearance DAL sends no org_id', () => {
  it('creating an item sends the name and required flag only', async () => {
    await createClearanceItem({ name: ' Item ', is_required: true });
    const insert = h.calls.find(([k]) => k === 'clearance_items.insert')?.[1] as Record<string, unknown>;
    expect(insert).toEqual({ name: 'Item', is_required: true });
    expect(insert).not.toHaveProperty('org_id');
    expect(insert).not.toHaveProperty('target_days');
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

describe('FR-CTD-003 a clearance item carries an optional target in days', () => {
  it('a new item with a target sends it; an item without one sends nothing extra', async () => {
    await createClearanceItem({ name: 'Site induction', is_required: true, sort_order: 3, target_days: 14 });
    expect(h.calls.find(([k]) => k === 'clearance_items.insert')?.[1]).toEqual({ name: 'Site induction', is_required: true, sort_order: 3, target_days: 14 });
    h.calls.length = 0;
    await createClearanceItem({ name: 'Site induction', is_required: true, target_days: null });
    expect(h.calls.find(([k]) => k === 'clearance_items.insert')?.[1]).toEqual({ name: 'Site induction', is_required: true, target_days: null });
  });

  it('changing or removing the target is one column write; the database stamps and clears the stamp', async () => {
    h.result = { data: [{ id: 'i1' }], error: null };
    await updateClearanceItem('i1', { target_days: 30 });
    expect(h.calls.find(([k]) => k === 'clearance_items.update')?.[1]).toEqual({ target_days: 30 });
    expect(h.calls).toContainEqual(['clearance_items.eq', ['id', 'i1']]);
    h.calls.length = 0;
    h.result = { data: [{ id: 'i1' }], error: null };
    await updateClearanceItem('i1', { target_days: null });
    expect(h.calls.find(([k]) => k === 'clearance_items.update')?.[1]).toEqual({ target_days: null });
  });

  it('the item list reads each target so the admin screen can show it', async () => {
    h.result = { data: [{ id: 'i1', name: 'A', is_required: true, sort_order: 1, document_type_id: null, target_days: 7 }], error: null };
    await expect(listClearanceItems()).resolves.toEqual([
      { id: 'i1', name: 'A', is_required: true, sort_order: 1, document_type_id: null, target_days: 7 },
    ]);
    expect(h.calls).toContainEqual(['clearance_items.select', ['id, name, is_required, sort_order, document_type_id, target_days']]);
  });
});

describe('FR-CTD-004/009 each person’s due day comes from the database function', () => {
  it('reads the due rows from ONE paged call of person_clearance_due, ordered, with no org_id', async () => {
    h.result = {
      data: [
        { person_id: 'p1', item_id: 'i1', due_on: '2026-11-01', overdue: true },
        { person_id: 'p1', item_id: 'i2', due_on: '2026-11-30', overdue: false },
      ],
      error: null,
    };
    await expect(listPersonClearanceDue()).resolves.toEqual([
      { personId: 'p1', itemId: 'i1', dueOn: '2026-11-01', overdue: true },
      { personId: 'p1', itemId: 'i2', dueOn: '2026-11-30', overdue: false },
    ]);
    expect(h.calls).toContainEqual(['rpc.person_clearance_due', undefined]);
    expect(h.calls).toContainEqual(['rpc.person_clearance_due.order', ['person_id', { ascending: true }]]);
    expect(h.calls).toContainEqual(['rpc.person_clearance_due.order', ['item_id', { ascending: true }]]);
    expect(h.calls).toContainEqual(['rpc.person_clearance_due.range', [0, 999]]);
    // One call for the whole organisation: the people list and a person's checklist share it.
    expect(h.calls.filter(([k]) => k === 'rpc.person_clearance_due')).toHaveLength(1);
  });

  it('reports a failed due read as an error rather than an empty list', async () => {
    h.result = { data: null, error: { message: 'permission denied', code: '42501' } };
    await expect(listPersonClearanceDue()).rejects.toMatchObject({ code: '42501' });
  });
});
