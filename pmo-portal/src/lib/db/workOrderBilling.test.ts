import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const state = { rows: { data: null as unknown, error: null as unknown }, rpc: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], select: [] as string[], eq: [] as unknown[][], limit: [] as number[], rpc: [] as unknown[][] };
  const builder: Record<string, unknown> = {};
  builder.select = (c: string) => { calls.select.push(c); return builder; };
  builder.eq = (...a: unknown[]) => { calls.eq.push(a); return builder; };
  builder.limit = (n: number) => { calls.limit.push(n); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(state.rows);
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a: unknown) => { calls.rpc.push([n, a]); return Promise.resolve(state.rpc); });
  return { state, calls, from, rpc };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { getUnbilledWorkOrders, listWorkOrderBilling } from './workOrderBilling';

const ROW = {
  work_order_id: 'wo-1', project_id: 'p1', status: 'Issued', currency: 'USD', order_net: 500000, invoiced: '330000.00',
  pending: 90000, paid: 100000, remaining: 80000, figures_complete: true, line_count: 6, unpaid_count: 3,
};

beforeEach(() => {
  h.state.rows = { data: null, error: null };
  h.state.rpc = { data: null, error: null };
  for (const k of Object.keys(h.calls) as Array<keyof typeof h.calls>) h.calls[k].length = 0;
});

describe('work-order billing DAL (OD-BILL-1)', () => {
  it("AC-BWO-004 reads the project's rows from the view, numbers normalised", async () => {
    h.state.rows = { data: [ROW], error: null };
    expect(await listWorkOrderBilling('p1')).toEqual([{
      workOrderId: 'wo-1', projectId: 'p1', status: 'Issued', currency: 'USD', orderNet: 500000, invoiced: 330000,
      pending: 90000, paid: 100000, remaining: 80000, figuresComplete: true, lineCount: 6, unpaidCount: 3,
    }]);
    expect(h.calls.from).toEqual(['work_order_billing']);
    expect(h.calls.eq).toEqual([['project_id', 'p1']]);
    expect(h.calls.limit).toEqual([501]);
  });
  it('NFR-BWO-005 a missing figure is an error, never a zero', async () => {
    h.state.rows = { data: [{ ...ROW, remaining: null }], error: null };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: 'malformed-billing' });
  });
  it('NFR-BWO-003 more than 500 work orders is refused rather than silently truncated', async () => {
    h.state.rows = { data: Array.from({ length: 501 }, (_, i) => ({ ...ROW, work_order_id: `wo-${i}` })), error: null };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: 'too-many-work-orders' });
  });
  it('a read error keeps its code', async () => {
    h.state.rows = { data: null, error: { message: 'denied', code: '42501' } };
    await expect(listWorkOrderBilling('p1')).rejects.toMatchObject({ code: '42501' });
  });
  it('AC-UNB-005 parses the dashboard document', async () => {
    h.state.rpc = { data: {
      totals: [{ currency: 'USD', remaining: 1300, count: 2 }], incomplete_count: 1,
      rows: [{ work_order_id: 'wo-2', wo_number: null, title: 'Fit-out', project_id: 'p2', project_name: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, days_since_closed: 3 }],
    }, error: null };
    expect(await getUnbilledWorkOrders(8)).toEqual({
      totals: [{ currency: 'USD', remaining: 1300, count: 2 }], incompleteCount: 1,
      rows: [{ workOrderId: 'wo-2', woNumber: null, title: 'Fit-out', projectId: 'p2', projectName: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, daysSinceClosed: 3 }],
    });
    expect(h.calls.rpc).toEqual([['get_unbilled_work_orders', { p_limit: 8 }]]);
  });
  it('AC-UNB-005 a malformed dashboard document is an error', async () => {
    h.state.rpc = { data: { totals: 'x', incomplete_count: 0, rows: [] }, error: null };
    await expect(getUnbilledWorkOrders(8)).rejects.toMatchObject({ code: 'malformed-billing' });
  });
});
