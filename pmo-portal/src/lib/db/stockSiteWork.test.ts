import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  const upload = vi.fn();
  const remove = vi.fn();
  const insert = vi.fn();
  const deleteRow = vi.fn();
  const pages: unknown[][] = [];
  const range = vi.fn();
  const query: Record<string, unknown> = {};
  Object.assign(query, { select: () => query, order: () => query, is: () => query, eq: () => query,
    range: (a: number, b: number) => { range(a, b); return query; },
    limit: () => query, then: (resolve: (value: unknown) => void) => resolve({ data: pages.shift() ?? [], error: null }) });
  return { rpc, queue, upload, remove, insert, deleteRow, query, pages, range };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc, storage: { from: () => ({ upload: h.upload, remove: h.remove }) }, from: () => ({ ...h.query, insert: h.insert, delete: h.deleteRow }) } }));

import { archiveStockDocumentFile, getWorkOrderMaterialCompletion, getWorkOrderStockBalance, uploadStockDocumentFile, listStockTags, listStockDocumentFiles, deleteStockDocumentFile } from './stockSiteWork';

beforeEach(() => { h.queue.length = 0; h.rpc.mockClear(); h.upload.mockReset(); h.remove.mockReset(); h.insert.mockReset(); h.deleteRow.mockReset(); h.pages.length = 0; h.range.mockClear(); });

const row = (extra: Record<string, unknown> = {}) => ({
  work_order_id: 'wo1', item_id: 'i', item_code: 'FREE', item_name: 'Valve', unit_code: 'pc', warehouse_id: 'w', warehouse_code: 'YARD1', warehouse_kind: 'yard',
  tag_id: 't', tag_name: 'Owner supplied', zero_cost: true, received_qty: '6', moved_out_qty: '4', issued_qty: '0', on_site_qty: '2', ...extra,
});

describe('stockSiteWork DAL', () => {
  it('AC-SSW-010 a work order with no ledger rows reads as an empty list, not a zero row', async () => {
    h.queue.push({ data: [], error: null });
    expect(await getWorkOrderStockBalance({ workOrderId: 'wo1' })).toEqual([]);
    expect(h.rpc).toHaveBeenCalledWith('get_work_order_stock_balance', { p_work_order_id: 'wo1' });
  });

  it('AC-SSW-011 the org\'s own tag name travels through unchanged, with quantities as strings', async () => {
    h.queue.push({ data: [row()], error: null });
    const [r] = await getWorkOrderStockBalance({ workOrderId: 'wo1' });
    expect(r).toMatchObject({ tagName: 'Owner supplied', zeroCost: true, onSiteQty: '2', warehouseKind: 'yard' });
  });

  it('FR-SSW-031 value keys are absent when the server omitted them, present when it sent them', async () => {
    h.queue.push({ data: [row()], error: null });
    const [a] = await getWorkOrderStockBalance({ workOrderId: 'wo1' });
    expect('onSiteValue' in a).toBe(false);
    h.queue.push({ data: [row({ received_value: '0.00', moved_out_value: '0.00', issued_value: '0.00', on_site_value: '0.00' })], error: null });
    const [b] = await getWorkOrderStockBalance({ projectId: 'p1' });
    expect(b.onSiteValue).toBe('0.00');
    expect(h.rpc).toHaveBeenLastCalledWith('get_work_order_stock_balance', { p_project_id: 'p1' });
  });

  it('FR-SSW-032 an unassigned bucket keeps workOrderId null', async () => {
    h.queue.push({ data: [row({ work_order_id: null })], error: null });
    expect((await getWorkOrderStockBalance({ projectId: 'p1' }))[0].workOrderId).toBeNull();
  });

  it('a database refusal reaches the caller with its message', async () => {
    h.queue.push({ data: null, error: { message: 'STK_INVALID: archiving needs a reason', code: 'P0001' } });
    await expect(archiveStockDocumentFile('f1', ' ')).rejects.toMatchObject({ message: expect.stringContaining('archiving needs a reason') });
  });
});

describe('document attachment upload', () => {
  it('uploads the object before creating its metadata, with the matching file id in the path', async () => {
    h.upload.mockResolvedValue({ error: null });
    h.insert.mockResolvedValue({ error: null });
    const f = new File(['paper'], 'delivery slip.pdf', { type: 'application/pdf' });
    await uploadStockDocumentFile('org', 'doc', f, 'Slip');
    const [path, sentFile] = h.upload.mock.calls[0];
    expect(sentFile).toBe(f);
    expect(path).toMatch(/^org\/doc\/[^/]+\/delivery_slip.pdf$/);
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ document_id: 'doc', id: path.split('/')[2], file_path: path, label: 'Slip' }));
    expect(h.upload.mock.invocationCallOrder[0]).toBeLessThan(h.insert.mock.invocationCallOrder[0]);
  });
  it('does not record metadata if uploading fails', async () => {
    h.upload.mockResolvedValue({ error: { message: 'upload failed' } });
    await expect(uploadStockDocumentFile('org', 'doc', new File(['x'], 'x.pdf'), null)).rejects.toThrow('upload failed');
    expect(h.insert).not.toHaveBeenCalled();
  });
});

it('reads all tag pages instead of dropping tags beyond the first page', async () => {
  h.pages.push(Array.from({ length: 500 }, (_, id) => ({ id })), [{ id: 500 }]);
  expect(await listStockTags()).toHaveLength(501);
  expect(h.range.mock.calls).toEqual([[0, 499], [500, 999]]);
});
it('reads all document attachment pages', async () => {
  h.pages.push(Array.from({ length: 500 }, (_, id) => ({ id })), [{ id: 500 }]);
  expect(await listStockDocumentFiles('doc')).toHaveLength(501);
  expect(h.range.mock.calls).toEqual([[0, 499], [500, 999]]);
});

it('removes the uploaded object when deleting a draft attachment', async () => {
  h.remove.mockResolvedValue({ error: null });
  h.deleteRow.mockReturnValue(h.query);
  h.pages.push([{ id: 'f1' }]);
  await deleteStockDocumentFile('f1', 'org/doc/f1/slip.pdf');
  expect(h.remove).toHaveBeenCalledWith(['org/doc/f1/slip.pdf']);
  expect(h.deleteRow).toHaveBeenCalledOnce();
});

describe('getWorkOrderMaterialCompletion (AC-WMC-006)', () => {
  it('AC-WMC-006 maps the one read: figures stay decimal strings, cost fields appear only when the database sent them', async () => {
    h.queue.push({ data: { rows: [{ item_id: 'i', item_code: 'PIPE', item_name: 'Pipe', unit_code: 'm', issued: '10', returned: '2', moved_in: '5', moved_out: '1', counted_difference: '-1', balance: '3' }],
      totals: [{ unit_code: 'm', issued: '10', returned: '2', moved_in: '5', moved_out: '1', counted_difference: '-1', balance: '3' }], value_totals: null }, error: null });
    const c = await getWorkOrderMaterialCompletion('wo1');
    expect(h.rpc).toHaveBeenCalledWith('get_work_order_material_completion', { p_work_order_id: 'wo1' });
    expect(c.rows[0]).toEqual({ itemId: 'i', itemCode: 'PIPE', itemName: 'Pipe', unitCode: 'm', issued: '10', returned: '2', movedIn: '5', movedOut: '1', countedDifference: '-1', balance: '3' });
    expect(c.rows[0]).not.toHaveProperty('issuedValue');
    expect(c.valueTotals).toBeNull();
    h.queue.push({ data: { rows: [{ item_id: 'i', item_code: 'P', item_name: 'P', unit_code: 'm', issued: '1', returned: '0', moved_in: '0', moved_out: '0', counted_difference: '0', balance: '1', issued_value: '4.0000', returned_value: '0', balance_value: '4.0000' }],
      totals: [], value_totals: { issued: '4.0000', returned: '0', balance: '4.0000' } }, error: null });
    const withCost = await getWorkOrderMaterialCompletion('wo1');
    expect(withCost.rows[0].issuedValue).toBe('4.0000');
    expect(withCost.valueTotals).toEqual({ issued: '4.0000', returned: '0', balance: '4.0000' });
  });
});
