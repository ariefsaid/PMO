import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const next = async () => queue.shift() ?? { data: null, error: null };
  const rpc = vi.fn(next);
  const limit = vi.fn(next);
  const maybeSingle = vi.fn(next);
  const eq = vi.fn(() => ({ is: () => ({ limit }) }));
  return { queue, rpc, limit, maybeSingle, eq };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => ({ select: () => ({ eq: h.eq, maybeSingle: h.maybeSingle }) }) } }));

import { getAheadAlertRoles, getOpenMaterialAlertCount, getWaitingMaterialAlerts, setAheadAlertRoles } from './workOrderMaterialAlerts';

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
    expect(h.rpc).toHaveBeenCalledWith('my_open_material_alerts');
  });

  it('AC-MVP-013 the listed roles read as keys (none when no row) and the save sends the keys', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getAheadAlertRoles()).toEqual([]);
    h.queue.push({ data: { ahead_alert_roles: ['site_supervisor'] }, error: null });
    expect(await getAheadAlertRoles()).toEqual(['site_supervisor']);
    h.queue.push({ data: ['site_supervisor'], error: null });
    expect(await setAheadAlertRoles(['site_supervisor'])).toEqual(['site_supervisor']);
    expect(h.rpc).toHaveBeenCalledWith('set_work_order_ahead_alert_roles', { p_roles: ['site_supervisor'] });
  });

  it('AC-MVP-013 a refused save throws', async () => {
    h.queue.push({ data: null, error: { message: 'STK_ALERT_ROLES_ADMIN_ONLY: only an Admin', code: '42501' } });
    await expect(setAheadAlertRoles([])).rejects.toBeTruthy();
  });
});
