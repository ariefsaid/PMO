import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const maybeSingle = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, order: () => query, eq: () => query, limit: () => query, maybeSingle, then: (r: (v: unknown) => void) => r(queue.shift() ?? { data: [], error: null }) });
  return { rpc, queue, query };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => h.query } }));

import { getFreeReserved, getRequestBorrowing, getReservationSettings, releaseReservation, reserveStock, setReservationSettings } from './stockReservations';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

describe('stockReservations DAL', () => {
  it('AC-RSV-001 reserve maps the form to the RPC: ids, decimal-string quantity, trimmed note, empty expiry as null, one request id', async () => {
    h.queue.push({ data: 'res-1', error: null });
    const id = await reserveStock({ workOrderId: 'wo', itemId: 'i', warehouseId: 'w', quantity: '2.5', expiresOn: '', note: ' slab ' }, 'req-1');
    expect(id).toBe('res-1');
    expect(h.rpc).toHaveBeenCalledWith('reserve_stock', { p_work_order_id: 'wo', p_item_id: 'i', p_warehouse_id: 'w', p_quantity: '2.5', p_expires_on: null, p_note: 'slab', p_client_request_id: 'req-1' });
  });

  it('AC-RSV-006 release sends the reservation, the quantity (null releases the rest) and the reason', async () => {
    await releaseReservation('r', null, 'plan changed');
    expect(h.rpc).toHaveBeenCalledWith('release_reservation', { p_reservation_id: 'r', p_quantity: null, p_reason: 'plan changed' });
  });

  it('AC-RSV-001 maps free, reserved, short-by and the reserving work orders as decimal strings', async () => {
    h.queue.push({ data: [{ item_id: 'i', warehouse_id: 'w', qty_on_hand: '10', reserved_qty: '4', free_qty: '6', short_by: '0', reservations: [{ reservation_id: 'r', work_order_id: 'wo', work_order_number: 'WO-1', work_order_title: 'Slab', remaining_qty: '4', expires_on: null }] }], error: null });
    const rows = await getFreeReserved('w', 'i');
    expect(h.rpc).toHaveBeenCalledWith('get_stock_free_reserved', { p_warehouse_id: 'w', p_item_id: 'i' });
    expect(rows).toEqual([{ itemId: 'i', warehouseId: 'w', qtyOnHand: '10', reservedQty: '4', freeQty: '6', shortBy: '0', reservations: [{ reservationId: 'r', workOrderId: 'wo', workOrderNumber: 'WO-1', workOrderTitle: 'Slab', remainingQty: '4', expiresOn: null }] }]);
  });

  it('AC-RSV-007 settings read as off when absent, and write the mode, role and label', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getReservationSettings()).toEqual({ enabled: false, borrowMode: 'approve', borrowRole: null, borrowLabel: null });
    h.queue.push({ data: [{ stock_reservations: true, reservation_borrow_mode: 'warn', reservation_borrow_role: 'Executive', reservation_borrow_label: 'Borrowing' }], error: null });
    expect(await getReservationSettings()).toEqual({ enabled: true, borrowMode: 'warn', borrowRole: 'Executive', borrowLabel: 'Borrowing' });
    await setReservationSettings({ enabled: true, borrowMode: 'approve', borrowRole: 'Executive', borrowLabel: ' Borrowing ' });
    expect(h.rpc).toHaveBeenCalledWith('set_stock_reservations', { p_on: true, p_borrow_mode: 'approve', p_borrow_role: 'Executive', p_borrow_label: 'Borrowing' });
  });

  it('AC-RSV-009 a request that was never checked reads as null; a checked one maps its borrowed quantities', async () => {
    h.queue.push({ data: { borrowing: false, reservation_checked: false }, error: null });
    expect(await getRequestBorrowing('q')).toBeNull();
    h.queue.push({ data: { borrowing: true, reservation_checked: true }, error: null });
    h.queue.push({ data: [{ item_id: 'i', reserved_use_qty: '2.000', borrowed_qty: '3.000' }], error: null });
    expect(await getRequestBorrowing('q')).toEqual({ borrowing: true, lines: [{ itemId: 'i', reservedUseQty: '2.000', borrowedQty: '3.000' }] });
  });

  it('AC-RSV-002 a refusal from the database surfaces with its code in the message', async () => {
    h.queue.push({ data: null, error: { message: 'RSV_EXCEEDS_FREE: only 6 is free at this location', code: 'P0001' } });
    await expect(reserveStock({ workOrderId: 'wo', itemId: 'i', warehouseId: 'w', quantity: '7', expiresOn: null, note: '' }, 'r')).rejects.toMatchObject({ message: expect.stringContaining('RSV_EXCEEDS_FREE') });
  });
});
