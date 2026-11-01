import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadFailure, uploadRecordFile } from '../uploadClient';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { functions: { invoke } } }));

const REF = { drive_id: 'd', item_id: 'i', web_url: 'https://tenant.sharepoint.com/sites/x/Plan.pdf', name: 'Plan.pdf', item_kind: 'file' };
const pdf = () => new File(['%PDF-1.7'], 'Plan.pdf', { type: 'application/pdf' });
const failure = (body: unknown, status: number) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) },
});
const UUID = '0b6f6c1e-3c7a-4f0e-9d6a-1b2c3d4e5f60';

beforeEach(() => invoke.mockReset());

describe('uploadRecordFile', () => {
  it('document-preview AC-007 posts exactly the project fields plus the file as multipart, never JSON', async () => {
    invoke.mockResolvedValue({ data: { reference: REF }, error: null });
    const file = pdf();
    const reference = await uploadRecordFile({ kind: 'project_document', id: UUID }, file);
    expect(reference).toEqual(REF);
    const body = invoke.mock.calls[0][1].body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect([...body.keys()].sort()).toEqual(['action', 'file', 'target_id', 'target_kind']);
    expect(body.get('action')).toBe('upload_record_file');
    expect(body.get('target_kind')).toBe('project_document');
    expect(body.get('target_id')).toBe(UUID);
    expect((body.get('file') as File).name).toBe('Plan.pdf');
  });

  it('document-preview AC-007 posts exactly the purchase fields for a phase file', async () => {
    invoke.mockResolvedValue({ data: { reference: REF }, error: null });
    await uploadRecordFile({ kind: 'procurement_file', phase: 'receipt', parent_id: UUID }, pdf());
    const body = invoke.mock.calls[0][1].body as FormData;
    expect([...body.keys()].sort()).toEqual(['action', 'file', 'parent_id', 'phase', 'target_kind']);
    expect(body.get('phase')).toBe('receipt');
    expect(body.get('parent_id')).toBe(UUID);
  });

  it('document-preview AC-007 refuses a disallowed file before any request', async () => {
    const exe = new File(['x'], 'run.exe');
    await expect(uploadRecordFile({ kind: 'project_document', id: UUID }, exe)).rejects.toMatchObject({ kind: 'invalid' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('refuses a renamed file whose bytes do not match its extension before any request', async () => {
    const fake = new File(['MZ-not-a-pdf'], 'Plan.pdf', { type: 'application/pdf' });
    await expect(uploadRecordFile({ kind: 'project_document', id: UUID }, fake)).rejects.toMatchObject({ kind: 'invalid' });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['RECORD_FOLDER_UNAVAILABLE', 409, 'folder'],
    ['SCOPE_INSUFFICIENT', 403, 'consent'],
    ['NOT_CONNECTED', 404, 'connection'],
    ['CONNECTION_STALE', 409, 'connection'],
    ['CONNECTION_REVOKED', 410, 'connection'],
    ['SOURCE_ACCESS_DENIED', 403, 'access'],
    ['NOT_ENTITLED', 403, 'entitlement'],
    ['GRAPH_ERROR', 502, 'unavailable'],
    ['SOMETHING_NEW', 500, 'unavailable'],
  ])('document-preview AC-007 maps %s to %s', async (code, status, kind) => {
    invoke.mockResolvedValue(failure({ error: code }, status));
    await expect(uploadRecordFile({ kind: 'project_document', id: UUID }, pdf())).rejects.toMatchObject({ kind });
  });

  it('document-preview AC-007 refuses a response that is not a Microsoft FILE reference', async () => {
    for (const reference of [{ ...REF, item_kind: 'folder' }, { ...REF, web_url: 'http://tenant.sharepoint.com/a' }, null]) {
      invoke.mockResolvedValue({ data: { reference }, error: null });
      await expect(uploadRecordFile({ kind: 'project_document', id: UUID }, pdf())).rejects.toBeInstanceOf(UploadFailure);
    }
  });

  it('document-preview AC-007 reports a cancelled upload as cancelled', async () => {
    const controller = new AbortController();
    invoke.mockImplementation(async () => { controller.abort(); return { data: null, error: new Error('aborted') }; });
    await expect(uploadRecordFile({ kind: 'project_document', id: UUID }, pdf(), controller.signal)).rejects.toMatchObject({ kind: 'cancelled' });
  });
});
