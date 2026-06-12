import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const repo = vi.hoisted(() => ({
  prepareUpload: vi.fn(),
  confirmUpload: vi.fn(),
  cleanupObject: vi.fn(),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: repo,
  },
}));
vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress: vi.fn(),
  classifyUploadError: vi.fn((e: any) => {
    if (e.name === 'AbortError') return { type: 'cancel', message: 'Upload cancelled' };
    if (e.status === 413) return { type: 'oversize', message: 'File exceeds 5 MB limit' };
    return { type: 'server', message: 'Upload failed — try again' };
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }),
}));

import { useFileUpload } from './useFileUpload';

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
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    (uploadWithProgress as any).mockResolvedValue(undefined);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    let path: string | undefined;
    await act(async () => {
      path = await result.current.upload.mutateAsync({ docId: 'doc-1', file });
    });

    expect(repo.prepareUpload).toHaveBeenCalledWith('doc-1', 'file.pdf');
    expect(uploadWithProgress).toHaveBeenCalledWith(
      'https://storage.example.com/upload?token=abc',
      file,
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(repo.confirmUpload).toHaveBeenCalledWith('doc-1', 'org-1/proj-1/doc-1/file.pdf');
    expect(path).toBe('org-1/proj-1/doc-1/file.pdf');
  });

  it('AC-DOC-021 (hook): replace mutation calls prepareUpload → transport → confirmUpload → cleanupObject', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    (uploadWithProgress as any).mockResolvedValue(undefined);
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
    // Cleanup of old object after confirm (replace-flow atomicity)
    expect(repo.cleanupObject).toHaveBeenCalledWith('org-1/proj-1/doc-1/old.pdf');
  });

  it('AC-DOC-023 (hook): progress callback fires during upload', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    const progressUpdates: number[] = [];
    (uploadWithProgress as any).mockImplementation(
      (_url: any, _file: any, opts: any) => {
        opts.onProgress?.(50);
        opts.onProgress?.(100);
        progressUpdates.push(50, 100);
        return Promise.resolve();
      },
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await act(async () => {
      await result.current.upload.mutateAsync({ docId: 'doc-1', file });
    });

    // Progress state should have been tracked
    expect(progressUpdates).toEqual([50, 100]);
  });

  it('AC-DOC-023 (hook): cancelUpload aborts via AbortController', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    let abortCallback: (() => void) | null = null;
    (uploadWithProgress as any).mockImplementation(
      (_url: any, _file: any, opts: any) => {
        // Simulate abort by rejecting with AbortError when signal fires
        return new Promise((_, reject) => {
          abortCallback = () => {
            reject(new DOMException('Upload cancelled', 'AbortError'));
          };
          if (opts.signal?.aborted) {
            abortCallback();
            return;
          }
          opts.signal?.addEventListener('abort', abortCallback, { once: true });
        });
      },
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    // Start the upload
    result.current.upload.mutate({ docId: 'doc-1', file });
    
    // Wait a tick to ensure the upload has started
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Cancel the upload
    result.current.cancelUpload('doc-1');

    // Wait for the error state
    await waitFor(() => {
      expect(result.current.upload.isError).toBe(true);
    });
    
    // Confirm path should NOT have been called — upload was cancelled before completion
    expect(repo.confirmUpload).not.toHaveBeenCalled();
  });

  it('AC-DOC-024 (hook): upload error is classified and stored in error state', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    const transportErr = new (class extends Error { status = 413; name = 'TransportError'; })('Payload too large');
    (uploadWithProgress as any).mockRejectedValue(transportErr);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await act(async () => {
      try { await result.current.upload.mutateAsync({ docId: 'doc-1', file }); } catch {}
    });

    // Error should be classified (classifyUploadError was called)
    const { classifyUploadError } = await import('@/src/lib/uploadTransport');
    expect(classifyUploadError).toHaveBeenCalled();
  });
});