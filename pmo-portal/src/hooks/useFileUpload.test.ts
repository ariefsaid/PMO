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
  code?: string;
  message?: string;
}

const repo = vi.hoisted(() => ({
  prepareUpload: vi.fn<(docId: string, fileName: string) => Promise<PrepareUploadResult>>(),
  confirmUpload: vi.fn<(docId: string, path: string) => Promise<void>>(),
  cleanupObject: vi.fn<(filePath: string) => Promise<void>>(),
  attachMicrosoftUpload: vi.fn<(docId: string, reference: unknown) => Promise<void>>(),
}));
const msUpload = vi.hoisted(() => vi.fn());
vi.mock('@/src/lib/m365/uploadClient', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/m365/uploadClient')>()),
  uploadRecordFile: msUpload,
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
    if (error.code === '42501') return { type: 'server', message: 'Upload failed — try again' };
    return { type: 'server', message: 'Upload failed — try again' };
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }),
}));

import { useFileUpload } from './useFileUpload';
import { UploadFailure } from '@/src/lib/m365/uploadClient';
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
  repo.attachMicrosoftUpload.mockResolvedValue(undefined);
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

    act(() => {
      result.current.upload.mutate({ docId: 'doc-1', file });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => {
      result.current.cancelUpload('doc-1');
    });

    await waitFor(() => {
      expect(result.current.upload.isError).toBe(true);
    });

    expect(repo.confirmUpload).not.toHaveBeenCalled();
  });

  it('harden #5: transport OK but confirmUpload fails → the orphaned object is cleaned up + error rethrown', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    // Transport succeeds → the object is now in the bucket.
    mockedUploadWithProgress.mockResolvedValue(undefined);
    // But the confirm INSERT fails (e.g. RLS reject) → without cleanup the object orphans.
    const confirmError = { code: '42501', message: 'row-level security' };
    repo.confirmUpload.mockRejectedValue(confirmError);

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await expect(
      act(async () => result.current.upload.mutateAsync({ docId: 'doc-1', file })),
    ).rejects.toEqual(confirmError);

    // The just-uploaded object MUST be cleaned up best-effort so it does not orphan.
    expect(repo.cleanupObject).toHaveBeenCalledWith('org-1/proj-1/doc-1/file.pdf');
  });

  it('AC-DOC-024 (hook): upload error is stored with the approved copy and cleared on Remove', async () => {
    const mockedUploadWithProgress = vi.mocked(uploadTransport.uploadWithProgress);
    mockedUploadWithProgress.mockRejectedValue({ code: '42501', message: 'storage unavailable' });

    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
    const file = new File(['content'], 'file.pdf', { type: 'application/pdf' });

    await expect(
      act(async () => result.current.upload.mutateAsync({ docId: 'doc-1', file })),
    ).rejects.toEqual({ code: '42501', message: 'storage unavailable' });

    await waitFor(() => {
      expect(result.current.uploadErrors['doc-1']).toEqual({
        type: 'server',
        message: 'Upload failed — try again',
      });
    });

    act(() => {
      result.current.clearUploadError('doc-1');
    });

    expect(result.current.uploadErrors['doc-1']).toBeUndefined();
  });

  describe('document-preview AC-007 / AC-009 destination', () => {
    const REF = { drive_id: 'd', item_id: 'i1', web_url: 'https://tenant.sharepoint.com/sites/x/file.pdf', name: 'file.pdf', item_kind: 'file' };
    const file = () => new File(['content'], 'file.pdf', { type: 'application/pdf' });

    it('AC-009: the private destination (default and explicit) never touches SharePoint', async () => {
      vi.mocked(uploadTransport.uploadWithProgress).mockResolvedValue(undefined);
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
      await act(async () => { await result.current.upload.mutateAsync({ docId: 'doc-1', file: file(), destination: 'private' }); });
      expect(msUpload).not.toHaveBeenCalled();
      expect(repo.attachMicrosoftUpload).not.toHaveBeenCalled();
      expect(repo.prepareUpload).toHaveBeenCalledWith('doc-1', 'file.pdf');
      expect(repo.confirmUpload).toHaveBeenCalled();
    });

    it('AC-007: the Microsoft destination uploads through custody then attaches with ONE repository call; no Storage call', async () => {
      msUpload.mockResolvedValue(REF);
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
      const f = file();
      await act(async () => { await result.current.upload.mutateAsync({ docId: 'doc-1', file: f, destination: 'microsoft' }); });
      expect(msUpload).toHaveBeenCalledWith({ kind: 'project_document', id: 'doc-1' }, f, expect.any(AbortSignal));
      expect(repo.attachMicrosoftUpload).toHaveBeenCalledTimes(1);
      expect(repo.attachMicrosoftUpload).toHaveBeenCalledWith('doc-1', REF);
      expect(repo.prepareUpload).not.toHaveBeenCalled();
      expect(uploadTransport.uploadWithProgress).not.toHaveBeenCalled();
      expect(repo.confirmUpload).not.toHaveBeenCalled();
    });

    it('AC-007: a replace removes the old private object only AFTER the attach landed', async () => {
      const order: string[] = [];
      msUpload.mockResolvedValue(REF);
      repo.attachMicrosoftUpload.mockImplementation(async () => { order.push('attach'); });
      repo.cleanupObject.mockImplementation(async () => { order.push('cleanup'); });
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
      await act(async () => { await result.current.replace.mutateAsync({ docId: 'doc-1', file: file(), destination: 'microsoft', oldPath: 'org/p/d/old.pdf' }); });
      expect(order).toEqual(['attach', 'cleanup']);
      expect(repo.cleanupObject).toHaveBeenCalledWith('org/p/d/old.pdf');
    });

    it.each(['folder', 'consent', 'connection', 'access', 'entitlement', 'unavailable'] as const)(
      'AC-008: a %s failure keeps the previous attachment, states nothing was saved and never falls back to private storage',
      async (kind) => {
        msUpload.mockRejectedValue(new UploadFailure(kind));
        const { Wrapper } = makeWrapper();
        const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
        await expect(act(async () => result.current.replace.mutateAsync({ docId: 'doc-1', file: file(), destination: 'microsoft', oldPath: 'org/p/d/old.pdf' }))).rejects.toBeInstanceOf(UploadFailure);
        await waitFor(() => expect(result.current.uploadErrors['doc-1']?.message).toMatch(/Nothing was saved/));
        expect(repo.attachMicrosoftUpload).not.toHaveBeenCalled();
        expect(repo.cleanupObject).not.toHaveBeenCalled();
        expect(repo.prepareUpload).not.toHaveBeenCalled();
        expect(uploadTransport.uploadWithProgress).not.toHaveBeenCalled();
      },
    );

    it('AC-007: if the attach is refused the old private file is untouched and the copy says to link the SharePoint file', async () => {
      msUpload.mockResolvedValue(REF);
      repo.attachMicrosoftUpload.mockRejectedValue({ code: '42501', message: 'rls' });
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
      await expect(act(async () => result.current.replace.mutateAsync({ docId: 'doc-1', file: file(), destination: 'microsoft', oldPath: 'org/p/d/old.pdf' }))).rejects.toBeInstanceOf(UploadFailure);
      expect(repo.cleanupObject).not.toHaveBeenCalled();
      await waitFor(() => expect(result.current.uploadErrors['doc-1']?.message).toMatch(/Link it from the Microsoft picker/));
    });

    it('AC-007: cancelling aborts the custody request and shows no error', async () => {
      msUpload.mockImplementation((_t: unknown, _f: unknown, signal: AbortSignal) => new Promise((_res, rej) => {
        signal.addEventListener('abort', () => rej(new UploadFailure('cancelled')));
      }));
      const { Wrapper } = makeWrapper();
      const { result } = renderHook(() => useFileUpload('proj1'), { wrapper: Wrapper });
      let pending!: Promise<unknown>;
      act(() => { pending = result.current.upload.mutateAsync({ docId: 'doc-1', file: file(), destination: 'microsoft' }).catch(() => {}); });
      await waitFor(() => expect(msUpload).toHaveBeenCalled());
      act(() => result.current.cancelUpload('doc-1'));
      await act(async () => { await pending; });
      expect(result.current.uploadErrors['doc-1']).toBeUndefined();
      expect(repo.attachMicrosoftUpload).not.toHaveBeenCalled();
    });
  });
});
