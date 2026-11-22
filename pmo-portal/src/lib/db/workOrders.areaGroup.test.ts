import { describe, it, expect, vi, beforeEach } from 'vitest';

/** #2668: area and group travel only through set_work_order_area_group (the table's column grants name neither). */
const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  insertBody: vi.fn(),
  updateBody: vi.fn(),
}));
vi.mock('@/src/lib/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  chain.insert = (b: unknown) => { h.insertBody(b); return chain; };
  chain.update = (b: unknown) => { h.updateBody(b); return chain; };
  chain.eq = () => chain;
  chain.select = () => chain;
  chain.single = () => Promise.resolve({ data: { id: 'wo-new' }, error: null });
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: 'wo-1' }], error: null });
  return { supabase: { from: () => chain, rpc: h.rpc } };
});
import { createWorkOrder, updateWorkOrder } from './workOrders';

const base = { title: 'T', clientPoNumber: null, description: null, orderDate: null, startDate: null, endDate: null };
beforeEach(() => { h.rpc.mockReset().mockResolvedValue({ data: null, error: null }); h.insertBody.mockReset(); h.updateBody.mockReset(); });

describe('work-order area and group writes', () => {
  it('make no extra call and send no area column when the caller carries neither', async () => {
    await updateWorkOrder('wo-1', base);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.updateBody.mock.calls[0][0]).not.toHaveProperty('area_id');
  });

  it('update calls the RPC for only the column the caller carries', async () => {
    await updateWorkOrder('wo-1', { ...base, areaId: 'a1' });
    expect(h.updateBody.mock.calls[0][0]).not.toHaveProperty('area_id');
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_area_group', { p_work_order: 'wo-1', p_area: 'a1', p_group: undefined, p_set_area: true, p_set_group: false });
  });

  it('create calls the RPC with the new id after the insert, and a clearing null is a set', async () => {
    await createWorkOrder('p1', { ...base, orderValue: 1, taxTreatment: 'exclusive', taxAmount: 0, groupId: null });
    expect(h.insertBody.mock.calls[0][0]).not.toHaveProperty('group_id');
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_area_group', { p_work_order: 'wo-new', p_area: undefined, p_group: undefined, p_set_area: false, p_set_group: true });
  });
});
