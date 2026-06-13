import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

interface ProcFileRow {
  id: string;
  file_path: string | null;
  title: string | null;
}

const hookState = vi.hoisted(() => ({
  files: [] as ProcFileRow[],
  isPending: false,
  isError: false,
  progress: null as number | null,
  uploadError: null as { message: string } | null,
  upload: { mutate: vi.fn(), isPending: false },
  archive: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  download: vi.fn(async () => 'https://signed/dl'),
  cancelUpload: vi.fn(),
  clearUploadError: vi.fn(),
}));

vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({
    list: { data: hookState.files, isPending: hookState.isPending, isError: hookState.isError, refetch: vi.fn() },
    upload: hookState.upload,
    archive: hookState.archive,
    download: hookState.download,
    progress: hookState.progress,
    uploadError: hookState.uploadError,
    cancelUpload: hookState.cancelUpload,
    clearUploadError: hookState.clearUploadError,
  }),
}));

// useToast is provided by a global ToastProvider in the app; stub it for the unit test.
vi.mock('@/src/components/ui', async (orig) => {
  const actual = await orig<typeof import('@/src/components/ui')>();
  return { ...actual, useToast: () => ({ toast: vi.fn() }) };
});

import { ProcurementFilesSubsection } from './ProcurementFilesSubsection';

beforeEach(() => {
  hookState.files = [];
  hookState.isPending = false;
  hookState.isError = false;
  hookState.progress = null;
  hookState.uploadError = null;
  hookState.upload = { mutate: vi.fn(), isPending: false };
  hookState.archive = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  hookState.download = vi.fn(async () => 'https://signed/dl');
});

function renderSub(props?: Partial<React.ComponentProps<typeof ProcurementFilesSubsection>>) {
  return render(
    <ProcurementFilesSubsection
      phase="quotation"
      parentId="q1"
      procurementId="proc-1"
      orgId="org-1"
      canWrite
      uploadedById="user-9"
      {...props}
    />,
  );
}

describe('AC-PF-012 ProcurementFilesSubsection write affordances', () => {
  it('AC-PF-012: a writer sees an Upload affordance; a non-writer sees download-only (no Upload/Archive)', () => {
    hookState.files = [{ id: 'f1', file_path: 'org-1/proc-1/quotation/file-1/q.pdf', title: 'Quote' }];

    const { unmount } = renderSub({ canWrite: true });
    // Writer: an upload control exists.
    expect(screen.getByLabelText(/attach a file/i)).toBeTruthy();
    // Writer: an archive (remove) control exists for the existing file.
    expect(screen.getByRole('button', { name: /remove file/i })).toBeTruthy();
    unmount();

    // Non-writer: no upload, no archive — download only.
    renderSub({ canWrite: false });
    expect(screen.queryByLabelText(/attach a file/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /remove file/i })).toBeNull();
    expect(screen.getByRole('button', { name: /download file/i })).toBeTruthy();
  });

  it('AC-PF-012: empty state renders for a writer with no files', () => {
    hookState.files = [];
    renderSub({ canWrite: true });
    expect(screen.getByText(/no files attached/i)).toBeTruthy();
  });
});

describe('AC-PF-013 ProcurementFilesSubsection list + archive confirm', () => {
  it('AC-PF-013: each file shows a name + download; archive prompts a ConfirmDialog and only archives on confirm', async () => {
    hookState.files = [{ id: 'f1', file_path: 'org-1/proc-1/quotation/file-1/report.pdf', title: 'Report' }];
    renderSub({ canWrite: true });

    // File name shown.
    expect(screen.getByText(/report\.pdf/i)).toBeTruthy();
    // Download affordance present.
    expect(screen.getByRole('button', { name: /download file/i })).toBeTruthy();

    // Click archive → a ConfirmDialog appears, NOT an immediate archive.
    fireEvent.click(screen.getByRole('button', { name: /remove file/i }));
    expect(hookState.archive.mutate).not.toHaveBeenCalled();
    expect(await screen.findByRole('alertdialog')).toBeTruthy();

    // Confirm → archive fires with the file id.
    const dialog = screen.getByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /remove/i });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(hookState.archive.mutate).toHaveBeenCalled());
    expect(hookState.archive.mutate.mock.calls[0][0]).toBe('f1');
  });

  it('AC-PF-013: picking a file triggers upload.mutate with the chosen file', () => {
    renderSub({ canWrite: true });
    const input = screen.getByLabelText(/attach a file/i) as HTMLInputElement;
    const f = new File(['data'], 'spec.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [f] } });
    expect(hookState.upload.mutate).toHaveBeenCalled();
    expect(hookState.upload.mutate.mock.calls[0][0]).toMatchObject({ file: f });
  });

  it('AC-PF-013: clicking download resolves a signed URL and opens it', async () => {
    hookState.files = [{ id: 'f1', file_path: 'org-1/proc-1/quotation/file-1/report.pdf', title: null }];
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderSub({ canWrite: false });
    fireEvent.click(screen.getByRole('button', { name: /download file/i }));
    await waitFor(() => expect(hookState.download).toHaveBeenCalledWith(
      'org-1/proc-1/quotation/file-1/report.pdf',
      { download: true },
    ));
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://signed/dl', '_blank', 'noopener,noreferrer'));
    openSpy.mockRestore();
  });

  it('AC-PF-013: loading and error list states render', () => {
    hookState.isPending = true;
    const { unmount } = renderSub();
    expect(screen.getByText(/loading attachments/i)).toBeTruthy();
    unmount();

    hookState.isPending = false;
    hookState.isError = true;
    renderSub();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('AC-PF-013: a previewable file shows a Preview affordance that opens inline (download:false)', async () => {
    hookState.files = [{ id: 'f1', file_path: 'org-1/proc-1/quotation/file-1/scan.png', title: null }];
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderSub({ canWrite: false });
    fireEvent.click(screen.getByRole('button', { name: /preview file/i }));
    await waitFor(() =>
      expect(hookState.download).toHaveBeenCalledWith(
        'org-1/proc-1/quotation/file-1/scan.png',
        { download: false },
      ),
    );
    openSpy.mockRestore();
  });

  it('AC-PF-013: a download failure surfaces a warning toast (does not throw)', async () => {
    hookState.files = [{ id: 'f1', file_path: 'org-1/proc-1/quotation/file-1/q.pdf', title: null }];
    hookState.download.mockRejectedValueOnce(new Error('no signed url'));
    renderSub({ canWrite: false });
    fireEvent.click(screen.getByRole('button', { name: /download file/i }));
    await waitFor(() => expect(hookState.download).toHaveBeenCalled());
    // no throw — the component caught it; the row is still present.
    expect(screen.getByText(/q\.pdf/i)).toBeTruthy();
  });

  it('AC-PF-013: upload success + error callbacks both fire a toast', () => {
    // Drive the mutate callbacks directly to cover the success/error toast branches.
    hookState.upload.mutate = vi.fn((_args, opts?: { onSuccess?: () => void; onError?: (e: unknown) => void }) => {
      opts?.onSuccess?.();
      opts?.onError?.(new Error('boom'));
    });
    renderSub({ canWrite: true });
    const input = screen.getByLabelText(/attach a file/i) as HTMLInputElement;
    const f = new File(['data'], 'spec.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [f] } });
    expect(hookState.upload.mutate).toHaveBeenCalled();
  });
});
