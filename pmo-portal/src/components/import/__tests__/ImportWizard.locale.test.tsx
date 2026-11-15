/**
 * #1278 round A item 4 — the contract-lines import wizard reads Bahasa Indonesia from the SHIPPED
 * catalogues (never a hand-copied fixture): the wizard title, the Import button and a row error are
 * the Bahasa strings, and no inline English leaks through. The instance mirrors test/setup.ts's
 * synchronous init, but loads the real `import` namespace the wizard declares.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { createBoq } = vi.hoisted(() => ({ createBoq: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: { createBoq } } }));

vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';
import { ImportWizard } from '../ImportWizard';
import { makeContractLineImportDescriptor } from '@/src/lib/import/contractLineDescriptor';

const catalogue = (lng: 'en' | 'id', namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public/locales', lng, `${namespace}.json`), 'utf8'));

function renderWizardUnderBahasa() {
  const i18n = i18next.createInstance();
  void i18n.init({
    lng: 'id',
    fallbackLng: 'en',
    defaultNS: 'common',
    resources: {
      id: { import: catalogue('id', 'import') },
      en: { import: catalogue('en', 'import') },
    },
    initImmediate: false, // synchronous init — no async gap before the first render
    interpolation: { escapeValue: false },
  });
  const descriptor = makeContractLineImportDescriptor('p1', i18n.t.bind(i18n), 'USD');
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/projects/p1/billing']}>
        <ImportWizard descriptor={descriptor} onClose={vi.fn()} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('the contract-lines import wizard reads Bahasa (#1278 round A item 4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parseWorkbook).mockResolvedValue({
      // Bahasa-headed sheet, so autoMap matches the Bahasa field labels (a real Bahasa upload;
      // the rate header reads exactly what the UI shows — label + currency, round A item 7).
      headers: ['Kunci', 'Kode item', 'Deskripsi', 'Satuan', 'Kuantitas', 'Harga satuan (USD)'],
      rows: [['L-1', 'SVC-1', 'Trenching', 'm', '0', '5']],
    });
  });

  it('titles the wizard and the upload box in Bahasa', () => {
    renderWizardUnderBahasa();
    expect(screen.getByRole('heading', { name: 'Impor baris kontrak' })).toBeInTheDocument();
    expect(screen.getByText('Pilih file .xlsx')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Batal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Import contract lines' })).toBeNull();
    expect(screen.queryByText('Choose an .xlsx file')).toBeNull();
  });

  it('the Import button and the rate header carry Bahasa + the project currency, and the quantity error is the Bahasa sentence', async () => {
    const user = userEvent.setup();
    renderWizardUnderBahasa();
    await user.upload(screen.getByLabelText(/pilih file \.xlsx/i), new File(['x'], 'lines.xlsx'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Lanjut' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Lanjut' }));

    // Round A item 6: the internal Key holds no preview column.
    expect(screen.queryByRole('columnheader', { name: 'Kunci' })).toBeNull();
    // Round A item 7: the rate header names the project currency once, in Bahasa.
    expect(screen.getByRole('columnheader', { name: 'Harga satuan (USD)' })).toBeInTheDocument();
    // Round A item 3: the plain Bahasa sentence, never the CLI words.
    expect(await screen.findByText('Kuantitas harus berupa angka di atas 0 (maksimal 3 desimal).')).toBeInTheDocument();
    expect(screen.queryByText(/positive number below/)).toBeNull();
    // The refused row is still explained on its status, even with its Key column hidden.
    expect(screen.getAllByText('Dilewati').length).toBeGreaterThan(0);
    // Round A item 4: the Import button reads Bahasa (disabled — every row is skipped, zero writes).
    expect(screen.getByRole('button', { name: 'Impor 0 baris kontrak' })).toBeDisabled();
    expect(createBoq).not.toHaveBeenCalled();
  });
});
