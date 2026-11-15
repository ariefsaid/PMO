import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const reads: Array<{ select: string; eq: unknown[][]; neq: unknown[][]; or: unknown[][]; gte: unknown[][]; limit: number[]; result: { data: unknown[] | null; error: { message: string } | null } }> = [];
  const results = { awaiting: { data: [] as unknown[] | null, error: null as { message: string } | null }, approved: { data: [] as unknown[] | null, error: null as { message: string } | null } };
  const from = vi.fn(() => {
    const read = { select: '', eq: [] as unknown[][], neq: [] as unknown[][], or: [] as unknown[][], gte: [] as unknown[][], limit: [] as number[], result: results.awaiting };
    reads.push(read);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => { read.select = columns; return builder; };
    builder.eq = (...args: unknown[]) => {
      read.eq.push(args);
      if (args[0] === 'status') read.result = args[1] === 'Approved' ? results.approved : results.awaiting;
      return builder;
    };
    builder.neq = (...args: unknown[]) => { read.neq.push(args); return builder; };
    builder.or = (...args: unknown[]) => { read.or.push(args); return builder; };
    builder.gte = (...args: unknown[]) => { read.gte.push(args); return builder; };
    builder.limit = (n: number) => { read.limit.push(n); return builder; };
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(read.result).then(resolve);
    return builder;
  });
  return { reads, results, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: vi.fn() } }));

import { hasTimesheetApprovalWork } from './timesheetTransition';

beforeEach(() => {
  h.reads.length = 0;
  h.results.awaiting = { data: [], error: null };
  h.results.approved = { data: [], error: null };
});

describe('#2111 hasTimesheetApprovalWork — existence only', () => {
  it('asks each half for one id and the owner link, never entries, projects or outbox rows', async () => {
    await hasTimesheetApprovalWork('u1', 'Engineer');
    expect(h.reads).toHaveLength(2);
    for (const read of h.reads) {
      expect(read.select).toBe('id, owner:profiles!timesheets_user_id_fkey!inner(manager_id)');
      expect(read.limit).toEqual([1]);
      expect(read.neq).toEqual([['user_id', 'u1']]);
    }
    expect(h.reads.map((read) => read.eq[0])).toEqual([['status', 'Submitted'], ['status', 'Approved']]);
    expect(h.reads[1].gte[0][0]).toBe('week_start_date');
  });

  it.each([
    ['Engineer', 'eq', [['owner.manager_id', 'u1']]],
    ['Project Manager', 'eq', [['owner.manager_id', 'u1']]],
  ] as const)('a %s sees only the sheets of the people who report to them', async (role) => {
    await hasTimesheetApprovalWork('u1', role);
    for (const read of h.reads) expect(read.eq.slice(1)).toEqual([['owner.manager_id', 'u1']]);
  });

  it('an Executive also sees sheets whose owner has no manager; an Admin sees every other user\'s', async () => {
    await hasTimesheetApprovalWork('u1', 'Executive');
    for (const read of h.reads) expect(read.or).toEqual([['manager_id.eq.u1,manager_id.is.null', { referencedTable: 'owner' }]]);
    h.reads.length = 0;
    await hasTimesheetApprovalWork('u1', 'Admin');
    for (const read of h.reads) {
      expect(read.or).toEqual([]);
      expect(read.eq).toHaveLength(1);
    }
  });

  it('is true when either half has a row and false when neither does', async () => {
    expect(await hasTimesheetApprovalWork('u1', 'Engineer')).toBe(false);
    h.results.approved = { data: [{ id: 't1' }], error: null };
    expect(await hasTimesheetApprovalWork('u1', 'Engineer')).toBe(true);
    h.results.approved = { data: [], error: null };
    h.results.awaiting = { data: [{ id: 't2' }], error: null };
    expect(await hasTimesheetApprovalWork('u1', 'Engineer')).toBe(true);
  });

  it('fails rather than answering "no work" when a read fails', async () => {
    h.results.awaiting = { data: null, error: { message: 'rls denied' } };
    await expect(hasTimesheetApprovalWork('u1', 'Engineer')).rejects.toThrow('rls denied');
  });
});
