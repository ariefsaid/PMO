import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable mock of the supabase query builder (same pattern as companies.test).
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    in: [] as unknown[],
    order: [] as unknown[],
    update: [] as unknown[],
  };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.in = chain('in');
  builder.order = chain('order');
  builder.update = chain('update');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listUsers, updateUserRole, assignUserManager } from './adminUsers';
import { AppError } from '@/src/lib/appError';

beforeEach(() => {
  h.from.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
  h.result.value = { data: null, error: null };
});

describe('AC-AU-001 listUsers (org-scoped profiles, name + email + role + manager)', () => {
  it('AC-AU-001: selects all profiles, never sends org_id, ordered by full_name', async () => {
    h.result.value = {
      data: [
        { id: 'u1', full_name: 'Renata Halloway', email: 'r@x', role: 'Admin', manager_id: null, org_id: 'org-1' },
      ],
      error: null,
    };
    const rows = await listUsers();
    expect(h.calls.from).toEqual(['profiles']);
    // org_id is never sent on a read — RLS (profiles_select) scopes it
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    // ordered by full_name for a stable, scannable directory
    expect(h.calls.order).toContainEqual('full_name');
    expect(rows[0].full_name).toBe('Renata Halloway');
  });

  it('AC-AU-001: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listUsers()).resolves.toEqual([]);
  });

  it('AC-AU-001: throws AppError preserving the PG code on a read error', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listUsers()).rejects.toMatchObject({ message: 'denied', code: '42501' });
    await expect(listUsers()).rejects.toBeInstanceOf(AppError);
  });
});

describe('AC-AU-003 updateUserRole (Admin-only via profiles_admin_write RLS)', () => {
  it('AC-AU-003: updates only the role column by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await updateUserRole('u2', 'Executive');
    expect(h.calls.from).toEqual(['profiles']);
    expect(h.calls.update).toEqual([{ role: 'Executive' }]);
    expect(h.calls.eq).toContainEqual(['id', 'u2']);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
  });

  it('AC-AU-003: throws AppError preserving code 42501 when a non-Admin is denied by RLS', async () => {
    h.result.value = { data: null, error: { message: 'new row violates RLS', code: '42501' } };
    await expect(updateUserRole('u2', 'Admin')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('AC-AU-004 assignUserManager (manager_id; null clears it)', () => {
  it('AC-AU-004: updates only manager_id by id, NEVER org_id', async () => {
    h.result.value = { data: null, error: null };
    await assignUserManager('u3', 'mgr-1');
    expect(h.calls.from).toEqual(['profiles']);
    expect(h.calls.update).toEqual([{ manager_id: 'mgr-1' }]);
    expect(h.calls.eq).toContainEqual(['id', 'u3']);
    expect(JSON.stringify(h.calls.update)).not.toContain('org_id');
  });

  it('AC-AU-004: a null manager clears the reporting line', async () => {
    h.result.value = { data: null, error: null };
    await assignUserManager('u3', null);
    expect(h.calls.update).toEqual([{ manager_id: null }]);
  });

  it('AC-AU-004: throws AppError with code on a denied update', async () => {
    h.result.value = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(assignUserManager('u3', 'mgr-1')).rejects.toMatchObject({ code: '42501' });
  });
});
