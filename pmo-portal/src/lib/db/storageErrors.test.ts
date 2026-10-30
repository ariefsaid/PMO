import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageApiError, StorageUnknownError } from '@supabase/storage-js';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const h = vi.hoisted(() => {
  const storage = { createSignedUploadUrl: vi.fn(), createSignedUrl: vi.fn(), list: vi.fn(), remove: vi.fn() };
  const row = { id: 'doc', org_id: 'org', project_id: 'project', file_path: null, status: 'Draft', source: 'upload', storage_path: 'org/path' };
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'insert']) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: row, error: null }));
  builder.single = vi.fn(async () => ({ data: row, error: null }));
  return { storage, from: vi.fn(() => builder) };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, storage: { from: () => h.storage } } }));
import { prepareAgentAttachmentUpload } from './agentAttachments';
import { prepareUpload as prepareDocument, getSignedDownloadUrl as documentUrl } from './documents';
import { prepareExpenseCaptureReceiptUpload, expenseCaptureReceiptObjectExists, cleanupExpenseCaptureReceiptObject } from './expenseCapture';
import { prepareExpenseReceiptUpload, getExpenseReceiptUrl } from './expenseReceipts';
import { prepareUpload as prepareProcurement, getSignedDownloadUrl as procurementUrl } from './procurementFiles';

const operations: [string, () => Promise<unknown>, keyof typeof h.storage][] = [
  ['agent upload', () => prepareAgentAttachmentUpload({ threadId: 'thread', fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10 }), 'createSignedUploadUrl'],
  ['document upload', () => prepareDocument('doc', 'a.pdf'), 'createSignedUploadUrl'],
  ['document download', () => documentUrl('a.pdf'), 'createSignedUrl'],
  ['capture upload', () => prepareExpenseCaptureReceiptUpload('claim', 'file', 'a.pdf'), 'createSignedUploadUrl'],
  ['capture list', () => expenseCaptureReceiptObjectExists('folder/a.pdf'), 'list'],
  ['capture cleanup', () => cleanupExpenseCaptureReceiptObject('folder/a.pdf'), 'remove'],
  ['receipt upload', () => prepareExpenseReceiptUpload('claim', 'a.pdf'), 'createSignedUploadUrl'],
  ['receipt download', () => getExpenseReceiptUrl('a.pdf'), 'createSignedUrl'],
  ['procurement upload', () => prepareProcurement('quotation', 'proc', 'a.pdf'), 'createSignedUploadUrl'],
  ['procurement download', () => procurementUrl('a.pdf'), 'createSignedUrl'],
];

beforeEach(() => { vi.clearAllMocks(); });
describe('storage failure classification at DAL operations', () => {
  it.each(operations)('%s preserves a service failure without labeling it a permission denial', async (_name, run, method) => {
    const original = new StorageApiError('internal diagnostic', 500, 'InternalError');
    h.storage[method].mockResolvedValue({ data: null, error: original });
    const error = await run().catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'InternalError', status: 500, statusCode: 'InternalError', cause: original });
    expect(classifyMutationError(error, undefined, { suppressCapture: true }).headline).toBe('Update failed');
    expect(classifyMutationError(error, undefined, { suppressCapture: true }).detail).not.toContain('internal diagnostic');
  });
  it.each([
    [new StorageApiError('denied', 401, 'Unauthorized'), '42501'],
    [new StorageApiError('denied', 403, 'AccessDenied'), '42501'],
    [Object.assign(new Error('denied'), { name: 'StorageError', status: '403', code: 'native' }), '42501'],
    [Object.assign(new Error('denied'), { name: 'StorageError', status: '401', code: 'native' }), '42501'],
    [Object.assign(new Error('missing'), { name: 'StorageError', status: '404', code: 'missing' }), 'missing'],
    [Object.assign(new Error('failure'), { name: 'StorageError', status: '500', code: 'service' }), 'service'],
    [Object.assign(new Error('unknown'), { name: 'StorageError' }), undefined],
    [new StorageUnknownError('network', new Error('offline')), undefined],
    [new StorageApiError('missing', 404, 'NoSuchKey'), 'NoSuchKey'],
    [Object.assign(new Error('failure'), { name: 'StorageError', status: 500, code: '42501' }), undefined],
  ])('preserves native context for %s', async (original, code) => {
    h.storage.createSignedUrl.mockResolvedValue({ data: null, error: original });
    const error = await documentUrl('a.pdf').catch((e: unknown) => e);
    expect(error).toMatchObject({ code, cause: original });
    expect((error as { status?: unknown }).status).toBe((original as { status?: unknown }).status);
    expect((error as { nativeCode?: string }).nativeCode).toBe(('code' in original ? original.code : undefined) ?? ('statusCode' in original ? original.statusCode : undefined));
    expect(classifyMutationError(error, undefined, { suppressCapture: true }).headline).toBe(code === '42501' ? "You don't have permission to do that." : 'Update failed');
  });
});
