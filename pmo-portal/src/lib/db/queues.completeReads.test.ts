import { describe, expect, it, vi } from 'vitest';

/**
 * THEME-DATA-31 — interactive queues and registers must see EVERY row, not the first `db-max-rows`.
 * The fake caps one response at 1000 rows and, like PostgREST, signals nothing when it truncates.
 */
const h = vi.hoisted(() => {
  const N = 1005;
  const pad = (i: number) => String(i).padStart(5, '0');
  const SELF = 'manager';
  const table = (name: string) => Array.from({ length: N }, (_, i) => ({
    id: pad(i), timesheet_id: pad(i), project_id: null, profile_id: pad(i), user_id: `u${i}`,
    status: 'Submitted', push_state: 'failed', week_start_date: '2026-01-01', updated_at: '2026-01-01',
    created_at: '2026-01-01', approved_by: null, entries: [], project: null, profile: null,
    owner: { full_name: `Owner ${i}`, manager_id: SELF }, _t: name,
    ...(name === 'work_orders' ? { status: 'Draft' } : {}),
  }));
  function query(name: string) {
    let rows = table(name);
    let limit = 1000, from = 0;
    const q: Record<string, unknown> = {
      select: () => q, eq: () => q, neq: () => q, is: () => q, or: () => q, gte: () => q,
      order: () => q,
      in: (c: string, vals: string[]) => { if (c === 'id') rows = rows.filter((r) => vals.includes(r.id)); return q; },
      gt: (_c: string, v: string) => { rows = rows.filter((r) => r.id > v); return q; },
      limit: (n: number) => { limit = n; return q; },
      range: (a: number, b: number) => { from = a; limit = b - a + 1; return q; },
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: rows.slice(from, from + Math.min(limit, 1000)), error: null }),
    };
    return q;
  }
  // Like PostgREST: a set-returning rpc is capped at 1000 rows without any signal.
  const rpc = vi.fn(async (_n: string, args: { p_ids: string[] }) => ({
    data: args.p_ids.map((id) => ({ work_order_id: id, reason: 'allowed' })).slice(0, 1000), error: null,
  }));
  return { from: vi.fn(query), rpc, SELF, N };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { listSpendApprovers } from './spendApprovers';
import { listPushesNeedingAttention } from './timesheetPush';
import { listTimesheetsAwaitingApproval } from './timesheetTransition';
import { listTimesheets } from './timesheets';
import { listUserViews } from './userViews';
import { listProjectWorkOrders } from './workOrders';

describe('DATA-31 queues return the whole set across the server cap', () => {
  it.each([
    ['spend approvers', () => listSpendApprovers()],
    ['pushes needing attention', () => listPushesNeedingAttention()],
    ['timesheets awaiting approval', () => listTimesheetsAwaitingApproval(h.SELF + 'x', 'Admin')],
    ['own timesheets', () => listTimesheets('u')],
    ['saved views', () => listUserViews()],
    ['project work orders', () => listProjectWorkOrders('p')],
  ])('%s', async (_name, read) => {
    const rows = await read();
    expect(rows).toHaveLength(h.N);
    expect(new Set(rows.map((r: { id?: string; timesheet_id?: string }) => r.id ?? r.timesheet_id)).size).toBe(h.N);
  });
});

describe('DATA-31 work-order eligibility join', () => {
  it('chunks past the server cap: every draft keeps its decision, no call carries over 100 ids', async () => {
    h.rpc.mockClear();
    const rows = await listProjectWorkOrders('p');
    expect(rows).toHaveLength(h.N);
    expect(rows.every((r) => r.issue_eligibility === 'allowed')).toBe(true);
    const sizes = h.rpc.mock.calls.map(([, a]) => a.p_ids.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(h.N);
  });
});
