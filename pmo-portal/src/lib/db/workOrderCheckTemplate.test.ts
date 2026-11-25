import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: [] as unknown, error: null as unknown } };
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'is', 'order', 'limit'] as const) builder[k] = (...a: unknown[]) => { calls.push([k, a]); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const rpc = vi.fn((n: string, a?: unknown) => Promise.resolve({ ...result.value, n, a }));
  return { calls, result, rpc, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { listCheckTemplate, saveCheckTemplate } from './workOrderCheckTemplate';

beforeEach(() => { h.calls.length = 0; h.rpc.mockClear(); h.result.value = { data: [], error: null }; });

describe('AC-WOC-001 the standard checks for a new work order', () => {
  it('reads the live list in order', async () => {
    const row = { id: 'a', label: 'Drawings', position: 1, owner_job_role: 'engineer', target_days: 3 };
    h.result.value = { data: [row], error: null };
    expect(await listCheckTemplate()).toEqual([row]);
    expect(h.calls).toContainEqual(['is', ['archived_at', null]]);
  });
  it('saves the whole ordered list with each line\'s job role and days, an id only for an existing line, never org_id', async () => {
    h.result.value = { data: 2, error: null };
    await saveCheckTemplate([{ id: 'a', label: ' Drawings ', ownerJobRole: 'engineer', targetDays: 3 }, { id: null, label: 'Permit', ownerJobRole: 'hr_officer', targetDays: 5 }]);
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_check_template', {
      p_items: [{ id: 'a', label: 'Drawings', owner_job_role: 'engineer', target_days: 3 }, { label: 'Permit', owner_job_role: 'hr_officer', target_days: 5 }],
    });
  });
});
