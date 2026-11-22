import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

/**
 * Daily head counts of people with no name on the roster (docs/specs/guard-headcount.spec.md, migration 1710). The DAL
 * never sends org_id or an approver; writes go through their three RPCs; a refusal keeps its Postgres code.
 */
const h = vi.hoisted(() => {
  const result = { value: {} as { data: unknown; error: unknown } };
  const calls = { from: [] as string[], rpc: [] as Array<[string, unknown]>, select: [] as unknown[], eq: [] as unknown[], order: [] as unknown[], gt: [] as unknown[], limit: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...a: unknown[]) => { (calls[name] as unknown[]).push(a.length === 1 ? a[0] : a); return builder; };
  for (const k of ['select', 'eq', 'order', 'gt', 'limit'] as const) builder[k] = chain(k);
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a?: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(result.value); });
  return { from, rpc, calls, result };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import * as hc from './headcount';
import { headcountRepository } from '@/src/lib/repositories/headcount';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const v of Object.values(h.calls)) (v as unknown[]).length = 0;
  h.result.value = { data: null, error: null };
});

describe('head count DAL', () => {
  it('lists the lines of a work order and day with explicit columns, no embeds, one row per class', async () => {
    h.result.value = { data: [{ id: 'l1', crew_id: 'c1', class_id: 'k1', head_count: 3, work_date: '2026-11-20', approved_at: null, recorded_by_ids: ['u1'] }], error: null };
    const rows = await hc.listHeadcountDay('wo1', '2026-11-20');
    expect(rows).toEqual([{ id: 'l1', crewId: 'c1', classId: 'k1', headCount: 3, workDate: '2026-11-20', approvedAt: null, recordedByIds: ['u1'] }]);
    expect(h.calls.from).toEqual(['headcount_days']);
    expect(String(h.calls.select[0])).not.toMatch(/\(/);
    expect(h.calls.eq).toEqual(expect.arrayContaining([['work_order_id', 'wo1'], ['work_date', '2026-11-20']]));
  });

  it('records through record_headcount_day with the five named arguments and no org_id', async () => {
    h.result.value = { data: 'new-id', error: null };
    const id = await hc.recordHeadcount({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-20', classId: 'k1', count: 4 });
    expect(id).toBe('new-id');
    expect(h.calls.rpc).toEqual([['record_headcount_day', { p_work_order_id: 'wo1', p_crew_id: 'c1', p_work_date: '2026-11-20', p_class_id: 'k1', p_count: 4 }]]);
  });

  it('approves and clears through their RPCs', async () => {
    await hc.approveHeadcount('l1');
    await hc.clearHeadcount('l1');
    expect(h.calls.rpc).toEqual([['approve_headcount_day', { p_id: 'l1' }], ['clear_headcount_day', { p_id: 'l1' }]]);
  });

  it('a refusal keeps its Postgres code and its coded message through the repository', async () => {
    h.result.value = { data: null, error: { message: 'HC_LOCKED: this head count is approved and final', code: '23514' } };
    const err = await headcountRepository.record({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-20', classId: 'k1', count: 4 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: '23514', message: expect.stringContaining('HC_LOCKED') });
  });

  it('refuses a count outside 1 to 500 before calling the database', async () => {
    await expect(hc.recordHeadcount({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-20', classId: 'k1', count: 0 })).rejects.toMatchObject({ code: 'validation' });
    await expect(hc.recordHeadcount({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-20', classId: 'k1', count: 2.5 })).rejects.toMatchObject({ code: 'validation' });
    expect(h.calls.rpc).toEqual([]);
  });
});
