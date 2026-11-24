import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], select: [] as unknown[], limit: [] as unknown[], update: [] as unknown[], eq: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const chain = (name: 'select' | 'limit' | 'update' | 'eq') => (...args: unknown[]) => {
    calls[name].push(args.length === 1 ? args[0] : args);
    return builder;
  };
  builder.select = chain('select');
  builder.limit = chain('limit');
  builder.update = chain('update');
  builder.eq = chain('eq');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: null, error: null });
  return {
    rpc: vi.fn(),
    from: vi.fn((table: string) => { calls.from.push(table); return builder; }),
    calls,
    queue,
  };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import {
  getWorkInHand,
  getWorkInHandMonthlyCapacity,
  monthlyCapacityIssue,
  parseWorkInHand,
  setWorkInHandMonthlyCapacity,
} from './workInHand';

const CONTRACT = {
  project_id: 'p1', name: 'P1', code: null, pmo_project_number: 'PRJ-1', status: 'Ongoing Project', currency: 'IDR',
  contract_net: '1200000.00', incomplete: false, foreign_currency_invoice_count: 0, unpriced_invoice_count: 0,
  billed_to_date: '340000.00', first_billing_month: '2026-09-01',
  window_months: [{ month: '2026-09-01', billed: '100000.00' }],
};
const WORK_ORDER = {
  work_order_id: 'w1', project_id: 'p1', wo_number: 'WO-1', title: 'Survey', status: 'Issued', currency: 'IDR', order_net: '500000.00',
  incomplete: false, foreign_currency_invoice_count: 0, unpriced_invoice_count: 0, billed_to_date: '0.00', first_billing_month: null, window_months: [],
};
const PAYLOAD = {
  as_of: '2026-12-10', timezone: 'Asia/Jakarta', org_currency: 'IDR', window_from: '2026-06-01', window_to: '2026-11-01',
  truncated: false, undated_invoice_count: 2,
  no_value: [{ project_id: 'p5', name: 'P5', code: null, pmo_project_number: null, status: 'Ongoing Project', currency: 'IDR' }],
  contracts: [CONTRACT], work_orders: [WORK_ORDER],
};

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockClear();
  h.queue.length = 0;
  for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
    (h.calls[k] as unknown[]).length = 0;
  }
});

describe('getWorkInHand', () => {
  it('calls the read with the as-of date (or null) and sends no org_id', async () => {
    h.rpc.mockResolvedValue({ data: PAYLOAD, error: null });
    await getWorkInHand('2026-12-10');
    await getWorkInHand();
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'get_work_in_hand', { p_as_of: '2026-12-10' });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'get_work_in_hand', {});
  });

  it('maps contracts and work orders to input rows, with the work order under its contract', async () => {
    h.rpc.mockResolvedValue({ data: PAYLOAD, error: null });
    const r = await getWorkInHand('2026-12-10');
    expect(r).toMatchObject({ asOf: '2026-12-10', orgCurrency: 'IDR', truncated: false, undatedInvoiceCount: 2, noValueContractCount: 1 });
    expect(r.rows[0]).toMatchObject({ kind: 'contract', id: 'p1', parentId: null, value: '1200000.00', billedToDate: '340000.00', code: 'PRJ-1' });
    expect(r.rows[1]).toMatchObject({ kind: 'workOrder', id: 'w1', parentId: 'p1', value: '500000.00', code: 'WO-1', name: 'Survey' });
    expect(r.noValue[0]).toMatchObject({ projectId: 'p5', name: 'P5' });
  });

  it('classifies a refusal with its code and never returns a plausible empty result', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(getWorkInHand()).rejects.toMatchObject({ code: '42501' });
  });

  it('a malformed figure is an error, never 0', () => {
    const bad = (patch: object) => ({ ...PAYLOAD, contracts: [{ ...CONTRACT, ...patch }] });
    expect(() => parseWorkInHand(bad({ contract_net: 'abc' }))).toThrow();
    expect(() => parseWorkInHand(bad({ billed_to_date: null }))).toThrow();           // complete row must carry billed
    expect(() => parseWorkInHand(bad({ billed_to_date: 100 }))).toThrow();            // numbers, not text: not scale-two text
    expect(() => parseWorkInHand(bad({ window_months: [{ month: '2026-09-01', billed: '' }] }))).toThrow();
    expect(() => parseWorkInHand({ ...PAYLOAD, truncated: 'no' })).toThrow();
    expect(() => parseWorkInHand({ ...PAYLOAD, contracts: 'x' })).toThrow();
    expect(() => parseWorkInHand(null)).toThrow();
  });

  it('an incomplete row may carry no figures', () => {
    const r = parseWorkInHand({
      ...PAYLOAD,
      contracts: [{ ...CONTRACT, incomplete: true, foreign_currency_invoice_count: 1, billed_to_date: null, first_billing_month: null, window_months: [] }],
    });
    expect(r.rows[0]).toMatchObject({ incomplete: true, billedToDate: null, foreignCurrencyInvoiceCount: 1 });
  });

  it('parses monthly_capacity when set and rejects malformed values', () => {
    expect(parseWorkInHand({ ...PAYLOAD, monthly_capacity: '2500000.00' }).monthlyCapacity).toBe('2500000.00');
    expect(parseWorkInHand({ ...PAYLOAD, monthly_capacity: null }).monthlyCapacity).toBeNull();
    expect(() => parseWorkInHand({ ...PAYLOAD, monthly_capacity: 'bad' })).toThrow();
  });
});

describe('monthly work capacity setting (M8)', () => {
  it('validates positive amounts with at most two decimal places', () => {
    expect(monthlyCapacityIssue(null)).toBeNull();
    expect(monthlyCapacityIssue(2500000.5)).toBeNull();
    expect(monthlyCapacityIssue(0)).toBe('positive');
    expect(monthlyCapacityIssue(-10)).toBe('positive');
    expect(monthlyCapacityIssue(Number.NaN)).toBe('positive');
    expect(monthlyCapacityIssue(12.345)).toBe('precision');
  });

  it('reads work_in_hand_monthly_capacity under RLS without sending org_id', async () => {
    h.queue.push({ data: [{ work_in_hand_monthly_capacity: 2500000 }], error: null });
    await expect(getWorkInHandMonthlyCapacity()).resolves.toBe(2500000);
    expect(h.calls.from).toEqual(['organizations']);
    expect(h.calls.select).toEqual(['work_in_hand_monthly_capacity']);

    h.queue.push({ data: [{ work_in_hand_monthly_capacity: null }], error: null });
    await expect(getWorkInHandMonthlyCapacity()).resolves.toBeNull();
  });

  it('writes capacity for the single readable org and refuses invalid values, multi-org, or silent RLS no-op', async () => {
    await expect(setWorkInHandMonthlyCapacity(0)).rejects.toMatchObject({ code: '22023' });
    await expect(setWorkInHandMonthlyCapacity(12.345)).rejects.toMatchObject({ code: '22023' });
    expect(h.from).not.toHaveBeenCalled();

    h.queue.push({ data: [{ id: 'org-1' }, { id: 'org-2' }], error: null });
    await expect(setWorkInHandMonthlyCapacity(1000)).rejects.toMatchObject({ code: '22023' });

    h.queue.push({ data: [{ id: 'org-1' }], error: null }, { data: [], error: null });
    await expect(setWorkInHandMonthlyCapacity(1000)).rejects.toBeTruthy();

    h.calls.update.length = 0;
    h.queue.push({ data: [{ id: 'org-1' }], error: null }, { data: [{ id: 'org-1' }], error: null });
    await setWorkInHandMonthlyCapacity(2500000);
    expect(h.calls.update).toEqual([{ work_in_hand_monthly_capacity: 2500000 }]);
  });
});
