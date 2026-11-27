import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Client requisitions DAL + repository (#2585, migrations 1086/1087). The database decides every rule; this module carries
 * requests, never sends org_id, a cost or a project, keeps each refusal's Postgres code and maps refusals to stable keys.
 */
const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], rpc: [] as Array<[string, Record<string, unknown>]>, eq: [] as unknown[], in: [] as unknown[], limit: [] as unknown[], range: [] as unknown[] };
  const next = () => queue.shift() ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const k of ['select', 'order'] as const) builder[k] = () => builder;
  for (const k of ['eq', 'in', 'limit', 'range'] as const) builder[k] = (...a: unknown[]) => { calls[k].push(a); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(next());
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn((n: string, a: Record<string, unknown>) => { calls.rpc.push([n, a]); return builder; });
  return { from, rpc, calls, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

vi.mock('./stockSiteWork', () => ({ uploadStockDocumentFile: vi.fn().mockResolvedValue(undefined) }));
import { uploadStockDocumentFile } from './stockSiteWork';
import * as dal from './clientRequisitions';
import { clientRequisitionRepository } from '@/src/lib/repositories/clientRequisitions';

beforeEach(() => {
  h.from.mockClear(); h.rpc.mockClear();
  h.calls.from.length = 0; h.calls.rpc.length = 0; h.calls.eq.length = 0; h.calls.in.length = 0; h.calls.limit.length = 0; h.calls.range.length = 0;
  h.queue.length = 0;
});

describe('writes carry the call, never org_id, project or cost', () => {
  it('FR-CSR-001/005 create sends the work order, lines and the client request id only', async () => {
    h.queue.push({ data: 'r1', error: null });
    const id = await clientRequisitionRepository.create({ workOrderId: 'wo1', clientReference: 'CL-1' },
      [{ stockItemId: 'i1', takeoffQuantity: '100', requestedQuantity: '90', workOrderLineId: 'a1' }, { stockItemId: 'i2', takeoffQuantity: '5' }], 'req-1');
    expect(id).toBe('r1');
    expect(h.calls.rpc[0]).toEqual(['csr_create', {
      p_header: { work_order_id: 'wo1', client_reference: 'CL-1' },
      p_lines: [{ stock_item_id: 'i1', takeoff_quantity: 100, requested_quantity: 90, work_order_line_id: 'a1' }, { stock_item_id: 'i2', takeoff_quantity: 5 }],
      p_client_request_id: 'req-1',
    }]);
    expect(JSON.stringify(h.calls.rpc[0])).not.toMatch(/org_id|project_id|unit_cost|cost/);
  });

  it('FR-CSR-010 a pickup sends the line, quantity and location; the RPC takes no cost', async () => {
    h.queue.push({ data: 'p1', error: null });
    await clientRequisitionRepository.recordPickup('l1', { quantity: '50', warehouseId: 'w1', collector: 'Budi', paperReference: 'DN-1' }, 'c1');
    const [name, args] = h.calls.rpc[0];
    expect(name).toBe('csr_record_pickup');
    expect(args).toMatchObject({ p_line_id: 'l1', p_quantity: 50, p_warehouse_id: 'w1', p_collector: 'Budi', p_paper_reference: 'DN-1', p_client_request_id: 'c1' });
    expect(Object.keys(args).some((k) => /cost/i.test(k))).toBe(false);
  });

  it('W1 a slip photo is attached to the receipt the pickup posted, as its own attachment', async () => {
    h.queue.push({ data: [{ org_id: 'o1', stock_document_id: 'doc1' }], error: null });
    const file = new File(['x'], 'slip.jpg', { type: 'image/jpeg' });
    await clientRequisitionRepository.attachPickupSlip('p1', file);
    expect(h.calls.from).toEqual(['client_requisition_pickups']);
    expect(h.calls.eq[0]).toEqual(['id', 'p1']);
    expect(uploadStockDocumentFile).toHaveBeenCalledWith('o1', 'doc1', file, 'Delivery slip');
  });

  it('FR-CSR-006/008 reservation and release go through their own RPCs', async () => {
    h.queue.push({ data: 'e1', error: null }, { data: 'e2', error: null });
    await clientRequisitionRepository.recordReservation('l1', { quantity: '60', clientReference: 'CL-1' });
    await clientRequisitionRepository.recordRelease('l1', { quantity: '10', reason: 'client took it back' });
    expect(h.calls.rpc.map((c) => c[0])).toEqual(['csr_record_reservation', 'csr_record_release']);
  });

  it('a refusal keeps its Postgres code and message', async () => {
    h.queue.push({ data: null, error: { message: 'CSR_OVER_COLLECT: only 5 is still to collect', code: 'P0001' } });
    await expect(clientRequisitionRepository.recordPickup('l1', { quantity: '9', warehouseId: 'w1' })).rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('CSR_OVER_COLLECT') });
  });
});

describe('getWorkOrderClientMaterial', () => {
  it('AC-CSR-003 a work order with no requisition reads the requisitions only and returns empty lists', async () => {
    h.queue.push({ data: [], error: null });
    const r = await clientRequisitionRepository.forWorkOrder('wo1');
    expect(r).toEqual({ requisitions: [], lines: [], events: [], pickups: [] });
    expect(h.calls.from).toEqual(['client_requisitions']);
    expect(h.calls.rpc).toEqual([]);
  });

  it('FR-CSR-018 maps requisitions, rollup lines, events and pickups; quantities stay strings', async () => {
    h.queue.push({ data: [{ id: 'r1', number: 'CSR-1', work_order_id: 'wo1', project_id: 'p1', client_reference: 'CL', status: 'open', created_by: 'u1', created_at: 't', sent_at: 't2' }], error: null });
    h.queue.push({ data: [{ line_id: 'l1', requisition_id: 'r1', requisition_number: 'CSR-1', requisition_status: 'open', stock_item_id: 'i1', item_code: 'CEM', item_name: 'Cement', unit_code: 'BAG', takeoff_quantity: 100, requested_quantity: 100 }], error: null });
    h.queue.push({ data: [{ id: 'e1', requisition_id: 'r1', line_id: 'l1', kind: 'reserved', quantity: 60, client_reference: 'CL-1', event_on: '2026-11-20', reason: null, recorded_by: 'u2', created_at: 't' }], error: null });
    h.queue.push({ data: [{ id: 'p1', requisition_id: 'r1', line_id: 'l1', quantity: 50, picked_up_on: '2026-11-20', collector: null, paper_reference: null, warehouse_id: 'w1', stock_document_id: 'd1' }], error: null });
    h.queue.push({ data: [{ id: 'l1', work_order_line_id: 'contract-line' }], error: null });
    const r = await dal.getWorkOrderClientMaterial('wo1');
    expect(r.lines[0].workOrderLineId).toBe('contract-line');
    expect(r.requisitions[0]).toMatchObject({ id: 'r1', status: 'open', clientReference: 'CL' });
    expect(r.lines[0]).toMatchObject({ id: 'l1', itemName: 'Cement', unit: 'BAG', takeoffQuantity: '100', requestedQuantity: '100', requisitionStatus: 'open' });
    expect(r.events[0]).toMatchObject({ kind: 'reserved', quantity: '60', lineId: 'l1' });
    expect(r.pickups[0]).toMatchObject({ quantity: '50', stockDocumentId: 'd1' });
    expect(h.calls.rpc[0]).toEqual(['csr_work_order_rollup', { p_work_order_id: 'wo1' }]);
    expect(h.calls.range).toEqual(Array.from({ length: 5 }, () => [0, 999]));
  });
});
