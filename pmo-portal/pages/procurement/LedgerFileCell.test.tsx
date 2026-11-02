// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { UploadFailure } from '@/src/lib/m365/uploadClient';

const h = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('@/src/hooks/useProcurementFiles', () => ({
  useProcurementFiles: () => ({
    list: { data: [{ id: 'f1', title: 'a.pdf', file_path: 'p/a.pdf', archived_at: null }, { id: 'f2', title: 'b.pdf', file_path: 'p/b.pdf', archived_at: null }], isPending: false, isError: false },
    archive: { mutate: vi.fn(), isPending: false }, progress: null, uploadError: null, clearUploadError: vi.fn(),
    upload: { mutate: h.mutate, isPending: false }, uploadDisabled: false, download: vi.fn() }),
}));

import { LedgerFileCell } from './LedgerFileCell';

describe('document-preview AC-008 ledger attach shows the typed SharePoint recovery', () => {
  it('a SharePoint failure toasts its recovery text, not a generic headline', async () => {
    h.mutate.mockImplementation((_args, opts?: { onError?: (e: unknown) => void }) => opts?.onError?.(new UploadFailure('folder')));
    render(
      <ToastProvider>
        <LedgerFileCell type="GR" recordId="gr-1" systemNumber="GR-1" fileHref={null} fileTitle={null} fileCount={0} canWrite procurementId="pr-1" uploadedById={null} />
      </ToastProvider>,
    );
    fireEvent.change(screen.getByLabelText(/attach a file to this record/i), { target: { files: [new File(['x'], 'dn.pdf', { type: 'application/pdf' })] } });
    expect((await screen.findAllByText(/no SharePoint folder yet.*Nothing was saved/)).length).toBeGreaterThan(0);
  });
});

describe('ledger multi-file cell', () => {
  it('clicking "N files" opens a list of the record\'s files', async () => {
    render(
      <ToastProvider>
        <LedgerFileCell type="GR" recordId="gr-1" systemNumber="GR-1" fileHref="p/a.pdf" fileTitle="a.pdf" fileCount={2} canWrite={false} procurementId="pr-1" uploadedById={null} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /2 files for GR-1/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('b.pdf')).toBeInTheDocument();
  });
});
