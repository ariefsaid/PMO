import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { DocumentViewerProvider } from '@/src/components/documents/DocumentViewerProvider';

const RECEIPT = { id: 'f1', file_path: 'org/c1/f/receipt.pdf', title: null };
const SIGNED_URL = 'https://signed.test/org/c1/f/receipt.pdf';

const h = vi.hoisted(() => ({
  files: [] as Array<{ id: string; file_path: string; title: string | null }>,
  progress: null as number | null,
  upload: { mutate: vi.fn(), isPending: false },
  archive: { mutate: vi.fn(), isPending: false },
  download: vi.fn(),
  clearUploadError: vi.fn(),
}));

vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: h.files, isPending: false, isError: false },
    upload: h.upload,
    archive: h.archive,
    download: h.download,
    progress: h.progress,
    uploadError: null,
    clearUploadError: h.clearUploadError,
  }),
}));

import { ExpenseReceiptsCard } from './ExpenseReceiptsCard';

const card = (canWrite: boolean) => <ToastProvider><ExpenseReceiptsCard claimId="c1" canWrite={canWrite} /></ToastProvider>;
const renderCard = (canWrite: boolean) => render(card(canWrite));
// The Preview control opens the shared side panel, which needs its provider (and a router for it).
const renderCardWithViewer = (canWrite: boolean) =>
  render(
    <MemoryRouter>
      <DocumentViewerProvider>{card(canWrite)}</DocumentViewerProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  h.files = [RECEIPT];
  h.progress = null;
  h.upload.mutate.mockReset();
  h.archive.mutate.mockReset();
  h.clearUploadError.mockReset();
  h.download.mockReset();
  h.download.mockResolvedValue(SIGNED_URL);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('ExpenseReceiptsCard', () => {
  it('AC-EXP-066 every viewer can download; only a writer can attach or remove', () => {
    const { rerender } = renderCard(false);
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download receipt.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove receipt.pdf' })).toBeNull();
    rerender(card(true));
    expect(screen.getByRole('button', { name: 'Attach receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove receipt.pdf' })).toBeInTheDocument();
  });
});

// Floor tests (floor-tests/expense-claim-record.md rows 15-19).
describe('floor: receipt controls', () => {
  it('floor: Attach receipt uploads the file the writer picked', async () => {
    renderCard(true);
    const file = new File(['receipt bytes'], 'fuel-receipt.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Choose a receipt file'), file);

    await waitFor(() => expect(h.upload.mutate).toHaveBeenCalledTimes(1));
    expect(h.upload.mutate.mock.calls[0][0]).toBe(file);
    expect(h.clearUploadError).toHaveBeenCalled();
  });

  it('floor: upload progress replaces the Attach label while it runs', () => {
    const { rerender } = renderCard(true);
    expect(screen.getByRole('button', { name: 'Attach receipt' })).toBeInTheDocument();

    h.progress = 42;
    rerender(card(true));

    expect(screen.getByRole('button', { name: 'Uploading 42%' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Attach receipt' })).toBeNull();
  });

  it('floor: Preview receipt opens the panel on the fetched receipt', async () => {
    renderCardWithViewer(false);
    await userEvent.click(screen.getByRole('button', { name: 'Preview receipt' }));

    const frame = (await screen.findAllByTitle('receipt.pdf')).find((el) => el.tagName === 'IFRAME');
    expect(frame).toHaveAttribute('src', SIGNED_URL);
    expect(h.download.mock.calls[0][0]).toBe(RECEIPT.file_path);
  });

  it('floor: Download receipt saves that receipt file', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderCard(false);
    await userEvent.click(screen.getByRole('button', { name: 'Download receipt.pdf' }));

    await waitFor(() => expect(h.download).toHaveBeenCalledWith(RECEIPT.file_path, { download: true }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(SIGNED_URL, '_blank', 'noopener,noreferrer'));
  });

  it('floor: confirming Remove archives that receipt', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove receipt.pdf' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(h.archive.mutate).toHaveBeenCalledWith('f1', expect.anything());
  });

  it('floor: cancelling Remove keeps the receipt and writes nothing', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Remove receipt.pdf' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(h.archive.mutate).not.toHaveBeenCalled();
  });

  it('floor: a reader can download a receipt and is offered no write', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderCard(false);
    expect(screen.queryByRole('button', { name: 'Attach receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove receipt.pdf' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Download receipt.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(SIGNED_URL, '_blank', 'noopener,noreferrer'));
    expect(h.upload.mutate).not.toHaveBeenCalled();
    expect(h.archive.mutate).not.toHaveBeenCalled();
  });
});
