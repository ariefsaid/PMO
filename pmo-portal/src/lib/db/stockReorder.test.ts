import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppError } from '@/src/lib/appError';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { rpc, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));

import { getBelowReorder, getReorderSuggestion, setReorderLevel } from './stockReorder';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

describe('stockReorder DAL', () => {
  it('AC-STK-025 the suggestion maps level, quantity and the inputs, all as strings', async () => {
    h.queue.push({ data: {
      status: 'ok', suggestion: { reorder_level: '42', reorder_quantity: '60' },
      inputs: { window_days: 90, usage: '180', avg_daily_usage: '2.0000', lead_time_days: 14, safety_days: 7, order_cycle_days: 30, usage_movements: 6, history_days: 91 },
      current: { reorder_level: '40', reorder_quantity: null },
    }, error: null });
    const s = await getReorderSuggestion('w', 'i');
    expect(h.rpc).toHaveBeenCalledWith('get_reorder_suggestions', { p_warehouse_id: 'w', p_item_id: 'i' });
    expect(s.status).toBe('ok');
    expect(s.suggestion).toEqual({ reorderLevel: '42', reorderQuantity: '60' });
    expect(s.inputs).toMatchObject({ usage: '180', windowDays: 90, leadTimeDays: 14, usageMovements: 6 });
    expect(s.current).toEqual({ reorderLevel: '40', reorderQuantity: null });
  });

  it('AC-STK-026 not enough history maps to no suggestion and carries the thresholds', async () => {
    h.queue.push({ data: { status: 'insufficient_history', suggestion: null, inputs: { history_days: 27, usage_movements: 3, min_history_days: 28, min_movements: 3 }, current: null }, error: null });
    const s = await getReorderSuggestion('w', 'i');
    expect(s.status).toBe('insufficient_history');
    expect(s.suggestion).toBeNull();
    expect(s.current).toBeNull();
    expect(s.inputs).toMatchObject({ historyDays: 27, minHistoryDays: 28, minMovements: 3 });
  });

  it('FR-STK-054 the worklist maps each row; an empty answer is an empty list', async () => {
    h.queue.push({ data: [{ item_id: 'i', item_code: 'CEM', item_name: 'Cement', unit_code: 'bag', warehouse_id: 'w', warehouse_code: 'CEN', qty_on_hand: '27', reorder_level: '1000', reorder_quantity: null }], error: null });
    expect(await getBelowReorder()).toEqual([
      { itemId: 'i', itemCode: 'CEM', itemName: 'Cement', unitCode: 'bag', warehouseId: 'w', warehouseCode: 'CEN', qtyOnHand: '27', reorderLevel: '1000', reorderQuantity: null },
    ]);
    expect(h.rpc).toHaveBeenCalledWith('get_stock_below_reorder');
    h.queue.push({ data: null, error: null });
    expect(await getBelowReorder()).toEqual([]);
  });

  it('AC-STK-027 setting sends the exact arguments; clearing sends a null level', async () => {
    await setReorderLevel({ warehouseId: 'w', itemId: 'i', level: '42', quantity: '60' });
    expect(h.rpc).toHaveBeenLastCalledWith('set_stock_reorder_level', { p_warehouse_id: 'w', p_item_id: 'i', p_level: '42', p_quantity: '60' });
    await setReorderLevel({ warehouseId: 'w', itemId: 'i', level: null });
    expect(h.rpc).toHaveBeenLastCalledWith('set_stock_reorder_level', { p_warehouse_id: 'w', p_item_id: 'i', p_level: null, p_quantity: null });
  });

  it('every call throws on a server error', async () => {
    const err = { message: 'STK_NOT_FOUND: item or warehouse is not in your organisation', code: 'P0001' };
    h.queue.push({ data: null, error: err });
    await expect(getReorderSuggestion('w', 'i')).rejects.toBeInstanceOf(AppError);
    h.queue.push({ data: null, error: err });
    await expect(getBelowReorder()).rejects.toBeInstanceOf(AppError);
    h.queue.push({ data: null, error: err });
    await expect(setReorderLevel({ warehouseId: 'w', itemId: 'i', level: '1' })).rejects.toBeInstanceOf(AppError);
  });

  it('a suggestion with no figures never resolves to a made-up one', async () => {
    h.queue.push({ data: null, error: null });
    await expect(getReorderSuggestion('w', 'i')).rejects.toBeInstanceOf(AppError);
  });

  it('NFR-STK-007 the reorder DAL never turns a quantity into a JS number', () => {
    expect(readFileSync('src/lib/db/stockReorder.ts', 'utf8')).not.toMatch(/parseFloat|Number\(/);
  });
});
