import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { FxParsed } from '@/src/lib/import/fxRateParser';
import FxRateUpload from './FxRateUpload';

const enCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8'),
);
const idCatalogue = JSON.parse(
  readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8'),
);
const h = vi.hoisted(() => ({ parseFile: vi.fn(), existing: vi.fn(), upsert: vi.fn() }));
vi.mock('@/src/lib/import/fxRateParser', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/import/fxRateParser')>(
    '@/src/lib/import/fxRateParser',
  );
  return { ...actual, parseFxFile: h.parseFile };
});
vi.mock('@/src/lib/repositories', () => ({
  repositories: { fxRates: { existing: h.existing, upsert: h.upsert } },
}));
vi.mock('@/src/hooks/useFxRates', () => ({
  useFxRateMutations: () => ({ upsert: { mutateAsync: h.upsert, isPending: false } }),
}));

const parsed = (date: string, rate: number, rejected: FxParsed['rejected'] = []): FxParsed => ({
  rows: [{ rate_date: date, rate }],
  rejected,
  duplicates: 1,
});
function renderUpload(canUpload = true, language: 'en' | 'id' = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onCommitted = vi.fn();
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: language,
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: { id: { common: idCatalogue }, en: { common: enCatalogue } },
    initImmediate: false,
  });
  const view = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <FxRateUpload
            today="2026-10-31"
            canUpload={canUpload}
            onClose={onClose}
            onCommitted={onCommitted}
          />
        </ToastProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return { ...view, onClose, onCommitted };
}
function selectFile(name = 'rates.csv') {
  const file = new File(['date,rate\n2026-10-12,16234.56'], name, { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText(/Choose BI Excel or date,rate CSV/), {
    target: { files: [file] },
  });
  return file;
}

beforeEach(() => {
  h.parseFile.mockReset();
  h.existing.mockReset();
  h.upsert.mockReset();
  h.parseFile.mockResolvedValue(parsed('2026-10-12', 16234.56));
  h.existing.mockResolvedValue([]);
});
afterEach(() => cleanup());

describe('AC-FX-007 JISDOR upload preview', () => {
  it('renders the upload title and native file-input label from the Indonesian catalogue', () => {
    renderUpload(true, 'id');
    expect(screen.getByRole('dialog', { name: 'Unggah kurs' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pilih file Excel BI atau CSV tanggal,kurs')).toBeInTheDocument();
  });

  it('renders the retry action from the Indonesian catalogue after existing-rate lookup fails', async () => {
    h.existing.mockRejectedValueOnce(new Error('offline'));
    renderUpload(true, 'id');
    const file = new File(['date,rate\n2026-10-12,16234.56'], 'rates.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('Pilih file Excel BI atau CSV tanggal,kurs'), {
      target: { files: [file] },
    });
    expect(
      await screen.findByText(/Kurs yang sudah ada tidak dapat diperiksa/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('normalizes a selected file into a preview without writing and disables commit for rejected rows', async () => {
    h.parseFile.mockResolvedValueOnce(
      parsed('2026-10-12', 16234.56, [{ row: 7, reason: 'invalidRate' }]),
    );
    renderUpload();
    selectFile();
    expect(await screen.findByText(/Row 7: Enter a rate/i)).toBeInTheDocument();
    expect(screen.getByText(/1 new/i)).toBeInTheDocument();
    expect(screen.getByText(/1 identical duplicate/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('retries existing-date lookup after failure and never classifies all rows as new on error', async () => {
    h.existing
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ rate_date: '2026-10-12', rate: 16234.56 }]);
    renderUpload();
    selectFile();
    expect(await screen.findByText(/Could not check existing rates/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 new/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/1 unchanged/i)).toBeInTheDocument();
    expect(h.existing).toHaveBeenCalledTimes(2);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('clears the old preview as soon as a newer file is selected', async () => {
    let resolve: ((value: FxParsed) => void) | undefined;
    h.parseFile.mockResolvedValueOnce(parsed('2026-10-12', 16234.56));
    h.parseFile.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderUpload();
    selectFile();
    expect(await screen.findByText('16,234.56')).toBeInTheDocument();
    selectFile('new-rates.csv');
    expect(screen.getByText('Reading rates…')).toBeInTheDocument();
    expect(screen.queryByText('16,234.56')).not.toBeInTheDocument();
    resolve?.(parsed('2026-10-13', 16300));
    expect(await screen.findByText('16,300')).toBeInTheDocument();
  });

  it('opens confirmation without writing and Cancel restores the normalized preview', async () => {
    renderUpload();
    selectFile();
    await screen.findByText('16,234.56');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(
      await screen.findByRole('dialog', { name: 'Save these JISDOR rates?' }),
    ).toBeInTheDocument();
    expect(h.upsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('dialog', { name: 'Upload rates' })).toBeInTheDocument();
    expect(screen.getByText('16,234.56')).toBeInTheDocument();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('uses one atomic write and reports actual committed counts, not preview counts', async () => {
    h.upsert.mockResolvedValueOnce({ new: 0, changed: 1, unchanged: 0 });
    const { onCommitted } = renderUpload();
    selectFile();
    await screen.findByText('16,234.56');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('button', { name: 'Save rates' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(onCommitted).toHaveBeenCalledWith({ new: 0, changed: 1, unchanged: 0 }),
    );
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert).toHaveBeenCalledWith([{ rate_date: '2026-10-12', rate: 16234.56 }]);
  });

  it('restores the preview with persistent error and values after a rejected atomic write', async () => {
    h.upsert.mockRejectedValueOnce(new Error('offline'));
    renderUpload();
    selectFile();
    await screen.findByText('16,234.56');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save rates' }));
    expect(await screen.findByRole('dialog', { name: 'Upload rates' })).toBeInTheDocument();
    expect(await screen.findByText(/Your rates were not saved/i)).toBeInTheDocument();
    expect(screen.getByText('16,234.56')).toBeInTheDocument();
  });

  it('blocks a view-only caller from selecting or committing a file', () => {
    renderUpload(false);
    expect(screen.getByLabelText(/Choose BI Excel or date,rate CSV/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(h.parseFile).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('does not let an out-of-order parse replace the latest selection', async () => {
    let resolveOld: ((value: FxParsed) => void) | undefined;
    let resolveNew: ((value: FxParsed) => void) | undefined;
    h.parseFile.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveOld = done;
        }),
    );
    h.parseFile.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolveNew = done;
        }),
    );
    renderUpload();
    selectFile('old.csv');
    selectFile('new.csv');
    resolveNew?.(parsed('2026-10-13', 16300));
    expect(await screen.findByText('16,300')).toBeInTheDocument();
    resolveOld?.(parsed('2026-10-12', 16234.56));
    await waitFor(() => expect(screen.getByText('16,300')).toBeInTheDocument());
    expect(screen.queryByText('16,234.56')).not.toBeInTheDocument();
  });
});
