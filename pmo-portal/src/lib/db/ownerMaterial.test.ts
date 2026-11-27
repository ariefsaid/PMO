import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from } }));
import { listOrderNumbers, getMaterialConfig, listMaterialLines, listMaterialRollup, listSectionStages, setSectionReconciliation } from './ownerMaterial';

beforeEach(() => { h.rpc.mockReset(); });

describe('AC-008 owner material DAL', () => {
  it('sends the exact lines arguments (no org) and keeps decimal strings and the page total', async () => {
    h.rpc.mockResolvedValue({ data: [{ plan_id: 'p1', section_id: 's1', item_id: 'i1', item_code: '001', item_name: 'Pipe', unit: 'm', category_code: null, owner_cost_code: 'C1',
      planned: '100.000', requested: '40.500', set_aside: '30.000', received: '10.000', issued: '6.000', returned: '1.000', transfer_in: '0.000', transfer_out: '2.000', owner_return: '0.000', closing: '3.000',
      requested_pct: '40.5', set_aside_pct: null, received_pct: '10', issued_pct: '60', closing_pct: '30', as_of: '2026-11-01', evidence: { request_reference: 'REQ-7 on 3 Oct, 9 Oct' }, total_count: 120 }], error: null });
    const res = await listMaterialLines('wo1', 's1', 2);
    expect(h.rpc).toHaveBeenCalledWith('om_material_lines', { p_work_order_id: 'wo1', p_section_id: 's1', p_page: 2, p_page_size: 50 });
    expect(res.total).toBe(120);
    expect(res.rows[0]).toMatchObject({ itemCode: '001', planned: '100.000', closing: '3.000', setAsidePct: null, receivedPct: '10', ownerCostCode: 'C1', asOf: '2026-11-01', evidence: { request_reference: 'REQ-7 on 3 Oct, 9 Oct' } });
  });

  it('reads the rollup for one project in one call', async () => {
    h.rpc.mockResolvedValue({ data: [{ work_order_id: 'w1', number: 'WO-1', title: 'T', section_count: 3, requested_pct: '50', set_aside_pct: null, received_pct: '25.5', issued_pct: '0', closing_pct: null,
      reconciliation_step: 'Checked', reconciliation_pct: '40', unallocated_movement_count: 2, total_count: 1 }], error: null });
    const res = await listMaterialRollup('pr1', 1);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith('om_material_rollup', { p_project_id: 'pr1', p_page: 1, p_page_size: 50 });
    expect(res.rows[0]).toMatchObject({ workOrderId: 'w1', sectionCount: 3, receivedPct: '25.5', reconciliationStep: 'Checked', unallocatedMovementCount: 2 });
  });

  it('an empty read has a zero total, and a database error keeps its code', async () => {
    h.rpc.mockResolvedValueOnce({ data: [], error: null });
    expect((await listMaterialRollup('pr1', 1)).total).toBe(0);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(listMaterialLines('wo1', null, 1)).rejects.toMatchObject({ code: '42501' });
  });

  it('records a reconciliation step with the exact arguments', async () => {
    h.rpc.mockResolvedValue({ data: {}, error: null });
    await setSectionReconciliation('s1', 'st2', 'agreed with owner');
    expect(h.rpc).toHaveBeenCalledWith('om_material_set_reconciliation', { p_section_id: 's1', p_step_id: 'st2', p_reason: 'agreed with owner' });
  });

  it('orders the steps by position', async () => {
    h.rpc.mockResolvedValue({ data: { categories: [], owner_warehouses: [], steps: [{ id: 'b', name: 'Checked', position: 2, percentage: '40' }, { id: 'a', name: 'Prepared', position: 1, percentage: '20' }] }, error: null });
    expect((await getMaterialConfig()).steps.map((s) => s.name)).toEqual(['Prepared', 'Checked']);
  });

  it('reads each location of a work order with its own percentages and step in one call', async () => {
    h.rpc.mockResolvedValue({ data: [{ section_id: 's1', section_code: 'L1', section_name: 'North', owner_cost_code: 'C1', line_count: 4, requested_pct: '50', set_aside_pct: null, received_pct: '25.5',
      issued_pct: '0', closing_pct: null, reconciliation_step_id: 'st1', reconciliation_step: 'Checked', reconciliation_pct: '40', as_of: '2026-11-01' }], error: null });
    const res = await listSectionStages('wo1');
    expect(h.rpc).toHaveBeenCalledWith('om_material_section_rollup', { p_work_order_id: 'wo1' });
    expect(res[0]).toMatchObject({ sectionId: 's1', name: 'North', lineCount: 4, setAsidePct: null, receivedPct: '25.5', stepId: 'st1', step: 'Checked', stepPct: '40', asOf: '2026-11-01' });
  });

  it('reads the categories with their names, so a screen can show the name', async () => {
    h.rpc.mockResolvedValue({ data: { categories: [{ id: 'c1', code: 'PIPE', name: 'Piping' }], steps: [] }, error: null });
    expect((await getMaterialConfig()).categories).toEqual([{ id: 'c1', code: 'PIPE', name: 'Piping' }]);
  });

  it("reads the owner's order number and ours for the given work orders, and nothing for none", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'w1', wo_number: 'WO-1', client_po_number: 'PO-77' }], error: null });
    const inFn = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ in: inFn }));
    h.from.mockReturnValue({ select });
    expect(await listOrderNumbers(['w1'])).toEqual([{ workOrderId: 'w1', clientPoNumber: 'PO-77', woNumber: 'WO-1' }]);
    expect(h.from).toHaveBeenCalledWith('work_orders');
    expect(inFn).toHaveBeenCalledWith('id', ['w1']);
    h.from.mockClear();
    expect(await listOrderNumbers([])).toEqual([]);
    expect(h.from).not.toHaveBeenCalled();
  });
});
