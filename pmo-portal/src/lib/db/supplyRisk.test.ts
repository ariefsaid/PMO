import { beforeEach, describe, expect, it, vi } from 'vitest';

// Chainable PostgREST builder mock (the agentRuns.test.ts reference pattern, extended with the
// filtered chain supplyRisk's warning read needs).
const h = vi.hoisted(() => {
  type Res = { data: unknown; error: unknown };
  const results: Res[] = [];
  const calls: Record<string, unknown[]> = {
    from: [], rpc: [], select: [], insert: [], update: [], delete: [], eq: [], is: [], in: [], not: [], order: [], limit: [], range: [], single: [], maybeSingle: [],
  };
  const next = (): Res => (results.length ? (results.shift() as Res) : { data: null, error: null });
  const builder: Record<string, unknown> = {};
  const rec = (name: keyof typeof calls) => (...args: unknown[]) => {
    calls[name].push(args.length <= 1 ? args[0] : args);
    return builder;
  };
  for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'is', 'in', 'not', 'order', 'limit', 'range'] as const) builder[m] = rec(m);
  builder.maybeSingle = () => { calls.maybeSingle.push(true); return Promise.resolve(next()); };
  builder.single = () => { calls.single.push(true); return Promise.resolve(next()); };
  builder.then = (res: (v: Res) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  const rpc = vi.fn((fn: string, args?: unknown) => { calls.rpc.push(args ? [fn, args] : fn); return Promise.resolve(next()); });
  return { from, rpc, calls, results, push: (r: Res) => results.push(r) };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  getSupplyRiskSetterName, getSupplyRiskSuggestion, listExposedWorkOrders,
  listSupplyRiskWarnings, setSupplyRiskStatus,
} from './supplyRisk';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) h.calls[k].length = 0;
  h.results.length = 0;
});

describe('getSupplyRiskSuggestion', () => {
  const suggestion = {
    basis: 'erp', suggested_status: 'at_risk', no_aging_data: false, unknown_count: '2',
    oldest_age_days: null,
    currencies: [{ currency: 'IDR', unpaid_amount: 100, over60_amount: 40, invoice_count: null, oldest_age_days: 75 }],
  };

  it('maps the database suggestion to the app shape, normalising every figure', async () => {
    h.push({ data: suggestion, error: null });
    await expect(getSupplyRiskSuggestion('c1')).resolves.toEqual({
      basis: 'erp', suggestedStatus: 'at_risk', noAgingData: false, unknownCount: 2, oldestAgeDays: null,
      currencies: [{ currency: 'IDR', unpaidAmount: 100, over60Amount: 40, invoiceCount: null, oldestAgeDays: 75 }],
    });
    expect(h.calls.rpc).toEqual([['vendor_supply_risk_suggestion', { p_company_id: 'c1' }]]);
  });

  it('a company that is not a readable Vendor resolves to null, not an error', async () => {
    h.push({ data: null, error: null });
    await expect(getSupplyRiskSuggestion('c1')).resolves.toBeNull();
  });
});

describe('listExposedWorkOrders', () => {
  it('maps the exposure rows; a null order total stays null', async () => {
    h.push({
      data: [
        { kind: 'work_order', work_order_id: 'wo1', wo_number: 'WO-1', title: 'T', wo_status: 'Issued', project_id: 'p1', project_name: 'P', open_order_count: 2, order_total: null, currency: 'IDR' },
        { kind: 'project', work_order_id: null, wo_number: null, title: null, wo_status: null, project_id: 'p1', project_name: 'P', open_order_count: 0, order_total: 500, currency: null },
      ],
      error: null,
    });
    await expect(listExposedWorkOrders('c1')).resolves.toEqual([
      { kind: 'work_order', workOrderId: 'wo1', woNumber: 'WO-1', title: 'T', woStatus: 'Issued', projectId: 'p1', projectName: 'P', openOrderCount: 2, orderTotal: null, currency: 'IDR' },
      { kind: 'project', workOrderId: null, woNumber: null, title: null, woStatus: null, projectId: 'p1', projectName: 'P', openOrderCount: 0, orderTotal: 500, currency: null },
    ]);
  });
});

describe('setSupplyRiskStatus', () => {
  it('changes status only through the governed function; a null reason is sent as absent', async () => {
    h.push({ data: null, error: null });
    await setSupplyRiskStatus('c1', 'at_risk', 'repeated late delivery');
    expect(h.calls.rpc).toEqual([['set_vendor_supply_status', { p_company_id: 'c1', p_status: 'at_risk', p_reason: 'repeated late delivery' }]]);

    h.push({ data: null, error: null });
    await setSupplyRiskStatus('c1', 'active', null);
    expect(h.calls.rpc.at(-1)).toEqual(['set_vendor_supply_status', { p_company_id: 'c1', p_status: 'active' }]);
  });

  it('a refusal by the guard keeps its code', async () => {
    h.push({ data: null, error: { message: 'refused', code: 'P0001' } });
    await expect(setSupplyRiskStatus('c1', 'at_risk', null)).rejects.toMatchObject({ code: 'P0001' });
  });
});

describe('listSupplyRiskWarnings', () => {
  const row = (wo: string, supplier: { id: string; name: string; supply_risk_status: string } | null) => ({
    work_order_id: wo,
    procurements: supplier ? { vendor_id: supplier.id, companies: supplier } : null,
  });

  it('needs a scope: neither project nor work order means no read at all', async () => {
    await expect(listSupplyRiskWarnings({})).resolves.toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });

  it('reads only open orders from flagged suppliers and dedupes a supplier seen on several rows of one order', async () => {
    const vendor = { id: 'v1', name: 'Late Co', supply_risk_status: 'at_risk' };
    h.push({ data: [row('wo1', vendor), row('wo1', vendor), row('wo2', vendor), row('wo3', null)], error: null });
    await expect(listSupplyRiskWarnings({ projectId: 'p1' })).resolves.toEqual([
      { workOrderId: 'wo1', supplierId: 'v1', supplierName: 'Late Co', status: 'at_risk' },
      { workOrderId: 'wo2', supplierId: 'v1', supplierName: 'Late Co', status: 'at_risk' },
    ]);
    expect(h.calls.from).toEqual(['purchase_orders']);
    expect(h.calls.in).toContainEqual(['status', ['Issued', 'Acknowledged']]);
    expect(h.calls.in).toContainEqual(['procurements.companies.supply_risk_status', ['at_risk', 'inactive']]);
    expect(h.calls.eq).toContainEqual(['procurements.project_id', 'p1']);
    expect(h.calls.limit).toContainEqual(500);
  });

  it('scopes by work order when asked instead of the project', async () => {
    const vendor = { id: 'v1', name: 'Late Co', supply_risk_status: 'inactive' };
    h.push({ data: [row('wo1', vendor)], error: null });
    await listSupplyRiskWarnings({ workOrderId: 'wo1' });
    expect(h.calls.eq).toContainEqual(['work_order_id', 'wo1']);
    expect(JSON.stringify(h.calls)).not.toContain('procurements.project_id');
  });
});

describe('getSupplyRiskSetterName', () => {
  it('reads the profile full name; an unreadable profile is null, not an error', async () => {
    h.push({ data: { full_name: 'Dewi' }, error: null });
    await expect(getSupplyRiskSetterName('u1')).resolves.toBe('Dewi');

    h.push({ data: null, error: null });
    await expect(getSupplyRiskSetterName('u1')).resolves.toBeNull();
    expect(h.calls.from.at(-1)).toBe('profiles');
  });
});
