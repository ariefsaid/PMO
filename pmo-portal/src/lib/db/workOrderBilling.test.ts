import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  // `rows` answers every table not named in `tables` (the original single-read tests); `tables` answers by table name.
  const state = {
    rows: { data: null as unknown, error: null as unknown },
    tables: {} as Record<string, { data: unknown; error: unknown }>,
    rpc: { data: null as unknown, error: null as unknown },
  };
  const calls = {
    from: [] as string[], select: [] as string[], eq: [] as unknown[][], in: [] as unknown[][], is: [] as unknown[][],
    limit: [] as number[], rpc: [] as unknown[][],
  };
  const from = vi.fn((t: string) => {
    calls.from.push(t);
    const builder: Record<string, unknown> = {};
    builder.select = (c: string) => { calls.select.push(c); return builder; };
    builder.eq = (...a: unknown[]) => { calls.eq.push(a); return builder; };
    builder.in = (...a: unknown[]) => { calls.in.push([t, ...a]); return builder; };
    builder.is = (...a: unknown[]) => { calls.is.push([t, ...a]); return builder; };
    builder.limit = (n: number) => { calls.limit.push(n); return builder; };
    builder.then = (resolve: (v: unknown) => unknown) => resolve(state.tables[t] ?? state.rows);
    return builder;
  });
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
  h.state.tables = {};
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
      rows: [{ workOrderId: 'wo-2', woNumber: null, title: 'Fit-out', projectId: 'p2', projectName: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, daysSinceClosed: 3, clientPoNumber: null }],
      incomplete: [],
    });
    expect(h.calls.rpc).toEqual([['get_unbilled_work_orders', { p_limit: 8 }]]);
  });
  it('AC-UNB-005 a malformed dashboard document is an error', async () => {
    h.state.rpc = { data: { totals: 'x', incomplete_count: 0, rows: [] }, error: null };
    await expect(getUnbilledWorkOrders(8)).rejects.toMatchObject({ code: 'malformed-billing' });
  });

  it("AC-BWO-004 a work order that can't be totalled names each invoice that stops it, and why", async () => {
    h.state.tables = {
      work_order_billing: { data: [{ ...ROW, figures_complete: false }, { ...ROW, work_order_id: 'wo-2' }], error: null },
      work_order_billing_lines: { data: [
        { record_id: 'si-9', work_order_id: 'wo-1', billed: null, currency: 'USD' },
        { record_id: 'si-7', work_order_id: 'wo-1', billed: 1000, currency: 'EUR' },
        { record_id: 'si-1', work_order_id: 'wo-1', billed: 1000, currency: 'USD' },
        { record_id: 'pc-1', work_order_id: 'wo-1', billed: null, currency: 'USD' },
      ], error: null },
      sales_invoices: { data: [{ id: 'si-9', si_number: 'ACC-SINV-9' }, { id: 'si-7', si_number: 'ACC-SINV-7' }], error: null },
    };
    const [broken, fine] = await listWorkOrderBilling('p1');
    expect(broken.problems).toEqual([
      { recordId: 'si-9', number: 'ACC-SINV-9', cause: 'no-amount', currency: 'USD' },
      { recordId: 'si-7', number: 'ACC-SINV-7', cause: 'other-currency', currency: 'EUR' },
      { recordId: 'pc-1', number: null, cause: 'no-amount', currency: 'USD' },
    ]);
    expect(fine.problems).toBeUndefined();
    // Only the work orders that cannot be totalled are looked into.
    expect(h.calls.in).toContainEqual(['work_order_billing_lines', 'work_order_id', ['wo-1']]);
  });
  it('AC-BWO-004 when the causes cannot be read, the row still says it cannot be totalled — the billing read does not fail', async () => {
    h.state.tables = {
      work_order_billing: { data: [{ ...ROW, figures_complete: false }], error: null },
      work_order_billing_lines: { data: null, error: { message: 'denied', code: '42501' } },
    };
    const [row] = await listWorkOrderBilling('p1');
    expect(row.figuresComplete).toBe(false);
    expect(row.problems).toBeUndefined();
  });
  it('a project whose work orders all total reads nothing more', async () => {
    h.state.rows = { data: [ROW], error: null };
    await listWorkOrderBilling('p1');
    expect(h.calls.from).toEqual(['work_order_billing']);
  });
  it("AC-UNB-005 the dashboard lists the work orders it could not total, on live projects, and each row's client PO", async () => {
    h.state.rpc = { data: {
      totals: [{ currency: 'USD', remaining: 300, count: 1 }], incomplete_count: 2,
      rows: [{ work_order_id: 'wo-2', wo_number: 'WO-2', title: 'Fit-out', project_id: 'p2', project_name: 'Annex', status: 'Closed', currency: 'USD', remaining: 300, days_since_closed: 3 }],
    }, error: null };
    h.state.tables = {
      work_order_billing: { data: [
        { work_order_id: 'wo-8', wo_number: 'WO-8', title: 'Cabling', project_id: 'p2' },
        { work_order_id: 'wo-9', wo_number: 'WO-9', title: 'Old job', project_id: 'p-archived' },
      ], error: null },
      projects: { data: [{ id: 'p2', name: 'Annex' }], error: null },
      work_orders: { data: [{ id: 'wo-2', client_po_number: 'PO-123' }], error: null },
    };
    const doc = await getUnbilledWorkOrders(8);
    expect(doc.incomplete).toEqual([{ workOrderId: 'wo-8', woNumber: 'WO-8', title: 'Cabling', projectId: 'p2', projectName: 'Annex' }]);
    expect(doc.rows[0].clientPoNumber).toBe('PO-123');
    expect(h.calls.eq).toContainEqual(['figures_complete', false]);
    expect(h.calls.is).toContainEqual(['projects', 'archived_at', null]);
  });
  it('AC-UNB-005 with everything totalled the dashboard asks for no list', async () => {
    h.state.rpc = { data: { totals: [], incomplete_count: 0, rows: [] }, error: null };
    const doc = await getUnbilledWorkOrders(8);
    expect(doc.incomplete).toEqual([]);
    expect(h.calls.from).toEqual([]);
  });
});
