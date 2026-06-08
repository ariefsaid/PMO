import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable builder: select() → { eq, order }; both terminals resolve `result.value`.
const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as unknown[], eq: [] as unknown[], order: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  builder.eq = (...args: unknown[]) => {
    calls.eq.push(args);
    return builder;
  };
  builder.order = (...args: unknown[]) => {
    calls.order.push(args);
    return builder;
  };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const select = vi.fn(() => builder);
  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return { select };
  });
  return { from, select, calls, result };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listProjectManagers, listOrgProfiles } from './profiles';

beforeEach(() => {
  h.from.mockClear();
  h.select.mockClear();
  h.calls.from.length = 0;
  h.calls.eq.length = 0;
  h.calls.order.length = 0;
  h.result.value = { data: null, error: null };
});

describe('listProjectManagers', () => {
  it("selects profiles where role = 'Project Manager' (FR-DAL-005, OD-2)", async () => {
    h.result.value = {
      data: [{ id: 'a2', full_name: 'Alice Manager', role: 'Project Manager' }],
      error: null,
    };
    const result = await listProjectManagers();
    expect(h.from).toHaveBeenCalledWith('profiles');
    expect(h.calls.eq).toContainEqual(['role', 'Project Manager']);
    expect(result[0].full_name).toBe('Alice Manager');
  });
  it('throws on error', async () => {
    h.result.value = { data: null, error: { message: 'boom' } };
    await expect(listProjectManagers()).rejects.toThrow('boom');
  });
});

describe('AC-TASK-008 listOrgProfiles (assignee picker source)', () => {
  it('AC-TASK-008: selects all profiles in the org, never sends org_id, ordered by full_name', async () => {
    h.result.value = {
      data: [{ id: 'u1', full_name: 'Dana Eng', role: 'Engineer' }],
      error: null,
    };
    const result = await listOrgProfiles();
    expect(h.from).toHaveBeenCalledWith('profiles');
    expect(h.calls.order).toContainEqual(['full_name']);
    expect(JSON.stringify(h.calls)).not.toContain('org_id');
    expect(result[0].full_name).toBe('Dana Eng');
  });
  it('AC-TASK-008: returns [] when supabase returns null data', async () => {
    h.result.value = { data: null, error: null };
    await expect(listOrgProfiles()).resolves.toEqual([]);
  });
  it('AC-TASK-008: throws on error', async () => {
    h.result.value = { data: null, error: { message: 'kaboom' } };
    await expect(listOrgProfiles()).rejects.toThrow('kaboom');
  });
});
