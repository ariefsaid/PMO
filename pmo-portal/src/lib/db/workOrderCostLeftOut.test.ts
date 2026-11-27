import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: h.rpc },
}));

import {
  getWorkOrderCostLeftOut,
  parseWorkOrderCostLeftOut,
  summarizeLeftOut,
  type WorkOrderCostLeftOut,
} from './workOrderCostLeftOut';

beforeEach(() => {
  h.rpc.mockReset();
});

describe('parseWorkOrderCostLeftOut', () => {
  it('parses a valid payload with priced and count-only kinds', () => {
    const parsed = parseWorkOrderCostLeftOut({
      workOrderId: 'wo-1',
      pricesHidden: false,
      labourCostEnabled: false,
      stockIssueCostEnabled: false,
      items: [
        { kind: 'unpaid_bill', count: 2, currency: 'IDR', total: '1500000.00' },
        { kind: 'unapproved_labour', count: 3, currency: null, total: null },
      ],
    });
    expect(parsed.items).toEqual([
      { kind: 'unpaid_bill', count: 2, currency: 'IDR', total: '1500000.00' },
      { kind: 'unapproved_labour', count: 3, currency: null, total: null },
    ]);
  });

  it('rejects malformed rows, unknown kinds, zero counts, and mismatched currency/total', () => {
    expect(() => parseWorkOrderCostLeftOut(null)).toThrow(AppError);
    expect(() => parseWorkOrderCostLeftOut({ workOrderId: 'wo-1', pricesHidden: false, labourCostEnabled: false, stockIssueCostEnabled: false, items: [{ kind: 'bogus', count: 1, currency: null, total: null }] })).toThrow(AppError);
    expect(() => parseWorkOrderCostLeftOut({ workOrderId: 'wo-1', pricesHidden: false, labourCostEnabled: false, stockIssueCostEnabled: false, items: [{ kind: 'unpaid_bill', count: 0, currency: null, total: null }] })).toThrow(AppError);
    expect(() => parseWorkOrderCostLeftOut({ workOrderId: 'wo-1', pricesHidden: false, labourCostEnabled: false, stockIssueCostEnabled: false, items: [{ kind: 'unpaid_bill', count: 1, currency: 'IDR', total: null }] })).toThrow(AppError);
    expect(() => parseWorkOrderCostLeftOut({ workOrderId: 'wo-1', pricesHidden: false, labourCostEnabled: false, stockIssueCostEnabled: false, items: [{ kind: 'unpaid_bill', count: 1, currency: 'IDR', total: 'NaN' }] })).toThrow(AppError);
  });
});

describe('summarizeLeftOut', () => {
  const base: Omit<WorkOrderCostLeftOut, 'items'> = {
    workOrderId: 'wo-1',
    pricesHidden: false,
    labourCostEnabled: true,
    stockIssueCostEnabled: true,
  };

  it('combines totals when every kind has a total in the same currency', () => {
    const s = summarizeLeftOut({
      ...base,
      items: [
        { kind: 'unpaid_bill', count: 2, currency: 'IDR', total: '1000000.00' },
        { kind: 'uncounted_stock', count: 1, currency: 'IDR', total: '500000.50' },
      ],
    });
    expect(s).toEqual({
      totalCount: 3,
      combinedTotal: { amount: '1500000.50', currency: 'IDR' },
    });
  });

  it('omits combinedTotal when any kind is count-only', () => {
    const s = summarizeLeftOut({
      ...base,
      items: [
        { kind: 'unpaid_bill', count: 1, currency: 'IDR', total: '1000000.00' },
        { kind: 'unapproved_labour', count: 2, currency: null, total: null },
      ],
    });
    expect(s).toEqual({ totalCount: 3, combinedTotal: null });
  });

  it('omits combinedTotal when currencies differ or prices are hidden', () => {
    expect(summarizeLeftOut({
      ...base,
      items: [
        { kind: 'unpaid_bill', count: 1, currency: 'IDR', total: '1000.00' },
        { kind: 'purchase_order', count: 1, currency: 'USD', total: '100.00' },
      ],
    }).combinedTotal).toBeNull();

    expect(summarizeLeftOut({
      ...base,
      pricesHidden: true,
      items: [{ kind: 'unpaid_bill', count: 2, currency: null, total: null }],
    })).toEqual({ totalCount: 2, combinedTotal: null });
  });
});

describe('getWorkOrderCostLeftOut', () => {
  it('calls work_order_cost_left_out in one RPC and returns parsed data', async () => {
    h.rpc.mockResolvedValue({
      data: {
        workOrderId: 'wo-1',
        pricesHidden: false,
        labourCostEnabled: false,
        stockIssueCostEnabled: false,
        items: [{ kind: 'unpaid_bill', count: 1, currency: 'IDR', total: '250000.00' }],
      },
      error: null,
    });
    const res = await getWorkOrderCostLeftOut('wo-1');
    expect(h.rpc).toHaveBeenCalledWith('work_order_cost_left_out', { p_work_order_id: 'wo-1' });
    expect(res?.items).toHaveLength(1);
  });

  it('returns null on 42501 or P0002 refusals and throws AppError on unexpected errors', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'not authorized', code: '42501' } });
    expect(await getWorkOrderCostLeftOut('wo-1')).toBeNull();

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'work order not found', code: 'P0002' } });
    expect(await getWorkOrderCostLeftOut('wo-1')).toBeNull();

    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'boom', code: 'XX000' } });
    await expect(getWorkOrderCostLeftOut('wo-1')).rejects.toBeInstanceOf(AppError);
  });
});
