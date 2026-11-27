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

import { getReturnable, getWoTransfersEnabled, getWorkOrderTransfer, postWorkOrderTransfer, setWoTransfersEnabled } from './stockWorkOrderTransfer';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); });

describe('stockWorkOrderTransfer DAL (AC-WOT-016)', () => {
  it('AC-WOT-016 post maps the form to the RPC: location, both work orders, trimmed note, decimal-string lines, the work item only when known, one request id', async () => {
    h.queue.push({ data: 'wot-1', error: null });
    const id = await postWorkOrderTransfer({
      warehouseId: 'w', fromWorkOrderId: 'a', toWorkOrderId: 'b', note: ' left over ', disciplineId: null,
      lines: [{ itemId: 'i1', quantity: '2.5', boqItemId: 'e1' }, { itemId: 'i2', quantity: '1', boqItemId: null }],
    }, 'req-1');
    expect(id).toBe('wot-1');
    expect(h.rpc).toHaveBeenCalledWith('post_stock_wo_transfer', {
      p_header: { warehouse_id: 'w', from_work_order_id: 'a', to_work_order_id: 'b', note: 'left over', discipline_id: null },
      p_lines: [{ item_id: 'i1', quantity: '2.5', boq_item_id: 'e1' }, { item_id: 'i2', quantity: '1' }],
      p_client_request_id: 'req-1',
    });
  });
  it('AC-WOT-004 a refusal reaches the caller as a code-bearing error', async () => {
    h.queue.push({ data: null, error: { message: 'STK_WOT_EXCEEDS: the work order holds 3 of this item, requested 4', code: 'P0001' } });
    await expect(postWorkOrderTransfer({ warehouseId: 'w', fromWorkOrderId: 'a', toWorkOrderId: 'b', note: '', disciplineId: null, lines: [] }, 'r')).rejects.toMatchObject({ message: expect.stringContaining('STK_WOT_EXCEEDS') });
  });
  it('AC-WOT-009 the returnable rows map to the names the screen uses; value is null for roles that do not see cost', async () => {
    h.queue.push({ data: [{ item_id: 'i1', item_code: 'PIPE', item_name: 'Pipe', unit_code: 'pc', quantity: '3', boq_item_id: 'e1' }], error: null });
    expect(await getReturnable('a')).toEqual([{ itemId: 'i1', itemCode: 'PIPE', itemName: 'Pipe', unitCode: 'pc', quantity: '3', boqItemId: 'e1', value: null }]);
    expect(h.rpc).toHaveBeenCalledWith('get_work_order_returnable', { p_work_order_id: 'a' });
  });
  it('AC-WOT-019 the setting reads off unless the organisation turned it on, and the Admin RPC takes a boolean', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getWoTransfersEnabled()).toBe(false);
    h.queue.push({ data: [{ stock_wo_transfers: true }], error: null });
    expect(await getWoTransfersEnabled()).toBe(true);
    await setWoTransfersEnabled(true);
    expect(h.rpc).toHaveBeenCalledWith('set_stock_wo_transfers', { p_on: true });
  });
  it('AC-WOT-001 a transfer reads with both of its halves; an unknown id reads null', async () => {
    h.queue.push({ data: { id: 't', number: 'WOT-1', project_id: 'p', warehouse_id: 'w', from_work_order_id: 'a', to_work_order_id: 'b', note: null, occurred_on: '2026-11-21', created_by: 'u', created_at: 'x' }, error: null });
    h.queue.push({ data: [{ id: 'd1', number: 'ISS-1', kind: 'issue', status: 'Posted', work_order_id: 'b' }, { id: 'd2', number: 'RTN-1', kind: 'return', status: 'Posted', work_order_id: 'a' }], error: null });
    const t = await getWorkOrderTransfer('t');
    expect(t?.number).toBe('WOT-1');
    expect(t?.halves.map((x) => x.kind)).toEqual(['issue', 'return']);
    h.queue.push({ data: null, error: null });
    expect(await getWorkOrderTransfer('nope')).toBeNull();
  });
});
