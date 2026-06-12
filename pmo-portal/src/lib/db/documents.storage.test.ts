import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock helpers using the vi.hoisted pattern from existing tests
const h = vi.hoisted(() => {
  const storageResult = { value: { data: null as unknown, error: null as unknown } };
  const storageCalls = {
    from: [] as unknown[],
    createSignedUploadUrl: [] as unknown[],
    remove: [] as unknown[],
    createSignedUrl: [] as unknown[],
  };

  const storageBuilder: Record<string, unknown> = {};
  const storageChain = (name: keyof typeof storageCalls) => (...args: unknown[]) => {
    (storageCalls[name] as unknown[]).push(args);
    return storageBuilder;
  };
  storageBuilder.createSignedUploadUrl = vi.fn((...args: unknown[]) => {
    storageCalls.createSignedUploadUrl.push(args);
    return Promise.resolve(storageResult.value);
  });
  storageBuilder.remove = vi.fn((...args: unknown[]) => {
    storageCalls.remove.push(args);
    return Promise.resolve(storageResult.value);
  });
  storageBuilder.createSignedUrl = vi.fn((...args: unknown[]) => {
    storageCalls.createSignedUrl.push(args);
    return Promise.resolve(storageResult.value);
  });

  const storageFrom = vi.fn((bucket: string) => {
    storageCalls.from.push(bucket);
    return storageBuilder;
  });

  // Table mock helpers
  const result = { value: { data: null as unknown, error: null as unknown } };
  const calls = {
    from: [] as unknown[],
    select: [] as unknown[],
    eq: [] as unknown[],
    update: [] as unknown[],
    maybeSingle: 0,
  };

  const builder: Record<string, unknown> = {};
  const chain = (name: keyof typeof calls) => (...args: unknown[]) => {
    if (name === 'maybeSingle') {
      (calls[name] as number)++;
    } else {
      (calls[name] as unknown[]).push(args.length === 1 ? args[0] : args);
    }
    return builder;
  };
  builder.select = chain('select');
  builder.eq = chain('eq');
  builder.update = chain('update');
  builder.maybeSingle = chain('maybeSingle');
  builder.then = (resolve: (v: unknown) => unknown) => resolve(result.value);

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return builder;
  });

  return { from, calls, result, storageFrom, storageCalls, storageResult };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: h.from, storage: { from: h.storageFrom } },
}));

import {
  prepareUpload,
  confirmUpload,
  cleanupStorageObject,
  getSignedDownloadUrl,
  createDocumentRevision,
  getChildDocument,
} from './documents';
import { MAX_FILE_SIZE_MB } from '@/src/lib/fileConstants';

const mockDocRow = {
  id: 'doc-1',
  org_id: 'org-1',
  project_id: 'proj-1',
  file_path: null,
  status: 'Draft',
  code: 'DWG-001',
  category: 'Drawing',
  title: 'Foundation GA',
  revision: 'A',
  author_id: 'user-1',
  doc_date: null,
  parent_document_id: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('documents DAL — storage operations', () => {
  beforeEach(() => {
    h.from.mockClear();
    h.storageFrom.mockClear();
    for (const k of Object.keys(h.calls) as (keyof typeof h.calls)[]) {
      if (typeof h.calls[k] === 'number') (h.calls[k] as unknown) = 0;
      else (h.calls[k] as unknown[]).length = 0;
    }
    for (const k of Object.keys(h.storageCalls) as (keyof typeof h.storageCalls)[]) {
      (h.storageCalls[k] as unknown[]).length = 0;
    }
    h.result.value = { data: null, error: null };
    h.storageResult.value = { data: null, error: null };
  });

  it('AC-DOC-020 (DAL): prepareUpload fetches row + creates signed upload URL', async () => {
    h.result.value = { data: mockDocRow, error: null };
    h.storageResult.value = {
      data: { signedUrl: 'https://storage.example.com/upload?token=abc', path: 'org-1/proj-1/doc-1/file.pdf', token: 'abc' },
      error: null,
    };

    const result = await prepareUpload('doc-1', 'File.PDF');

    // DAL fetched the document row internally — no orgId/projectId param
    expect(h.calls.from).toContain('project_documents');
    expect(h.calls.eq).toContainEqual(['id', 'doc-1']);
    // DAL built the path from the fetched row + sanitized filename
    expect(h.storageCalls.from).toContain('project-documents');
    expect(h.storageCalls.createSignedUploadUrl).toContainEqual(['org-1/proj-1/doc-1/file.pdf']);
    expect(result.signedUrl).toBe('https://storage.example.com/upload?token=abc');
    expect(result.path).toBe('org-1/proj-1/doc-1/file.pdf');
    expect(result.oldPath).toBeNull();
  });

  it('AC-DOC-020 (DAL): prepareUpload throws if document not Draft', async () => {
    h.result.value = { data: { ...mockDocRow, status: 'Issued' }, error: null };

    await expect(prepareUpload('doc-1', 'file.pdf')).rejects.toThrow('not Draft');
  });

  it('AC-DOC-020 (DAL): prepareUpload returns oldPath for replace flow', async () => {
    h.result.value = { data: { ...mockDocRow, file_path: 'org-1/proj-1/doc-1/old.pdf' }, error: null };
    h.storageResult.value = {
      data: { signedUrl: 'https://storage.example.com/upload?token=abc2', path: 'org-1/proj-1/doc-1/new.pdf', token: 'abc2' },
      error: null,
    };

    const result = await prepareUpload('doc-1', 'new.pdf');
    expect(result.oldPath).toBe('org-1/proj-1/doc-1/old.pdf');
    expect(result.path).toBe('org-1/proj-1/doc-1/new.pdf');
  });

  it('AC-DOC-021 (DAL): confirmUpload updates file_path on the row', async () => {
    h.result.value = { data: null, error: null };

    await confirmUpload('doc-1', 'org-1/proj-1/doc-1/file.pdf');
    expect(h.calls.from).toContain('project_documents');
    expect(h.calls.eq).toContainEqual(['id', 'doc-1']);
  });

  it('AC-DOC-021 (DAL): cleanupStorageObject removes the old object', async () => {
    h.storageResult.value = { data: null, error: null };

    await cleanupStorageObject('org-1/proj-1/doc-1/old.pdf');
    expect(h.storageCalls.from).toContain('project-documents');
    expect(h.storageCalls.remove).toContainEqual([['org-1/proj-1/doc-1/old.pdf']]);
  });

  it('AC-DOC-011 (DAL): getSignedDownloadUrl uses SIGNED_URL_EXPIRY_SECONDS', async () => {
    h.storageResult.value = {
      data: { signedUrl: 'https://example.com/signed' },
      error: null,
    };

    const result = await getSignedDownloadUrl('org-1/proj-1/doc-1/file.pdf');
    expect(h.storageCalls.from).toContain('project-documents');
    expect(h.storageCalls.createSignedUrl).toContainEqual(['org-1/proj-1/doc-1/file.pdf', 3600]);
    expect(result).toBe('https://example.com/signed');
  });
});