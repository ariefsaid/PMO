import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = { from: [] as string[], update: [] as unknown[], insert: [] as unknown[], eq: [] as unknown[] };
  const builder: Record<string, unknown> = {};
  const record = (name: 'update' | 'insert' | 'eq') => (...args: unknown[]) => { calls[name].push(args.length === 1 ? args[0] : args); return builder; };
  builder.update = record('update');
  builder.insert = record('insert');
  builder.eq = record('eq');
  builder.select = () => builder;
  builder.single = () => builder;
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);
  const from = vi.fn((table: string) => { calls.from.push(table); return builder; });
  return { result, calls, from };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));
vi.mock('@/src/lib/m365/graphClient', () => ({ issueMicrosoftDocument: vi.fn() }));

import { attachMicrosoftUpload } from './documents';
import { confirmMicrosoftUpload, type ProcPhase } from './procurementFiles';

const REF = { drive_id: 'd1', item_id: 'i1', web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf', name: 'Plan.pdf', item_kind: 'file' as const };

beforeEach(() => {
  h.from.mockClear();
  h.calls.from.length = 0; h.calls.update.length = 0; h.calls.insert.length = 0; h.calls.eq.length = 0;
  h.result.value = { data: null, error: null };
});

describe('document-preview AC-007 attachMicrosoftUpload', () => {
  it('issues ONE update that swaps the source and drops the private file path', async () => {
    h.result.value = { data: [{ id: 'doc-1' }], error: null };
    await attachMicrosoftUpload('doc-1', REF);
    expect(h.calls.from).toEqual(['project_documents']);
    expect(h.calls.update).toEqual([{
      source: 'onedrive', file_path: null, ms_drive_id: 'd1', ms_item_id: 'i1',
      ms_web_url: REF.web_url, ms_item_name: 'Plan.pdf', ms_item_kind: 'file',
    }]);
    expect(h.calls.eq).toEqual([['id', 'doc-1']]);
  });

  it('treats a write that touched no row as a refusal (a hidden row is not a success)', async () => {
    h.result.value = { data: [], error: null };
    await expect(attachMicrosoftUpload('doc-1', REF)).rejects.toMatchObject({ code: '42501' });
  });

  it('throws the Postgres code of a rejected write', async () => {
    h.result.value = { data: null, error: { message: 'new row violates check', code: '23514' } };
    await expect(attachMicrosoftUpload('doc-1', REF)).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a malformed reference before any write', async () => {
    await expect(attachMicrosoftUpload('doc-1', { ...REF, web_url: 'http://x' })).rejects.toMatchObject({ code: '23514' });
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe('document-preview AC-007 confirmMicrosoftUpload', () => {
  const TABLES: Array<[ProcPhase, string, string]> = [
    ['quotation', 'procurement_quotation_files', 'quotation_id'],
    ['receipt', 'procurement_receipt_files', 'receipt_id'],
    ['invoice', 'procurement_invoice_files', 'invoice_id'],
    ['purchase_request', 'purchase_request_files', 'purchase_request_id'],
    ['rfq', 'rfq_files', 'rfq_id'],
    ['purchase_order', 'purchase_order_files', 'purchase_order_id'],
    ['payment', 'payment_files', 'payment_id'],
  ];

  it.each(TABLES)('%s inserts a SharePoint-backed row into %s through the one phase map', async (phase, table, parentCol) => {
    h.result.value = { data: { id: 'f1', org_id: 'o', title: 'Plan', file_path: null, uploaded_by_id: 'u1', created_at: 't', archived_at: null, [parentCol]: 'p1', source: 'onedrive', ms_web_url: REF.web_url, ms_item_name: 'Plan.pdf' }, error: null };
    const row = await confirmMicrosoftUpload(phase, 'p1', REF, 'Plan', 'u1');
    expect(h.calls.from).toEqual([table]);
    expect(h.calls.insert).toEqual([{
      [parentCol]: 'p1', source: 'onedrive', file_path: null, ms_drive_id: 'd1', ms_item_id: 'i1',
      ms_web_url: REF.web_url, ms_item_name: 'Plan.pdf', title: 'Plan', uploaded_by_id: 'u1',
    }]);
    expect(row).toMatchObject({ id: 'f1', parent_id: 'p1', source: 'onedrive', ms_item_name: 'Plan.pdf' });
  });

  it('throws the Postgres code of a rejected insert and refuses a bad reference first', async () => {
    h.result.value = { data: null, error: { message: 'rls', code: '42501' } };
    await expect(confirmMicrosoftUpload('receipt', 'p1', REF, null, null)).rejects.toMatchObject({ code: '42501' });
    h.from.mockClear();
    await expect(confirmMicrosoftUpload('receipt', 'p1', { ...REF, item_kind: 'folder' as never, web_url: 'nope' }, null, null)).rejects.toMatchObject({ code: '23514' });
    expect(h.from).not.toHaveBeenCalled();
  });
});
