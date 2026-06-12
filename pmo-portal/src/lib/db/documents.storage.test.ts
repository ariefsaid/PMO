import { describe, it, expect, vi, beforeEach } from 'vitest';

type QueryResult<TData> = { data: TData; error: { message: string; code?: string } | null };
type StorageResult<TData> = { data: TData; error: { message: string; name?: string } | null };

interface StorageBuilder {
  createSignedUploadUrl: (path: string) => Promise<StorageResult<{ signedUrl: string; path: string; token: string } | null>>;
  remove: (paths: string[]) => Promise<StorageResult<null>>;
  createSignedUrl: (path: string, expiresIn: number) => Promise<StorageResult<{ signedUrl: string } | null>>;
}

interface TableBuilder {
  select: (columns: string) => TableBuilder;
  eq: (column: string, value: string) => TableBuilder;
  update: (values: { file_path: string }) => TableBuilder;
  maybeSingle: () => Promise<QueryResult<typeof mockDocRow | null>>;
  then: <TResult1 = QueryResult<null>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) => Promise<TResult1 | TResult2>;
}

const h = vi.hoisted(() => {
  const storageResult: { value: StorageResult<{ signedUrl: string; path: string; token: string } | { signedUrl: string } | null> } = {
    value: { data: null, error: null },
  };
  const storageCalls = {
    from: [] as string[],
    createSignedUploadUrl: [] as [string][],
    remove: [] as [string[]][],
    createSignedUrl: [] as [string, number][],
  };

  const storageBuilder: StorageBuilder = {
    createSignedUploadUrl: vi.fn((path: string) => {
      storageCalls.createSignedUploadUrl.push([path]);
      return Promise.resolve(storageResult.value as StorageResult<{ signedUrl: string; path: string; token: string } | null>);
    }),
    remove: vi.fn((paths: string[]) => {
      storageCalls.remove.push([paths]);
      return Promise.resolve({ data: null, error: storageResult.value.error });
    }),
    createSignedUrl: vi.fn((path: string, expiresIn: number) => {
      storageCalls.createSignedUrl.push([path, expiresIn]);
      return Promise.resolve(storageResult.value as StorageResult<{ signedUrl: string } | null>);
    }),
  };

  const storageFrom = vi.fn((bucket: string) => {
    storageCalls.from.push(bucket);
    return storageBuilder;
  });

  const result: { value: QueryResult<typeof mockDocRow | null> | QueryResult<null> } = {
    value: { data: null, error: null },
  };
  const calls = {
    from: [] as string[],
    select: [] as string[],
    eq: [] as [string, string][],
    update: [] as [{ file_path: string }][],
    maybeSingle: 0,
  };

  const builder: TableBuilder = {
    select: vi.fn((columns: string) => {
      calls.select.push(columns);
      return builder;
    }),
    eq: vi.fn((column: string, value: string) => {
      calls.eq.push([column, value]);
      return builder;
    }),
    update: vi.fn((values: { file_path: string }) => {
      calls.update.push([values]);
      return builder;
    }),
    maybeSingle: vi.fn(() => {
      calls.maybeSingle += 1;
      return Promise.resolve(result.value as QueryResult<typeof mockDocRow | null>);
    }),
    then: (onfulfilled, onrejected) => Promise.resolve(result.value as QueryResult<null>).then(onfulfilled, onrejected),
  };

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
} from './documents';

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
    h.calls.from.length = 0;
    h.calls.select.length = 0;
    h.calls.eq.length = 0;
    h.calls.update.length = 0;
    h.calls.maybeSingle = 0;
    h.storageCalls.from.length = 0;
    h.storageCalls.createSignedUploadUrl.length = 0;
    h.storageCalls.remove.length = 0;
    h.storageCalls.createSignedUrl.length = 0;
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

    expect(h.calls.from).toContain('project_documents');
    expect(h.calls.eq).toContainEqual(['id', 'doc-1']);
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
