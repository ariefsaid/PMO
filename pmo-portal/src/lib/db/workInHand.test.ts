import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getWorkInHand, parseWorkInHand } from './workInHand';

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

beforeEach(() => { h.rpc.mockReset(); });

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
});
