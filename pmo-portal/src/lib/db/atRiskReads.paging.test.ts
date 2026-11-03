import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1774 — the six list reads that were allow-listed as AT RISK in
 * `scripts/check-unpaged-reads.mjs`. PostgREST's `max_rows = 1000` truncates silently
 * (HTTP 200, short body, no error), so each of these reads used to stop at 1,000 rows.
 *
 * The mock below MODELS that server cap: one response never carries more than 1,000 rows,
 * whatever the caller asks for. A read that does not page therefore sees exactly 1,000 rows
 * and fails here; a read that pages sees all 1,005.
 *
 * `work_order_billing_lines` is the diagnostic copy (not a sum) — its failure posture is
 * pinned separately: a failed page must never fail the billing read itself.
 */
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const tables: Record<string, Row[]> = {};
  const ranges: Record<string, Array<[number, number]>> = {};
  const orders: Record<string, string[]> = {};
  const failAt: Record<string, { start: number; error: unknown }> = {};
  const SERVER_CAP = 1000; // supabase/config.toml max_rows

  const from = vi.fn((table: string) => {
    let start = 0;
    // The server's own default window: one response, capped at max_rows.
    let end = SERVER_CAP - 1;
    let limit: number | null = null;
    let afterId: string | null = null;
    ranges[table] ??= [];
    orders[table] ??= [];

    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = () => q;
    q.in = () => q;
    q.is = () => q;
    q.gt = (_column: string, value: string) => { afterId = value; return q; };
    q.limit = (n: number) => { limit = n; return q; };
    q.order = (column: string) => { orders[table]!.push(column); return q; };
    q.range = (a: number, b: number) => { start = a; end = b; ranges[table]!.push([a, b]); return q; };
    q.then = (resolve: (value: unknown) => unknown) => {
      const all = tables[table] ?? [];
      const cursor: string | null = afterId;
      const scoped = cursor === null ? all : all.filter((r) => String(r.id) > cursor);
      const window = Math.min(end - start + 1, SERVER_CAP);
      const count = limit === null ? window : Math.min(window, limit);
      const failing = failAt[table];
      return resolve(failing && failing.start === start
        ? { data: null, error: failing.error }
        : { data: scoped.slice(start, start + count), error: null });
    };
    return q;
  });

  return { tables, ranges, orders, failAt, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listProjectIdentity, listProjects } from './projects';
import { listProcurementsByVendor } from './procurements';
import { listBoqItems } from './progressBilling';
import { listIssuableWorkItems } from './stockDocuments';
import { listWorkOrderBilling } from './workOrderBilling';

const ids = (n: number) => Array.from({ length: n }, (_, i) => String(i).padStart(4, '0'));

const WOB_ROW = {
  work_order_id: 'wo-1', project_id: 'p1', status: 'Issued' as const, currency: 'USD',
  order_net: 500000, invoiced: 1000, pending: 0, paid: 0, remaining: 499000,
  figures_complete: false, line_count: 1005, unpaid_count: 1005,
};

beforeEach(() => {
  for (const k of Object.keys(h.tables)) delete h.tables[k];
  for (const k of Object.keys(h.ranges)) delete h.ranges[k];
  for (const k of Object.keys(h.orders)) delete h.orders[k];
  for (const k of Object.keys(h.failAt)) delete h.failAt[k];
});

describe('#1774 at-risk list reads reach past the 1,000-row response cap', () => {
  it('projects.ts listProjects returns every project, not the first page', async () => {
    h.tables.projects = ids(1005).map((id) => ({ id, name: `Project ${id}` }));
    const rows = await listProjects();
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    expect(rows).toHaveLength(new Set(ids(1005)).size);
    // A total, stable order is required for paging: the row id.
    expect(h.orders.projects).toContain('id');
    expect(h.ranges.projects).toEqual([[0, 999], [1000, 1999]]);
  });

  it('projects.ts listProjectIdentity returns every project id+name', async () => {
    h.tables.projects = ids(1005).map((id) => ({ id, name: `Project ${id}` }));
    const rows = await listProjectIdentity();
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    expect(h.orders.projects).toContain('id');
    expect(h.ranges.projects).toEqual([[0, 999], [1000, 1999]]);
  });

  it("procurements.ts listProcurementsByVendor returns a vendor's whole history", async () => {
    h.tables.procurements = ids(1005).map((id) => ({ id, vendor_id: 'v1', status: 'Paid' }));
    const rows = await listProcurementsByVendor('v1');
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    expect(h.orders.procurements).toContain('id');
  });

  it("progressBilling.ts listBoqItems returns a project's whole bill of quantities", async () => {
    h.tables.boq_items = ids(1005).map((id, i) => ({ id, project_id: 'p1', line_no: i + 1 }));
    const rows = await listBoqItems('p1');
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    // The existing total order is preserved (line_no, created_at, id).
    expect(h.orders.boq_items).toEqual(expect.arrayContaining(['line_no', 'created_at', 'id']));
    expect(h.ranges.boq_items).toEqual([[0, 999], [1000, 1999]]);
  });

  it('stockDocuments.ts listIssuableWorkItems returns the whole picker list', async () => {
    h.tables.boq_items = ids(1005).map((id, i) => ({ id, line_no: i + 1, item_code: `A-${id}`, description: 'Cable', unit: 'm' }));
    const rows = await listIssuableWorkItems('p1');
    expect(rows).toHaveLength(1005);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1005);
    // ⚑ The picker must still never carry the rate.
    expect(h.orders.boq_items).not.toContain('rate');
  });

  it('workOrderBilling.ts reads every billing line behind an untotallable work order', async () => {
    h.tables.work_order_billing = [{ ...WOB_ROW }];
    h.tables.work_order_billing_lines = ids(1005).map((id) => ({
      id, record_id: `si-${id}`, work_order_id: 'wo-1', billed: null, currency: 'USD',
    }));
    const [row] = await listWorkOrderBilling('p1');
    expect(row!.problems).toHaveLength(1005);
    expect(new Set(row!.problems!.map((p) => p.recordId)).size).toBe(1005);
    expect(h.ranges.work_order_billing_lines).toEqual([[0, 999], [1000, 1999]]);
  });

  it('workOrderBilling.ts a failed later page still leaves the row untotallable, and never fails the read', async () => {
    h.tables.work_order_billing = [{ ...WOB_ROW }];
    h.tables.work_order_billing_lines = ids(1005).map((id) => ({
      id, record_id: `si-${id}`, work_order_id: 'wo-1', billed: null, currency: 'USD',
    }));
    h.failAt.work_order_billing_lines = { start: 1000, error: { message: 'denied', code: '42501' } };
    const [row] = await listWorkOrderBilling('p1');
    expect(row!.figuresComplete).toBe(false);
    // No partial set of causes is ever attached to a figure the user could act on.
    expect(row!.problems).toBeUndefined();
  });
});
