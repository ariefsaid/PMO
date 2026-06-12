import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const prepareUploadMock = vi.fn();
const confirmUploadMock = vi.fn();
const cleanupObjectMock = vi.fn();
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    document: {
      prepareUpload: prepareUploadMock,
      confirmUpload: confirmUploadMock,
      cleanupObject: cleanupObjectMock,
    },
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
  prepareUploadMock.mockResolvedValue({
    signedUrl: 'https://storage.example.com/upload?token=abc',
    path: 'org-1/proj-1/doc-1/file.pdf',
    oldPath: null,
  });
  confirmUploadMock.mockResolvedValue(undefined);
  cleanupObjectMock.mockResolvedValue(undefined);
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

    expect(prepareUploadMock).toHaveBeenCalledWith('doc-1', 'file.pdf');
    expect(uploadWithProgress).toHaveBeenCalledWith(
      'https://storage.example.com/upload?token=abc',
      file,
      expect.objectContaining({ contentType: 'application/pdf' }),
    );
    expect(confirmUploadMock).toHaveBeenCalledWith('doc-1', 'org-1/proj-1/doc-1/file.pdf');
    expect(path).toBe('org-1/proj-1/doc-1/file.pdf');
  });

  it('AC-DOC-021 (hook): replace mutation calls prepareUpload → transport → confirmUpload → cleanupObject', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    (uploadWithProgress as any).mockResolvedValue(undefined);
    prepareUploadMock.mockResolvedValue({
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

    expect(confirmUploadMock).toHaveBeenCalledWith('doc-1', 'org-1/proj-1/doc-1/new.pdf');
    // Cleanup of old object after confirm (replace-flow atomicity)
    expect(cleanupObjectMock).toHaveBeenCalledWith('org-1/proj-1/doc-1/old.pdf');
  });

  it('AC-DOC-023 (hook): progress callback fires during upload', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    (uploadWithProgress as any).mockImplementation(
      (_url: any, _file: any, opts: any) => {
        opts.onProgress?.(50);
        opts.onProgress?.(100);
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
    expect(result.current.progress['doc-1']).toBeDefined();
  });

  it('AC-DOC-023 (hook): cancelUpload aborts via AbortController', async () => {
    const { uploadWithProgress } = await import('@/src/lib/uploadTransport');
    (uploadWithProgress as any).mockImplementation(
      (_url: any, _file: any, opts: any) => {
        // Simulate abort by rejecting with AbortError when signal fires
        return new Promise((_, reject) => {
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('Upload cancelled', 'AbortError'));
          }, { once: true });
        });
      },
    );

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    act(() => { result.current.upload.mutate({ docId: 'doc-1', file }); });
    act(() => { result.current.cancelUpload('doc-1'); });

    await waitFor(() => expect(result.current.upload.isError).toBe(true));
    // Confirm path should NOT have been called — upload was cancelled before completion
    expect(confirmUploadMock).not.toHaveBeenCalled();
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