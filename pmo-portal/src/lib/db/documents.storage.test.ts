import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create the mock helpers inline in the factory
vi.mock('@/src/lib/supabase/client', () => {
  const createSignedUploadUrlMock = vi.fn();
  const removeMock = vi.fn();
  const createSignedUrlMock = vi.fn();

  return {
    supabase: {
      storage: {
        from: vi.fn(() => ({
          createSignedUploadUrl: createSignedUploadUrlMock,
          remove: removeMock,
          createSignedUrl: createSignedUrlMock,
        })),
      },
      from: vi.fn((table: string) => {
        const selectChainMock = {
          eq: vi.fn(() => selectChainMock),
          maybeSingle: vi.fn(),
        };
        const updateChainMock = {
          eq: vi.fn(),
        };

        if (table === 'project_documents') {
          return {
            select: vi.fn(() => selectChainMock),
            update: vi.fn(() => updateChainMock),
          };
        }
        return {};
      }),
    },
    __mockHelpers: {
      createSignedUploadUrlMock,
      removeMock,
      createSignedUrlMock,
    },
  };
});

// Import the mocked supabase to get the helpers
import { supabase } from '@/src/lib/supabase/client';
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
    vi.clearAllMocks();
    // Default: fetch returns the mock doc row
    const mockFrom = vi.mocked(supabase.from);
    const tableMock = mockFrom('project_documents');
    const selectMock = vi.mocked(tableMock.select);
    const selectChain = selectMock();
    selectChain.maybeSingle.mockResolvedValue({ data: mockDocRow, error: null });

    const updateMock = vi.mocked(tableMock.update);
    const updateChain = updateMock();
    updateChain.eq.mockResolvedValue({ error: null });
  });

  it('AC-DOC-020 (DAL): prepareUpload fetches row + creates signed upload URL', async () => {
    const mockStorage = vi.mocked(supabase.storage.from);
    const storageMock = mockStorage('project-documents');
    vi.mocked(storageMock.createSignedUploadUrl).mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/upload?token=abc', path: 'org-1/proj-1/doc-1/file.pdf', token: 'abc' },
      error: null,
    });

    const result = await prepareUpload('doc-1', 'File.PDF');

    // DAL fetched the document row internally — no orgId/projectId param
    expect(supabase.from).toHaveBeenCalledWith('project_documents');
    // DAL built the path from the fetched row + sanitized filename
    expect(supabase.storage.from).toHaveBeenCalledWith('project-documents');
    expect(vi.mocked(storageMock.createSignedUploadUrl)).toHaveBeenCalledWith('org-1/proj-1/doc-1/file.pdf');
    expect(result.signedUrl).toBe('https://storage.example.com/upload?token=abc');
    expect(result.path).toBe('org-1/proj-1/doc-1/file.pdf');
    expect(result.oldPath).toBeNull();
  });

  it('AC-DOC-020 (DAL): prepareUpload throws if document not Draft', async () => {
    const mockFrom = vi.mocked(supabase.from);
    const tableMock = mockFrom('project_documents');
    const selectMock = vi.mocked(tableMock.select);
    const selectChain = selectMock();
    selectChain.maybeSingle.mockResolvedValue({
      data: { ...mockDocRow, status: 'Issued' }, error: null,
    });

    await expect(prepareUpload('doc-1', 'file.pdf')).rejects.toThrow('not Draft');
  });

  it('AC-DOC-020 (DAL): prepareUpload returns oldPath for replace flow', async () => {
    const mockFrom = vi.mocked(supabase.from);
    const tableMock = mockFrom('project_documents');
    const selectMock = vi.mocked(tableMock.select);
    const selectChain = selectMock();
    selectChain.maybeSingle.mockResolvedValue({
      data: { ...mockDocRow, file_path: 'org-1/proj-1/doc-1/old.pdf' }, error: null,
    });

    const mockStorage = vi.mocked(supabase.storage.from);
    const storageMock = mockStorage('project-documents');
    vi.mocked(storageMock.createSignedUploadUrl).mockResolvedValue({
      data: { signedUrl: 'https://storage.example.com/upload?token=abc2', path: 'org-1/proj-1/doc-1/new.pdf', token: 'abc2' },
      error: null,
    });

    const result = await prepareUpload('doc-1', 'new.pdf');
    expect(result.oldPath).toBe('org-1/proj-1/doc-1/old.pdf');
    expect(result.path).toBe('org-1/proj-1/doc-1/new.pdf');
  });

  it('AC-DOC-021 (DAL): confirmUpload updates file_path on the row', async () => {
    await confirmUpload('doc-1', 'org-1/proj-1/doc-1/file.pdf');
    const mockFrom = vi.mocked(supabase.from);
    const tableMock = mockFrom('project_documents');
    const updateMock = vi.mocked(tableMock.update);
    const updateChain = updateMock();
    expect(updateChain.eq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('AC-DOC-021 (DAL): cleanupStorageObject removes the old object', async () => {
    const mockStorage = vi.mocked(supabase.storage.from);
    const storageMock = mockStorage('project-documents');
    vi.mocked(storageMock.remove).mockResolvedValue({ error: null });

    await cleanupStorageObject('org-1/proj-1/doc-1/old.pdf');
    expect(vi.mocked(storageMock.remove)).toHaveBeenCalledWith(['org-1/proj-1/doc-1/old.pdf']);
  });

  it('AC-DOC-011 (DAL): getSignedDownloadUrl uses SIGNED_URL_EXPIRY_SECONDS', async () => {
    const mockStorage = vi.mocked(supabase.storage.from);
    const storageMock = mockStorage('project-documents');
    vi.mocked(storageMock.createSignedUrl).mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed' }, error: null,
    });

    const result = await getSignedDownloadUrl('org-1/proj-1/doc-1/file.pdf');
    expect(vi.mocked(storageMock.createSignedUrl)).toHaveBeenCalledWith('org-1/proj-1/doc-1/file.pdf', 3600);
    expect(result).toBe('https://example.com/signed');
  });
});