import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const next = async () => queue.shift() ?? { data: null, error: null };
  const rpc = vi.fn(next);
  const limit = vi.fn(next);
  const maybeSingle = vi.fn(next);
  const eq = vi.fn(() => ({ eq: () => ({ is: () => ({ limit }) }) }));
  return { queue, rpc, limit, maybeSingle, eq };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => ({ select: () => ({ eq: h.eq, maybeSingle: h.maybeSingle }) }) } }));

import { getOpenMaterialAlertCount, getWaitingMaterialAlerts } from './workOrderMaterialAlerts';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.limit.mockClear(); h.maybeSingle.mockClear(); h.eq.mockClear(); });

describe('workOrderMaterialAlerts DAL', () => {
  it('AC-MVP-011 the badge count is the number of open alert rows on the work order', async () => {
    h.queue.push({ data: [{ item_id: 'i1' }, { item_id: 'i2' }], error: null });
    expect(await getOpenMaterialAlertCount('wo1')).toEqual({ workOrderId: 'wo1', itemCount: 2 });
    expect(h.eq).toHaveBeenCalledWith('work_order_id', 'wo1');
  });

  it('AC-MVP-011 no rows reads as zero; a failed read throws rather than reading as zero', async () => {
    h.queue.push({ data: [], error: null });
    expect((await getOpenMaterialAlertCount('wo1')).itemCount).toBe(0);
    h.queue.push({ data: null, error: { message: 'boom', code: 'P0001' } });
    await expect(getOpenMaterialAlertCount('wo1')).rejects.toBeTruthy();
  });

  it('AC-MVP-012 the needs-you rows map to the work order, its project, label and item count', async () => {
    h.queue.push({ data: [{ work_order_id: 'w', project_id: 'p', wo_label: 'WO-1', item_count: 3 }], error: null });
    expect(await getWaitingMaterialAlerts()).toEqual([{ workOrderId: 'w', projectId: 'p', workOrderLabel: 'WO-1', itemCount: 3 }]);
    expect(h.rpc).toHaveBeenCalledWith('my_open_ahead_alerts');
  });
});
