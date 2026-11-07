import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getFinanceHubFigures, parseFinanceHubFigures } from './financeHub';

const body = {
  pack: {
    as_at: '2026-11-01',
    unbilled: [{ currency: 'IDR', cents: -20_007_344 }, { currency: 'USD', cents: 0 }],
    contract_rows: 3,
    invoiced_basis_rows: 1,
  },
  statement: { unpublished: false, period_start: '2026-10-01', net_profit: 250.5, currency: 'IDR' },
};

beforeEach(() => h.rpc.mockReset());

describe('db/financeHub (#1988)', () => {
  it('reads the figures from the narrow RPC', async () => {
    h.rpc.mockResolvedValue({ data: body, error: null });
    const figures = await getFinanceHubFigures();
    expect(h.rpc).toHaveBeenCalledWith('get_finance_hub_figures');
    expect(figures.pack).toEqual({
      asAt: '2026-11-01',
      unbilled: [{ currency: 'IDR', cents: -20_007_344 }, { currency: 'USD', cents: 0 }],
      contractRows: 3,
      invoicedBasisRows: 1,
    });
    expect(figures.statement).toEqual({ unpublished: false, periodStart: '2026-10-01', netProfit: 250.5, currency: 'IDR' });
  });

  it('surfaces the RPC error instead of inventing figures', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'not permitted', code: '42501' } });
    await expect(getFinanceHubFigures()).rejects.toMatchObject({ code: '42501' });
  });

  it('a malformed body is an error, never a zero figure', () => {
    expect(() => parseFinanceHubFigures(null)).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ pack: null, statement: body.statement })).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ ...body, pack: { ...body.pack, as_at: 'Nov 2026' } })).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ ...body, pack: { ...body.pack, unbilled: [{ currency: 'IDR' }] } })).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ ...body, pack: { ...body.pack, contract_rows: 1.5 } })).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ ...body, statement: { ...body.statement, unpublished: 'no' } })).toThrow(/malformed/);
    expect(() => parseFinanceHubFigures({ ...body, statement: { ...body.statement, net_profit: '250.50' } })).toThrow(/malformed/);
  });

  it('accepts the unpublished statement state the hub renders as the integrations pointer', () => {
    const figures = parseFinanceHubFigures({
      pack: body.pack,
      statement: { unpublished: true, period_start: null, net_profit: null, currency: null },
    });
    expect(figures.statement).toEqual({ unpublished: true, periodStart: null, netProfit: null, currency: null });
  });
});
