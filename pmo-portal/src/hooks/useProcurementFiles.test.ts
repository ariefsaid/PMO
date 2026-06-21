import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { ClassifiedUploadError, UploadTransportOptions } from '@/src/lib/uploadTransport';

interface PrepareResult {
  signedUrl: string;
  path: string;
  fileId: string;
}
interface MockUploadError {
  name?: string;
  status?: number;
  code?: string;
  message?: string;
}

const repo = vi.hoisted(() => ({
  list: vi.fn<(phase: string, parentId: string) => Promise<unknown[]>>(),
  prepareUpload:
    vi.fn<
      (
        phase: string,
        procurementId: string,
        fileName: string,
      ) => Promise<PrepareResult>
    >(),
  confirmUpload:
    vi.fn<
      (
        phase: string,
        parentId: string,
        path: string,
        title: string | null,
        uploadedById: string | null,
      ) => Promise<unknown>
    >(),
  archive: vi.fn<(phase: string, id: string) => Promise<void>>(),
  getSignedUrl: vi.fn<(filePath: string, opts?: { download?: boolean }) => Promise<string>>(),
  cleanupObject: vi.fn<(filePath: string) => Promise<void>>(),
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { procurementFiles: repo } }));
vi.mock('@/src/lib/uploadTransport', () => ({
  uploadWithProgress:
    vi.fn<(url: string, file: File | Blob, options: UploadTransportOptions) => Promise<void>>(),
  classifyUploadError: vi.fn<(error: MockUploadError) => ClassifiedUploadError>((error) => {
    if (error.name === 'AbortError') return { type: 'cancel', message: 'Upload cancelled' };
    return { type: 'server', message: 'Upload failed — try again' };
  }),
}));

import { useProcurementFiles } from './useProcurementFiles';
import * as uploadTransport from '@/src/lib/uploadTransport';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  repo.list.mockResolvedValue([]);
  repo.prepareUpload.mockResolvedValue({
    signedUrl: 'https://storage/upload?token=abc',
    path: 'org-1/proc-1/quotation/file-1/q.pdf',
    fileId: 'file-1',
  });
  repo.confirmUpload.mockResolvedValue({ id: 'row-1' });
  repo.archive.mockResolvedValue(undefined);
  (uploadTransport.uploadWithProgress as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

const file = new File(['x'], 'q.pdf', { type: 'application/pdf' });

describe('AC-PF-009 useProcurementFiles.upload', () => {
  it('AC-PF-009: upload calls prepareUpload → uploadWithProgress → confirmUpload and invalidates the phase query key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.upload.mutateAsync({ file });
    });

    expect(repo.prepareUpload).toHaveBeenCalledWith('quotation', 'proc-1', 'q.pdf');
    expect(uploadTransport.uploadWithProgress).toHaveBeenCalledTimes(1);
    // confirm fires AFTER transport, with the minted path + uploadedById = current user.
    expect(repo.confirmUpload).toHaveBeenCalledWith(
      'quotation',
      'q1',
      'org-1/proc-1/quotation/file-1/q.pdf',
      null,
      'user-9',
    );
    // order: prepare before transport before confirm
    const prepOrder = repo.prepareUpload.mock.invocationCallOrder[0];
    const transOrder = (uploadTransport.uploadWithProgress as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0];
    const confOrder = repo.confirmUpload.mock.invocationCallOrder[0];
    expect(prepOrder).toBeLessThan(transOrder);
    expect(transOrder).toBeLessThan(confOrder);

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['procurement-files', 'quotation', 'q1'],
      }),
    );
  });
});

describe('AC-PF-010 useProcurementFiles.archive', () => {
  it('AC-PF-010: archive calls repo.archive(phase,id) and invalidates the phase query key', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(
      () => useProcurementFiles('invoice', 'inv1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.archive.mutateAsync('file-77');
    });

    expect(repo.archive).toHaveBeenCalledWith('invoice', 'file-77');
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['procurement-files', 'invoice', 'inv1'],
      }),
    );
  });
});

describe('AC-PF-006 useProcurementFiles.download', () => {
  it('AC-PF-006: download delegates to the repo getSignedUrl with the path + opts', async () => {
    repo.getSignedUrl.mockResolvedValue('https://signed/dl');
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );
    const url = await result.current.download('org/proc/quotation/f/q.pdf', { download: true });
    expect(url).toBe('https://signed/dl');
    expect(repo.getSignedUrl).toHaveBeenCalledWith('org/proc/quotation/f/q.pdf', { download: true });
  });
});

describe('AC-PF-009 useProcurementFiles.upload error path', () => {
  it('AC-PF-009: a failed upload surfaces a classified uploadError and clears progress', async () => {
    (uploadTransport.uploadWithProgress as ReturnType<typeof vi.fn>).mockRejectedValue({
      status: 500,
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.upload.mutateAsync({ file }).catch(() => {});
    });
    await waitFor(() => expect(result.current.uploadError).not.toBeNull());
    expect(result.current.progress).toBeNull();
    expect(repo.confirmUpload).not.toHaveBeenCalled();
  });

  it('AC-PF-009: a failed confirmUpload (object already landed) cleans up the orphan storage object', async () => {
    repo.confirmUpload.mockRejectedValue({ code: '42501', message: 'denied' });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.upload.mutateAsync({ file }).catch(() => {});
    });
    // transport succeeded → the object is in the bucket → confirm rejected → orphan must be removed.
    expect(uploadTransport.uploadWithProgress).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(repo.cleanupObject).toHaveBeenCalledWith('org-1/proc-1/quotation/file-1/q.pdf'),
    );
    await waitFor(() => expect(result.current.uploadError).not.toBeNull());
  });

  it('AC-PF-009: a transport failure (object never landed) does NOT call cleanup', async () => {
    (uploadTransport.uploadWithProgress as ReturnType<typeof vi.fn>).mockRejectedValue({
      status: 500,
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.upload.mutateAsync({ file }).catch(() => {});
    });
    await waitFor(() => expect(result.current.uploadError).not.toBeNull());
    expect(repo.cleanupObject).not.toHaveBeenCalled();
  });

  it('AC-PF-009: a cancelled upload does NOT set an error (cancel is silent)', async () => {
    (uploadTransport.uploadWithProgress as ReturnType<typeof vi.fn>).mockRejectedValue({
      name: 'AbortError',
    });
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(
      () => useProcurementFiles('quotation', 'q1', 'proc-1', 'user-9'),
      { wrapper: Wrapper },
    );
    await act(async () => {
      await result.current.upload.mutateAsync({ file }).catch(() => {});
    });
    expect(result.current.uploadError).toBeNull();
  });
});
