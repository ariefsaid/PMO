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
  return { from: vi.fn(query), SELF, N };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: vi.fn() } }));

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
