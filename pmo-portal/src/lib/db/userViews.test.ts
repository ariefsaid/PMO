import { describe, it, expect, vi, beforeEach } from 'vitest';

// A flexible chainable mock of the supabase query builder. Each terminal call
// (the awaited one) resolves the queued result; we assert the recorded calls.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    is: [] as unknown[],
    order: [] as unknown[],
    insert: [] as unknown[],
    update: [] as unknown[],
    delete: 0,
    single: 0,
    maybeSingle: 0,
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'delete' || name === 'single' || name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.is = chain('is');
  builder.order = chain('order');
  builder.insert = chain('insert');
  builder.update = chain('update');
  builder.delete = chain('delete');
  builder.single = chain('single');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import {
  listUserViews,
  getUserView,
  createUserView,
  updateUserView,
  archiveUserView,
  deleteUserView,
} from './userViews';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
    else (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-UV-007 listUserViews', () => {
  it('AC-UV-007: lists non-archived views newest-first, never sends org_id/user_id', async () => {
    h.result.value = {
      data: [{ id: 'v1', name: 'My View', scope: 'private', archived_at: null }],
      error: null,
    };
    const rows = await listUserViews();
    expect(h.calls.from).toEqual(['user_views']);
    // archived hidden by default → filters on archived_at IS NULL
    expect(h.calls.is).toContainEqual(['archived_at', null]);
    // newest write first
    expect(h.calls.order).toContainEqual(['updated_at', { ascending: false }]);
    // neither org_id nor user_id is ever sent (RLS stamps/scopes them)
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('user_id');
    expect(rows[0].name).toBe('My View');
  });

  it('AC-UV-007: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listUserViews()).resolves.toEqual([]);
  });

  it('AC-UV-007: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listUserViews()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listUserViews()).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-UV-007 getUserView', () => {
  it('AC-UV-007: selects a single view by id, no org_id/user_id', async () => {
    h.result.value = { data: { id: 'v1', name: 'My View', scope: 'private', archived_at: null }, error: null };
    const row = await getUserView('v1');
    expect(h.calls.from).toEqual(['user_views']);
    expect(h.calls.eq).toContainEqual(['id', 'v1']);
    expect(h.calls.maybeSingle).toBe(1);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(JSON.stringify(h.calls)).not.toContain('user_id');
    expect(row?.name).toBe('My View');
  });

  it('AC-UV-007: returns null when no row found', async () => {
    h.result.value = { data: null, error: null };
    await expect(getUserView('missing')).resolves.toBeNull();
  });

  it('AC-UV-007: throws AppError with code on error', async () => {
    h.result.value = { data: null, error: { message: 'kaboom', code: 'PGRST116x' } };
    await expect(getUserView('v1')).rejects.toMatchObject({ code: 'PGRST116x' });
  });
});

describe('AC-UV-007 createUserView', () => {
  it('AC-UV-007: inserts only name/description/spec/scope, NEVER org_id/user_id, returns the row', async () => {
    const spec = { kind: 'table', source: 'projects' };
    h.result.value = { data: { id: 'new', name: 'Composed', scope: 'private', spec, archived_at: null }, error: null };
    const row = await createUserView({ name: 'Composed', spec, scope: 'private' });
    expect(h.calls.from).toEqual(['user_views']);
    expect(h.calls.insert).toEqual([{ name: 'Composed', description: null, spec, scope: 'private' }]);
    expect(JSON.stringify(h.calls.insert)).not.toContain('org_id');
    expect(JSON.stringify(h.calls.insert)).not.toContain('user_id');
    expect(h.calls.single).toBe(1);
    expect(row.id).toBe('new');
  });

  it('AC-UV-007: round-trips the spec opaquely (FR-UV-004 — sent verbatim)', async () => {
    const spec = { nested: { a: [1, 2, 3] }, flag: true };
    h.result.value = { data: { id: 'new', name: 'X', scope: 'private', spec, archived_at: null }, error: null };
    await createUserView({ name: 'X', spec });
    const payload = h.calls.insert[0] as Record<string, unknown>;
    expect(payload.spec).toBe(spec);
  });

  it('AC-UV-007: throws AppError preserving code 42501 when RLS denies the insert', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(createUserView({ name: 'X', spec: {} })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-UV-007 updateUserView', () => {
  it('AC-UV-007: updates editable fields + bumps updated_at, by id, NEVER org_id/user_id', async () => {
    h.result.value = { data: null, error: null };
    await updateUserView('v1', { name: 'Renamed', spec: { k: 1 }, scope: 'shared_org' });
    expect(h.calls.from).toEqual(['user_views']);
    expect(h.calls.update).toHaveLength(1);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch.name).toBe('Renamed');
    expect(patch.scope).toBe('shared_org');
    // OQ-2: updated_at bumped explicitly in the DAL (no DB trigger exists)
    expect(patch.updated_at).toEqual(expect.any(String));
    expect(patch.updated_at).not.toBeNull();
    expect(h.calls.eq).toContainEqual(['id', 'v1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
    expect(JSON.stringify(patch)).not.toContain('user_id');
  });

  it('AC-UV-007: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(updateUserView('v1', { name: 'Y', spec: {} })).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-UV-007 archiveUserView', () => {
  it('AC-UV-007: sets archived_at + updated_at via update by id, NEVER org_id/user_id', async () => {
    h.result.value = { data: null, error: null };
    await archiveUserView('v1');
    expect(h.calls.from).toEqual(['user_views']);
    expect(h.calls.update).toHaveLength(1);
    const patch = h.calls.update[0] as Record<string, unknown>;
    expect(patch.archived_at).toEqual(expect.any(String));
    expect(patch.archived_at).not.toBeNull();
    expect(patch.updated_at).toEqual(expect.any(String));
    expect(h.calls.eq).toContainEqual(['id', 'v1']);
    expect(JSON.stringify(patch)).not.toContain('org_id');
    expect(JSON.stringify(patch)).not.toContain('user_id');
  });

  it('AC-UV-007: throws AppError with code on a denied archive', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(archiveUserView('v1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-UV-007 deleteUserView', () => {
  it('AC-UV-007: deletes by id, NEVER org_id/user_id', async () => {
    h.result.value = { data: null, error: null };
    await deleteUserView('v1');
    expect(h.calls.from).toEqual(['user_views']);
    expect(h.calls.delete).toBe(1);
    expect(h.calls.eq).toContainEqual(['id', 'v1']);
    expect(JSON.stringify(h.calls.eq)).not.toContain('org_id');
    expect(JSON.stringify(h.calls.eq)).not.toContain('user_id');
  });

  it('AC-UV-007: throws AppError with code 42501 when RLS denies the delete', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(deleteUserView('v1')).rejects.toMatchObject({ code: '42501' });
  });
});
