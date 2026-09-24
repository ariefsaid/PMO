import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable supabase query-builder mock (same shape as orgs.test.ts):
// `.from('organizations').select('lifecycle_state').limit(1)` is awaited directly (thenable),
// so the builder resolves the queued result.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], select: [] as unknown[], limit: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.select = (arg: unknown) => {
    calls.select.push(arg);
    return builder;
  };
  builder.limit = (arg: unknown) => {
    calls.limit.push(arg);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });
  return { from, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { getOrgLifecycleState } from './orgs';

// AC-AUTH-013/014 — the org-state read behind the demo-restricted Admin view-as control
// (FR-AUTH-036/037). `organizations` is RLS-scoped to the caller's own org (its ONLY policy is
// `organizations_select`), so the read never sends `org_id` and returns at most one row.
describe('getOrgLifecycleState — signed-in org lifecycle marker (DD-ORG-3, migration 0191)', () => {
  beforeEach(() => {
    h.calls.from.length = 0;
    h.calls.select.length = 0;
    h.calls.limit.length = 0;
    h.result.value = { data: null, error: null };
  });

  it('reads organizations.lifecycle_state scoped to the caller org under RLS (org_id never sent)', async () => {
    h.result.value = { data: [{ lifecycle_state: 'demo' }], error: null };
    await expect(getOrgLifecycleState()).resolves.toBe('demo');
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['lifecycle_state']);
    expect(h.calls.limit).toEqual([1]);
  });

  it.each([
    ['live', 'live'],
    ['test', 'test'],
  ] as const)('passes the explicit %s state through unchanged', async (raw, expected) => {
    h.result.value = { data: [{ lifecycle_state: raw }], error: null };
    await expect(getOrgLifecycleState()).resolves.toBe(expected);
  });

  it('maps a NULL lifecycle_state to null — unknown is never demo (fail closed, mirrors assert_org_destroyable)', async () => {
    h.result.value = { data: [{ lifecycle_state: null }], error: null };
    await expect(getOrgLifecycleState()).resolves.toBeNull();
  });

  it('maps a future/unknown state value to null rather than guessing', async () => {
    h.result.value = { data: [{ lifecycle_state: 'archived' }], error: null };
    await expect(getOrgLifecycleState()).resolves.toBeNull();
  });

  it('maps a missing org row to null (no visible org → not demo)', async () => {
    h.result.value = { data: [], error: null };
    await expect(getOrgLifecycleState()).resolves.toBeNull();
  });

  it('throws on a query error rather than resolving to a permissive value', async () => {
    h.result.value = { data: null, error: { message: 'rls denied' } };
    await expect(getOrgLifecycleState()).rejects.toThrow('rls denied');
  });
});
