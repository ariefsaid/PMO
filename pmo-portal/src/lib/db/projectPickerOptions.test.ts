import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, ...unknown[]]> = [];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'in', 'is', 'eq', 'order']) q[m] = (...a: unknown[]) => { calls.push([m, ...a]); return q; };
  q.range = (...a: unknown[]) => { calls.push(['range', ...a]); return q; };
  q.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: 'p1', name: 'A' }], error: null });
  return { calls, from: vi.fn(() => q) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { ACTIVE_PROJECT_STATUSES, listProjectPickerOptions } from './projects';

describe('listProjectPickerOptions', () => {
  it('reads only picker columns, no joins, with the same active/unarchived scope as listProjects', async () => {
    const rows = await listProjectPickerOptions();
    expect(rows).toEqual([{ id: 'p1', name: 'A' }]);
    const select = h.calls.find((c) => c[0] === 'select')![1] as string;
    expect(select.split(',').map((s) => s.trim()).sort()).toEqual(
      ['code', 'id', 'name', 'project_manager_id', 'short_name', 'status'],
    );
    expect(h.calls).toContainEqual(['in', 'status', ACTIVE_PROJECT_STATUSES]);
    expect(h.calls).toContainEqual(['is', 'archived_at', null]);
    expect(h.calls).toContainEqual(['order', 'id', { ascending: true }]);
  });
});
