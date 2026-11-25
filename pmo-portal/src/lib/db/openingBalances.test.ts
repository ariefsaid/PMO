import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc } }));

import { listOpeningBalances } from './openingBalances';

const base = { as_of: '2026-11-20', loaded_at: '2026-11-21T08:00:00Z', loaded_by_name: 'Dewi', currency: 'USD', note: null, sub_label: null };
beforeEach(() => rpc.mockReset());

describe('listOpeningBalances (AC-OBS-002)', () => {
  it('maps a stock opening and a work-order opening, with numeric text read as numbers', async () => {
    rpc.mockResolvedValue({ error: null, data: [
      { ...base, id: 's', kind: 'stock', label: 'CEN', line_count: 1, stock_quantity: '10', stock_value: '50.00', certified_value: null, claimed_value: null, lines: [{ item_code: 'B', item_name: 'Bolt', quantity: 10, value: '50' }] },
      { ...base, id: 'w', kind: 'work_order', label: 'WO-1', line_count: 1, stock_quantity: null, stock_value: null, certified_value: 4000, claimed_value: 3000, lines: [{ item_code: 'L1', description: 'One', certified_quantity: 4, claimed_quantity: 3, claimed_amount: 3000 }] },
    ] });
    const rows = await listOpeningBalances();
    expect(rows[0]).toMatchObject({ kind: 'stock', quantity: 10, value: 50, loadedBy: 'Dewi', lines: [{ itemCode: 'B', value: 50 }] });
    expect(rows[1]).toMatchObject({ kind: 'work_order', certifiedValue: 4000, claimedValue: 3000 });
    expect(rpc).toHaveBeenCalledWith('opening_balances_overview');
  });

  it('a missing figure is an error, never a plausible zero', async () => {
    rpc.mockResolvedValue({ error: null, data: [{ ...base, id: 's', kind: 'stock', label: 'CEN', line_count: 1, stock_quantity: null, stock_value: '1', lines: [] }] });
    await expect(listOpeningBalances()).rejects.toThrow(/stock quantity/);
  });

  it('a refusal keeps its code', async () => {
    rpc.mockResolvedValue({ error: { message: 'only Admin and Finance read the opening balances', code: '42501' }, data: null });
    await expect(listOpeningBalances()).rejects.toMatchObject({ code: '42501' });
  });
});
