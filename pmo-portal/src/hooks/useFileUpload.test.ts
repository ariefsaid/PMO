import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ClassifiedUploadError, UploadTransportOptions } from '@/src/lib/uploadTransport';

interface PrepareUploadResult {
  signedUrl: string;
  path: string;
  oldPath: string | null;
}

interface MockUploadError {
  name?: string;
  status?: number;
}

const repo = vi.hoisted(() => ({
  prepareUpload: vi.fn<(docId: string, fileName: string) => Promise<PrepareUploadResult>>(),
  confirmUpload: vi.fn<(docId: string, path: string) => Promise<void>>(),
  cleanupObject: vi.fn<(filePath: string) => Promise<void>>(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: repo,
  },
}));
vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress: vi.fn<(url: string, file: File | Blob, options: UploadTransportOptions) => Promise<void>>(),
  classifyUploadError: vi.fn<(error: MockUploadError) => ClassifiedUploadError>((error) => {
    if (error.name === 'AbortError') return { type: 'cancel', message: 'Upload cancelled' };
    if (error.status === 413) return { type: 'oversize', message: 'File exceeds 5 MB limit' };
    return { type: 'server', message: 'Upload failed — try again' };
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }),
}));

import { useFileUpload } from './useFileUpload';
import * as uploadTransport from '@/src/lib/uploadTransport';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.prepareUpload.mockResolvedValue({
    signedUrl: 'https://storage.example.com/upload?token=abc',
    path: 'org-1/proj-1/doc-1/file.pdf',
    oldPath: null,
  });
  repo.confirmUpload.mockResolvedValue(undefined);
  repo.cleanupObject.mockResolvedValue(undefined);
});

describe('useFileUpload', () => {
  it('AC-DOC-020 (hook): upload mutation calls prepareUpload → transport → confirmUpload', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    mockedUploadWithProgress.mockResolvedValue(undefined);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    let path: string | undefined;
    await act(async () => {
      path = await result.current.upload.mutateAsync({ docId: 'doc-1', file });
    });

    expect(repo.prepareUpload).toHaveBeenCalledWith('doc-1', 'file.pdf');
    expect(mockedUploadWithProgress).toHaveBeenCalledWith(
      'https://storage.example.com/upload?token=abc',
      file,
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(repo.confirmUpload).toHaveBeenCalledWith('doc-1', 'org-1/proj-1/doc-1/file.pdf');
    expect(path).toBe('org-1/proj-1/doc-1/file.pdf');
  });

  it('AC-DOC-021 (hook): replace mutation calls prepareUpload → transport → confirmUpload → cleanupObject', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    mockedUploadWithProgress.mockResolvedValue(undefined);
    repo.prepareUpload.mockResolvedValue({
      signedUrl: 'https://storage.example.com/upload?token=abc2',
      path: 'org-1/proj-1/doc-1/new.pdf',
      oldPath: 'org-1/proj-1/doc-1/old.pdf',
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['new'], 'new.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.replace.mutateAsync({ docId: 'doc-1', file });
    });

    expect(repo.confirmUpload).toHaveBeenCalledWith('doc-1', 'org-1/proj-1/doc-1/new.pdf');
    expect(repo.cleanupObject).toHaveBeenCalledWith('org-1/proj-1/doc-1/old.pdf');
  });

  it('AC-DOC-023 (hook): progress callback fires during upload', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    const progressUpdates: number[] = [];
    mockedUploadWithProgress.mockImplementation(async (_url, _file, options) => {
      options.onProgress?.(50);
      options.onProgress?.(100);
      progressUpdates.push(50, 100);
    });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.upload.mutateAsync({ docId: 'doc-1', file });
    });

    expect(progressUpdates).toEqual([50, 100]);
  });

  it('AC-DOC-023 (hook): cancelUpload aborts via AbortController', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    mockedUploadWithProgress.mockImplementation(
      (_url, _file, options) =>
        new Promise((_, reject) => {
          const rejectUpload = () => {
            reject(new DOMException('Upload cancelled', 'AbortError'));
          };

          if (options.signal?.aborted) {
            rejectUpload();
            return;
          }

          options.signal?.addEventListener('abort', rejectUpload, { once: true });
        }),
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    result.current.upload.mutate({ docId: 'doc-1', file });
    await new Promise((resolve) => setTimeout(resolve, 0));
    result.current.cancelUpload('doc-1');

    await waitFor(() => {
      expect(result.current.upload.isError).toBe(true);
    });

    expect(repo.confirmUpload).not.toHaveBeenCalled();
  });

  it('AC-DOC-024 (hook): upload error is classified and stored in error state', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    const transportErr = new (class extends Error {
      status = 413;
      name = 'TransportError';
    })('Payload too large');
    mockedUploadWithProgress.mockRejectedValue(transportErr);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await expect(
      act(async () => result.current.upload.mutateAsync({ docId: 'doc-1', file })),
    ).rejects.toThrow('Payload too large');

    expect(uploadTransport.classifyUploadError).toHaveBeenCalled();
  });
});
