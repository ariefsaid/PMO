import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const upload = vi.fn(async () => ({ error: null }));
  const maybeSingle = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, order: () => query, eq: () => query, limit: () => query, maybeSingle, then: (r: (v: unknown) => void) => r(queue.shift() ?? { data: [], error: null }) });
  return { rpc, queue, upload, query, maybeSingle };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, from: () => h.query, storage: { from: () => ({ upload: h.upload, createSignedUrl: vi.fn() }) } } }));

import { getMovementProofStatus, getTransferSettings, getStockTransfer, receiveStockTransfer, recordStockHandover, resolveStockShortfall, sendStockTransfer, uploadHandoverPhoto } from './stockTransfers';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.upload.mockClear(); });

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
  it('AC-TST-015 a photo uploads to {org}/{transfer}/{confirmation}/ in the private handover bucket with a safe name', async () => {
    const path = await uploadHandoverPhoto('org', 't', 'c', 'goods', new File(['x'], 'my photo (1).jpg'));
    expect(path).toBe('org/t/c/goods-my_photo__1_.jpg');
    expect(h.upload).toHaveBeenCalledWith(path, expect.any(File));
  });
});
