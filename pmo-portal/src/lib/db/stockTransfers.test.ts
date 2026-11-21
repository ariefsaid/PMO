import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const upload = vi.fn(async () => ({ error: null }));
  const maybeSingle = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const signed = vi.fn(async () => ({ data: { signedUrl: 'https://signed/handover' }, error: null }));
  const query: Record<string, unknown> = {};
  const fromCalls: string[] = [];
  const from = vi.fn((t: string) => { fromCalls.push(t); return query; });
  Object.assign(query, { select: () => query, order: () => query, eq: () => query, limit: () => query, update: () => query, maybeSingle, then: (r: (v: unknown) => void) => r(queue.shift() ?? { data: [], error: null }) });
  return { rpc, queue, upload, query, maybeSingle, signed, fromCalls, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: h.from, storage: { from: () => ({ upload: h.upload, createSignedUrl: h.signed }) } } }));

import { getMovementProofStatus, getTransferSettings, getStockTransfer, handoverPhotoUrl, listHandoverConfirmations, listStockTransfers, receiveStockTransfer, recallStockTransfer, recordStockHandover, resolveStockShortfall, sendStockTransfer, setItemQualityCheck, setProofTiming, setTagProofRule, setTransferMode, uploadHandoverPhoto } from './stockTransfers';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.upload.mockClear(); h.fromCalls.length = 0; });

describe('stockTransfers DAL', () => {
  it('AC-TST-023 send maps the form to the RPC: warehouses, optional receiver, lines as decimal strings, one request id', async () => {
    h.queue.push({ data: 'tr-1', error: null });
    const id = await sendStockTransfer({ fromWarehouseId: 'a', toWarehouseId: 'b', toUserId: null, note: ' hi ', lines: [{ itemId: 'i', quantity: '2.5' }] }, 'req-1');
    expect(id).toBe('tr-1');
    expect(h.rpc).toHaveBeenCalledWith('send_stock_transfer', { p_header: { warehouse_id: 'a', to_warehouse_id: 'b', to_user_id: '', note: 'hi' }, p_lines: [{ item_id: 'i', quantity: '2.5' }], p_client_request_id: 'req-1' });
  });
  it('AC-TST-024 receive sends counted, accepted, reason and quality per line, and the confirmation as is', async () => {
    await receiveStockTransfer('t', [{ lineId: 'l', counted: '8', accepted: '6', rejectReason: ' dented ', qualityResult: 'pass' }], null);
    expect(h.rpc).toHaveBeenCalledWith('receive_stock_transfer', { p_transfer: 't', p_lines: [{ line_id: 'l', counted: '8', accepted: '6', reject_reason: 'dented', quality_result: 'pass' }], p_confirmation: null });
  });
  it('AC-TST-011 a shortfall resolution with no reason sends null; a handover is recorded with its stage', async () => {
    await resolveStockShortfall('l', 'returned', '  ');
    expect(h.rpc).toHaveBeenCalledWith('resolve_stock_transfer_shortfall', { p_line: 'l', p_resolution: 'returned', p_reason: null });
    await recordStockHandover('t', { id: 'c', stage: 'receive', proof_type: 'paper', signer_kind: 'account', paper_photo_path: 'p' });
    expect(h.rpc).toHaveBeenCalledWith('record_stock_handover', { p_transfer: 't', p_confirmation: { id: 'c', stage: 'receive', proof_type: 'paper', signer_kind: 'account', paper_photo_path: 'p' } });
  });
  it('AC-TST-011 a database refusal reaches the caller as a code-bearing error', async () => {
    h.queue.push({ data: null, error: { message: 'STK_SELF_RECEIVE: the person who sent a transfer cannot be the one who receives it', code: 'P0001' } });
    await expect(receiveStockTransfer('t', [], null)).rejects.toMatchObject({ message: expect.stringContaining('STK_SELF_RECEIVE') });
  });
  it('AC-TST-020 the proof status rows map to the names the list uses', async () => {
    h.queue.push({ data: [{ movement_id: 'm', movement_number: 'TST-1', mode: 'two_step', transfer_status: 'Received', movement_date: '2026-11-20', from_warehouse_id: 'a', from_warehouse_name: 'Central', to_warehouse_id: 'b', to_warehouse_name: 'Site', tag_rules: ['paper'], required_proof: 'paper', has_paper: false, has_confirmation: false, proof_status: 'outstanding', missing: 'paper', proof_completed_at: null }], error: null });
    const [r] = await getMovementProofStatus({ status: 'outstanding' });
    expect(h.rpc).toHaveBeenCalledWith('get_stock_movement_proof_status', { p_status: 'outstanding', p_from: null, p_to: null });
    expect(r).toMatchObject({ movementId: 'm', number: 'TST-1', proofStatus: 'outstanding', missing: 'paper', fromWarehouseName: 'Central', toWarehouseName: 'Site', tagRules: ['paper'], proofCompletedAt: null });
  });
  it('AC-TST-026 the settings read defaults to one_step and before_posting when nothing is set', async () => {
    h.queue.push({ data: null, error: null });
    expect(await getTransferSettings()).toEqual({ mode: 'one_step', proofTiming: 'before_posting' });
    h.queue.push({ data: { stock_transfer_mode: 'two_step', stock_proof_timing: 'may_follow' }, error: null });
    expect(await getTransferSettings()).toEqual({ mode: 'two_step', proofTiming: 'may_follow' });
  });
  it('AC-TST-024 a transfer maps its lines in order with quantities as strings', async () => {
    h.queue.push({ data: { id: 't', number: 'TST-1', from_warehouse_id: 'a', to_warehouse_id: 'b', transit_warehouse_id: 'c', status: 'Sent', sent_by: 'u', sent_at: 'x',
      stock_transfer_lines: [{ id: 'l2', line_no: 2, item_id: 'i2', qty_sent: '3.000' }, { id: 'l1', line_no: 1, item_id: 'i1', qty_sent: '1.000' }] }, error: null });
    const t = await getStockTransfer('t');
    expect(t?.lines.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(t?.lines[0]).toMatchObject({ qtySent: '1.000', qtyCounted: null, shortResolution: null });
  });
  it('AC-TST-024 numeric columns that PostgREST returns as JSON numbers are mapped to strings', async () => {
    h.queue.push({ data: { id: 't', number: 'TST-1', from_warehouse_id: 'a', to_warehouse_id: 'b', transit_warehouse_id: 'c', status: 'Received', sent_by: 'u', sent_at: 'x',
      stock_transfer_lines: [{ id: 'l1', line_no: 1, item_id: 'i1', qty_sent: 10, qty_counted: 7, qty_accepted: 7, qty_rejected: 0 }] }, error: null });
    const t = await getStockTransfer('t');
    expect(t?.lines[0]).toMatchObject({ qtySent: '10', qtyCounted: '7', qtyAccepted: '7', qtyRejected: '0' });
  });
  it('AC-TST-015 a photo uploads to {org}/{transfer}/{confirmation}/ in the private handover bucket with a safe name', async () => {
    const path = await uploadHandoverPhoto('org', 't', 'c', 'goods', new File(['x'], 'my photo (1).jpg'));
    expect(path).toBe('org/t/c/goods-my_photo__1_.jpg');
    expect(h.upload).toHaveBeenCalledWith(path, expect.any(File));
  });
});

describe('stockTransfers reads and setup (#2685/#2690)', () => {
  it('listStockTransfers maps transfers with their lines in line order; the status filter applies only when asked', async () => {
    h.queue.push({
      data: [{
        id: 'tr1', number: 'ST-1', from_warehouse_id: 'w1', to_warehouse_id: 'w2', transit_warehouse_id: 'wt', work_order_id: null,
        to_user_id: null, note: 'n', status: 'Sent', sent_by: 'u1', sent_at: 't', received_by: null, received_at: null, cancel_reason: null,
        stock_transfer_lines: [
          { id: 'l2', line_no: 2, item_id: 'i2', qty_sent: 3, qty_counted: null, qty_accepted: null, qty_rejected: null, reject_reason: null, quality_result: null, short_resolution: null, short_reason: null },
          { id: 'l1', line_no: 1, item_id: 'i1', qty_sent: '2', qty_counted: 2, qty_accepted: 1, qty_rejected: 1, reject_reason: 'broken', quality_result: 'fail', short_resolution: 'returned', short_reason: 'r' },
        ],
      }],
      error: null,
    });
    const list = await listStockTransfers('Sent');
    expect(list).toHaveLength(1);
    expect(list[0].lines.map((l) => l.id)).toEqual(['l1', 'l2']); // line order, not arrival order
    expect(list[0].lines[0]).toMatchObject({ qtySent: '2', qtyCounted: '2', qtyAccepted: '1', qtyRejected: '1', rejectReason: 'broken', qualityResult: 'fail', shortResolution: 'returned', shortReason: 'r' });
    expect(list[0].lines[1]).toMatchObject({ qtySent: '3', qtyCounted: null, qtyAccepted: null });
  });

  it('getStockTransfer maps one transfer and null when absent', async () => {
    h.queue.push({ data: {
      id: 'tr1', number: 'ST-1', from_warehouse_id: 'w1', to_warehouse_id: 'w2', transit_warehouse_id: 'wt', work_order_id: 'wo1',
      to_user_id: 'u9', note: null, status: 'Received', sent_by: 'u1', sent_at: 't', received_by: 'u2', received_at: 't2', cancel_reason: null,
      stock_transfer_lines: [],
    }, error: null });
    const t = await getStockTransfer('tr1');
    expect(t).toMatchObject({ id: 'tr1', status: 'Received', workOrderId: 'wo1', toUserId: 'u9', receivedBy: 'u2', lines: [] });
    h.queue.push({ data: null, error: null });
    await expect(getStockTransfer('nope')).resolves.toBeNull();
  });

  it('listHandoverConfirmations maps the proof columns with nulls kept null', async () => {
    h.queue.push({
      data: [{ id: 'hc1', transfer_id: 'tr1', stage: 'send', proof_type: 'in_app', signer_kind: 'account', signer_name: null, recorded_by: 'u1', confirmed_at: 't', goods_photo_path: 'g', signer_photo_path: null, paper_photo_path: null }],
      error: null,
    });
    await expect(listHandoverConfirmations('tr1')).resolves.toEqual([{
      id: 'hc1', transferId: 'tr1', stage: 'send', proofType: 'in_app', signerKind: 'account', signerName: null, recordedBy: 'u1',
      confirmedAt: 't', goodsPhotoPath: 'g', signerPhotoPath: null, paperPhotoPath: null,
    }]);
    expect(h.from).toHaveBeenLastCalledWith('stock_handover_confirmations');
  });

  it('setTransferMode and setProofTiming go through their own RPCs', async () => {
    h.queue.push({ data: null, error: null });
    await setTransferMode('two_step');
    expect(h.rpc).toHaveBeenLastCalledWith('set_stock_transfer_mode', { p_mode: 'two_step' });
    h.queue.push({ data: null, error: null });
    await setProofTiming('may_follow');
    expect(h.rpc).toHaveBeenLastCalledWith('set_stock_proof_timing', { p_timing: 'may_follow' });
  });

  it('recall goes through its RPC with the reason; a shortfall reason trims or nulls', async () => {
    h.queue.push({ data: null, error: null });
    await recallStockTransfer('tr1', 'wrong warehouse');
    expect(h.rpc).toHaveBeenLastCalledWith('recall_stock_transfer', { p_transfer: 'tr1', p_reason: 'wrong warehouse' });
    h.queue.push({ data: null, error: null });
    await resolveStockShortfall('l1', 'written_off', '   ');
    expect(h.rpc).toHaveBeenLastCalledWith('resolve_stock_transfer_shortfall', { p_line: 'l1', p_resolution: 'written_off', p_reason: null });
  });

  it('a handover photo uploads to the private bucket under org/transfer/confirmation and returns the path', async () => {
    h.upload.mockResolvedValueOnce({ error: null });
    const path = await uploadHandoverPhoto('o1', 'tr1', 'hc1', 'goods', new File(['x'], 'crate 2.jpg'));
    expect(path).toBe('o1/tr1/hc1/goods-crate_2.jpg');
    expect(h.upload).toHaveBeenCalledWith(path, expect.anything());
  });

  it('handoverPhotoUrl signs for 300s', async () => {
    await expect(handoverPhotoUrl('o/tr/hc/g.jpg')).resolves.toBe('https://signed/handover');
  });

  it('setTagProofRule and setItemQualityCheck refuse a write that changed no row', async () => {
    h.queue.push({ data: [], error: null });
    await expect(setTagProofRule('tag1', 'paper')).rejects.toMatchObject({ code: '42501' });
    h.queue.push({ data: [{ id: 'tag1' }], error: null });
    await setTagProofRule('tag1', 'confirmation');
    h.queue.push({ data: [], error: null });
    await expect(setItemQualityCheck('i1', true)).rejects.toMatchObject({ code: '42501' });
    h.queue.push({ data: [{ id: 'i1' }], error: null });
    await setItemQualityCheck('i1', false);
  });
});
