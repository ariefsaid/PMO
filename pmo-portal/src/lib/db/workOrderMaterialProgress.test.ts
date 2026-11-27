import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const maybeSingle = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { queue, rpc, maybeSingle };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => ({ select: () => ({ maybeSingle: h.maybeSingle }) }) } }));

import { getWorkOrderIssueThreshold, getWorkOrderMaterialProgress, setWorkOrderIssueThreshold } from './workOrderMaterialProgress';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.maybeSingle.mockClear(); });

describe('workOrderMaterialProgress DAL', () => {
  it('AC-MIP-001 an unset threshold maps to no comparison', async () => {
    h.queue.push({ data: { threshold_pct: null, progress_pct: null, items: [] }, error: null });
    expect(await getWorkOrderMaterialProgress('wo1')).toEqual({ thresholdPct: null, progressPct: null, items: [] });
    expect(h.rpc).toHaveBeenCalledWith('get_work_order_material_vs_progress', { p_work_order_id: 'wo1' });
  });

  it('AC-MIP-004 a warning row keeps its quantities as strings and its shares as numbers', async () => {
    h.queue.push({ data: { threshold_pct: 30, progress_pct: 25, items: [
      { item_id: 'i1', item_code: 'ROD', item_name: 'Welding rod', unit_code: 'KG', planned_qty: '100', issued_qty: '60', issued_pct: 60, gap_pp: 35, unplanned: false, warn: true },
      { item_id: 'i2', item_code: 'PIPE', item_name: 'Pipe', unit_code: 'KG', planned_qty: '0', issued_qty: '5', issued_pct: null, gap_pp: null, unplanned: true, warn: false },
    ] }, error: null });
    const r = await getWorkOrderMaterialProgress('wo1');
    expect(r.thresholdPct).toBe(30);
    expect(r.progressPct).toBe(25);
    expect(r.items[0]).toMatchObject({ plannedQty: '100', issuedQty: '60', issuedPct: 60, gapPp: 35, warn: true, unplanned: false });
    expect(r.items[1]).toMatchObject({ issuedPct: null, gapPp: null, unplanned: true, warn: false });
  });

  it('a failed read throws instead of reading as "nothing warns"', async () => {
    h.queue.push({ data: null, error: { message: 'boom', code: 'P0001' } });
    await expect(getWorkOrderMaterialProgress('wo1')).rejects.toBeTruthy();
  });

  it('AC-MIP-015 the save sends the figure, and null clears it', async () => {
    h.queue.push({ data: 20, error: null });
    expect(await setWorkOrderIssueThreshold(20)).toBe(20);
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_issue_threshold', { p_threshold_pct: 20 });
    h.queue.push({ data: null, error: null });
    expect(await setWorkOrderIssueThreshold(null)).toBeNull();
  });

  it('AC-MIP-015 a refused save (not an Admin) throws', async () => {
    h.queue.push({ data: null, error: { message: 'only an Admin', code: '42501' } });
    await expect(setWorkOrderIssueThreshold(10)).rejects.toBeTruthy();
  });

  it('reads the current threshold, or null when there is no row', async () => {
    h.queue.push({ data: { issue_progress_threshold_pct: '12.50' }, error: null });
    expect(await getWorkOrderIssueThreshold()).toBe(12.5);
    h.queue.push({ data: null, error: null });
    expect(await getWorkOrderIssueThreshold()).toBeNull();
  });

  it('rejects malformed or non-finite progress figures with a field-named refusal instead of leaking NaN (#2983)', async () => {
    const validItem = {
      item_id: 'i1', item_code: 'ROD', item_name: 'Welding rod', unit_code: 'KG',
      planned_qty: '100', issued_qty: '60', issued_pct: 60, gap_pp: 35, unplanned: false, warn: true,
    };
    h.queue.push({ data: { threshold_pct: 30, progress_pct: 25, items: [{ ...validItem, issued_pct: 'bad' }] }, error: null });
    await expect(getWorkOrderMaterialProgress('wo1')).rejects.toMatchObject({
      code: 'material-progress-malformed',
      message: expect.stringMatching(/items\[0\]\.issued_pct/),
    });

    h.queue.push({ data: { threshold_pct: 30, progress_pct: 'NaN', items: [] }, error: null });
    await expect(getWorkOrderMaterialProgress('wo1')).rejects.toMatchObject({
      code: 'material-progress-malformed',
      message: expect.stringMatching(/progress_pct/),
    });

    h.queue.push({ data: null, error: null });
    await expect(getWorkOrderMaterialProgress('wo1')).rejects.toMatchObject({
      code: 'material-progress-malformed',
      message: expect.stringMatching(/response/),
    });
  });
});
