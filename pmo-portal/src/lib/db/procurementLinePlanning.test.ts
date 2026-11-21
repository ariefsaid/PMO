/** AC-PLP-008 — the line planning data seam validates its input and maps errors; it never defaults a missing value. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import {
  getPurchaseLinePlanning, setPurchaseLinePlanning, savePurchaseLineCategory, archivePurchaseLineCategory,
  setProcurementLinePlanning, listPurchaseLineCategories,
} from './procurementLinePlanning';

const ITEM = '26960000-0000-4000-8000-000000000020';
const CAT = '26960000-0000-4000-8000-000000000030';
beforeEach(() => { h.rpc.mockReset(); h.from.mockReset(); });

describe('AC-PLP-008 line planning data seam', () => {
  it('reads and writes the setting through its RPCs', async () => {
    h.rpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await getPurchaseLinePlanning()).toBe(false);
    h.rpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await setPurchaseLinePlanning(true)).toBe(true);
    expect(h.rpc).toHaveBeenLastCalledWith('set_purchase_line_planning', { p_enabled: true });
  });

  it('sets and clears a line through set_procurement_line_planning', async () => {
    h.rpc.mockResolvedValue({ data: true, error: null });
    await setProcurementLinePlanning(ITEM, CAT, '2026-12-31');
    expect(h.rpc).toHaveBeenLastCalledWith('set_procurement_line_planning', { p_item: ITEM, p_category: CAT, p_needed_by: '2026-12-31' });
    await setProcurementLinePlanning(ITEM, null, null);
    expect(h.rpc).toHaveBeenLastCalledWith('set_procurement_line_planning', { p_item: ITEM, p_category: null, p_needed_by: null });
  });

  it('rejects a bad id or date before any call', async () => {
    await expect(setProcurementLinePlanning('nope', null, null)).rejects.toThrow('Invalid line id');
    await expect(setProcurementLinePlanning(ITEM, 'nope', null)).rejects.toThrow('Invalid category id');
    await expect(setProcurementLinePlanning(ITEM, null, '31/12/2026')).rejects.toThrow('YYYY-MM-DD');
    await expect(archivePurchaseLineCategory('x')).rejects.toThrow('Invalid category id');
    await expect(savePurchaseLineCategory('x', 'A')).rejects.toThrow('Invalid category id');
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it('surfaces a refusal with its message and code', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Line planning is not permitted', code: '42501' } });
    await expect(setProcurementLinePlanning(ITEM, null, null)).rejects.toMatchObject({ message: 'Line planning is not permitted' });
  });

  it('does not invent an id when the save returns nothing', async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(savePurchaseLineCategory(null, 'Site')).rejects.toThrow('not saved');
  });

  it('lists categories, leaving retired ones out for a picker', async () => {
    const is = vi.fn().mockResolvedValue({ data: [{ id: CAT, name: 'Site' }], error: null });
    const limit = vi.fn().mockReturnValue({ is });
    const order2 = vi.fn().mockReturnValue({ limit });
    const order1 = vi.fn().mockReturnValue({ order: order2 });
    h.from.mockReturnValue({ select: vi.fn().mockReturnValue({ order: order1 }) });
    expect(await listPurchaseLineCategories({ activeOnly: true })).toEqual([{ id: CAT, name: 'Site' }]);
    expect(is).toHaveBeenCalledWith('archived_at', null);
  });
});
