import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const queue: Array<{ data: unknown; error: unknown }> = [];
  const calls = { from: [] as string[], select: [] as string[], or: [] as string[], limit: [] as number[] };
  const builder: Record<string, unknown> = {};
  for (const n of ['order', 'eq', 'is', 'single', 'maybeSingle']) builder[n] = () => builder;
  builder.select = (s: string) => { calls.select.push(s); return builder; };
  builder.or = (s: string) => { calls.or.push(s); return builder; };
  builder.limit = (n: number) => { calls.limit.push(n); return builder; };
  builder.then = (resolve: (v: unknown) => unknown) => resolve(queue.shift() ?? { data: [], error: null });
  const from = vi.fn((t: string) => { calls.from.push(t); return builder; });
  const rpc = vi.fn(async () => queue.shift() ?? { data: null, error: null });
  return { from, rpc, calls, queue };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { listProjectIssueLines, cancelStockDocument, createStockDocument, getStockDocument, listIssuableWorkItems, listStockDocuments, postStockDocument, saveStockDraft } from './stockDocuments';

beforeEach(() => {
  h.queue.length = 0; h.from.mockClear(); h.rpc.mockClear();
  h.calls.from.length = 0; h.calls.select.length = 0; h.calls.or.length = 0; h.calls.limit.length = 0;
});

describe('stockDocuments DAL', () => {
  it('FR-STK-015 create sends one stable client_request_id and returns the document id', async () => {
    h.queue.push({ data: 'doc-1', error: null });
    const id = await createStockDocument(
      { kind: 'issue', warehouseId: 'w1', projectId: 'p1', lines: [{ itemId: 'i1', quantity: '5', boqItemId: 'b1' }] },
      { post: true, clientRequestId: 'req-1' },
    );
    expect(id).toBe('doc-1');
    expect(h.rpc).toHaveBeenCalledWith('create_stock_document', {
      p_header: { kind: 'issue', warehouse_id: 'w1', project_id: 'p1' },
      p_lines: [{ item_id: 'i1', quantity: '5', boq_item_id: 'b1' }], p_post: true, p_client_request_id: 'req-1',
    });
  });

  it('NFR-STK-007 quantities and costs are sent as strings, never numbers', async () => {
    h.queue.push({ data: 'doc-1', error: null });
    await createStockDocument({ kind: 'receive', warehouseId: 'w1', lines: [{ itemId: 'i1', quantity: '2.500', unitCost: '10.25' }] }, { post: true, clientRequestId: 'r' });
    const lines = (h.rpc.mock.calls[0] as unknown as [string, { p_lines: Array<Record<string, unknown>> }])[1].p_lines;
    expect(typeof lines[0].quantity).toBe('string');
    expect(typeof lines[0].unit_cost).toBe('string');
  });

  it('save, post and cancel call their RPCs with the document id', async () => {
    await saveStockDraft('d1', { kind: 'receive', warehouseId: 'w1', lines: [] });
    await postStockDocument('d1');
    await cancelStockDocument('d1');
    expect(h.rpc.mock.calls.map((c) => (c as unknown as [string])[0])).toEqual(['save_stock_draft', 'post_stock_document', 'cancel_stock_document']);
  });

  it('FR-STK-025 a count payload maps countedQuantity to counted_quantity and keeps an optional unit cost', async () => {
    h.queue.push({ data: 'doc-c', error: null });
    await createStockDocument({ kind: 'count', warehouseId: 'w1', lines: [{ itemId: 'i1', countedQuantity: '0' }, { itemId: 'i2', countedQuantity: '5', unitCost: '40' }] },
      { post: false, clientRequestId: 'r' });
    expect(h.rpc).toHaveBeenCalledWith('create_stock_document', {
      p_header: { kind: 'count', warehouse_id: 'w1' },
      p_lines: [{ item_id: 'i1', counted_quantity: '0' }, { item_id: 'i2', counted_quantity: '5', unit_cost: '40' }], p_post: false, p_client_request_id: 'r',
    });
  });

  it('FR-STK-024 an adjustment maps the reason to the header and the direction to each line', async () => {
    h.queue.push({ data: 'doc-a', error: null });
    await createStockDocument({ kind: 'adjustment', warehouseId: 'w1', reason: 'damaged', lines: [{ itemId: 'i1', quantity: '2', direction: 'out' }] },
      { post: false, clientRequestId: 'r' });
    expect(h.rpc).toHaveBeenCalledWith('create_stock_document', {
      p_header: { kind: 'adjustment', warehouse_id: 'w1', reason: 'damaged' },
      p_lines: [{ item_id: 'i1', quantity: '2', direction: 'out' }], p_post: false, p_client_request_id: 'r',
    });
  });

  it('FR-STK-011 saveStockDraft sends the same count and adjustment shapes as create', async () => {
    await saveStockDraft('d1', { kind: 'count', warehouseId: 'w1', lines: [{ itemId: 'i1', countedQuantity: '92' }] });
    await saveStockDraft('d2', { kind: 'adjustment', warehouseId: 'w1', reason: 'found', lines: [{ itemId: 'i1', quantity: '3', direction: 'in', unitCost: '60' }] });
    expect(h.rpc).toHaveBeenNthCalledWith(1, 'save_stock_draft', { p_document_id: 'd1', p_header: { kind: 'count', warehouse_id: 'w1' }, p_lines: [{ item_id: 'i1', counted_quantity: '92' }] });
    expect(h.rpc).toHaveBeenNthCalledWith(2, 'save_stock_draft', {
      p_document_id: 'd2', p_header: { kind: 'adjustment', warehouse_id: 'w1', reason: 'found' }, p_lines: [{ item_id: 'i1', quantity: '3', unit_cost: '60', direction: 'in' }],
    });
  });

  it('a failed create throws an AppError carrying the stable code message', async () => {
    h.queue.push({ data: null, error: { message: 'STK_INSUFFICIENT: item CEM: available 5, requested 6', code: 'P0001', details: '{"available":"5","requested":"6"}' } });
    await expect(createStockDocument({ kind: 'issue', warehouseId: 'w', lines: [] }, { post: true, clientRequestId: 'r' })).rejects.toMatchObject({ code: 'P0001', details: '{"available":"5","requested":"6"}' });
  });

  it('AC-STK-020 lists documents without selecting unit_cost (a column-level grant makes select * fail)', async () => {
    await listStockDocuments({ kind: 'issue' });
    expect(h.calls.from[0]).toBe('stock_documents');
    expect(h.calls.select[0]).not.toContain('*');
    expect(h.calls.select[0]).not.toContain('unit_cost');
  });

  it('lists documents newest first, clamps the page to 100 and pages by (created_at, id)', async () => {
    await listStockDocuments({ limit: 5000, before: { createdAt: '2026-10-01T00:00:00Z', id: 'x' } });
    expect(h.calls.limit[0]).toBe(100);
    expect(h.calls.or[0]).toContain('created_at.lt.2026-10-01T00:00:00Z');
  });

  it('AC-STK-020 a document is read with an explicit line column list that omits unit_cost', async () => {
    h.queue.push({ data: { id: 'd1' }, error: null });
    await getStockDocument('d1');
    const sel = h.calls.select.join(' ');
    expect(sel).not.toContain('*');
    expect(sel).not.toContain('unit_cost');
    expect(sel).toContain('stock_document_lines');
  });

  it('the work-item picker never selects the rate (an Engineer storekeeper must not receive prices)', async () => {
    await listIssuableWorkItems('p1');
    expect(h.calls.from[0]).toBe('boq_items');
    expect(h.calls.select[0]).not.toMatch(/rate|\*/);
  });

  it('FR-STK-009 the return picker lists posted issue lines of the project with explicit columns', async () => {
    h.queue.push({ data: [{ id: 'l1', item_id: 'i', quantity: 5, boq_item_id: null, item: null, boq: null, document: { id: 'd', number: 'I-1', occurred_on: 'x', warehouse_id: 'w' } }], error: null });
    const rows = await listProjectIssueLines('p1');
    expect(h.calls.from[0]).toBe('stock_document_lines');
    expect(h.calls.select[0]).not.toMatch(/\*\s*[,)]|unit_cost/);
    expect(rows[0].quantity).toBe('5');
  });
});
