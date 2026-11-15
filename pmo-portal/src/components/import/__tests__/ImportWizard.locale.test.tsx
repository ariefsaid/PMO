/**
 * #1278 round A item 4 — the contract-lines import wizard reads Bahasa Indonesia from the SHIPPED
 * catalogues (never a hand-copied fixture): the wizard title, the Import button and a row error are
 * the Bahasa strings, and no inline English leaks through. The instance mirrors test/setup.ts's
 * synchronous init, but loads the real `import` namespace the wizard declares.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { createBoq, listBoq } = vi.hoisted(() => ({ createBoq: vi.fn(), listBoq: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { progressBilling: { createBoq, listBoq } } }));

vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';
import { ImportWizard } from '../ImportWizard';
import { makeContractLineImportDescriptor } from '@/src/lib/import/contractLineDescriptor';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';
import { AppError } from '@/src/lib/appError';

const catalogue = (lng: 'en' | 'id', namespace: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'public/locales', lng, `${namespace}.json`), 'utf8'));

function renderWizardUnderBahasa() {
  return renderWizard('id');
}

function renderWizard(lng: 'en' | 'id') {
  // The number formatters read the process-wide active locale, not the i18n instance: pin both.
  setActiveLocale({ locale: lng, numberLocale: lng, timezone: 'UTC' });
  const i18n = i18next.createInstance();
  void i18n.init({
    lng,
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
    listBoq.mockResolvedValue([]);
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

// ── #1278 round C ───────────────────────────────────────────────────────────────────────────────────────────

const HEADERS = {
  en: ['Line reference', 'Item code', 'Description', 'Unit', 'Quantity', 'Rate (USD)'],
  id: ['Referensi baris', 'Kode item', 'Deskripsi', 'Satuan', 'Kuantitas', 'Harga satuan (USD)'],
} as const;

async function toPreview(lng: 'en' | 'id', rows: string[][]) {
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: [...HEADERS[lng]], rows });
  const user = userEvent.setup();
  renderWizard(lng);
  await user.upload(screen.getByLabelText(lng === 'en' ? /choose an \.xlsx file/i : /pilih file \.xlsx/i), new File(['x'], 'lines.xlsx'));
  await user.click(await screen.findByRole('button', { name: lng === 'en' ? 'Next' : 'Lanjut' }));
  return user;
}

describe('#1278 round C', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBoq.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' });
  });

  describe('item 1: the preview shows the value that will be imported, in the reader\'s language', () => {
    it('Bahasa reads 18.1234 as eighteen point one two three four, never eighteen thousand', async () => {
      await toPreview('id', [['L-1', 'SVC-1', 'Trenching', 'm', '1200.5', '18.1234'], ['L-2', 'SVC-2', 'Cabling', 'm', '2500', 'abc']]);
      const table = await screen.findByRole('table');
      expect(within(table).getByText('18,1234')).toBeInTheDocument();
      expect(within(table).getByText('1.200,5')).toBeInTheDocument();
      expect(within(table).getByText('2.500')).toBeInTheDocument();
      expect(within(table).queryByText('18.1234')).toBeNull();
      expect(within(table).queryByText('1200.5')).toBeNull();
      // a cell that cannot be read keeps the file's own text, and its row says why
      expect(within(table).getByText('abc')).toBeInTheDocument();
      // both rows (18.1234 has too many decimals, abc is no number) say so in plain Bahasa
      expect(within(table).getAllByText('Harga satuan harus berupa angka 0 atau lebih (maksimal 2 desimal).')).toHaveLength(2);
    });

    it('English groups the same figures the English way', async () => {
      await toPreview('en', [['L-1', 'SVC-1', 'Trenching', 'm', '1200.5', '18.12'], ['L-2', 'SVC-2', 'Cabling', 'm', '2500', '7']]);
      const table = await screen.findByRole('table');
      expect(within(table).getByText('1,200.5')).toBeInTheDocument();
      expect(within(table).getByText('2,500')).toBeInTheDocument();
      expect(within(table).getByText('18.12')).toBeInTheDocument();
      expect(within(table).queryByText('1200.5')).toBeNull();
    });
  });

  describe('item 2: the Import button reads the plural', () => {
    it.each([
      ['en', 1, 'Import 1 contract line'],
      ['en', 2, 'Import 2 contract lines'],
      ['id', 1, 'Impor 1 baris kontrak'],
      ['id', 2, 'Impor 2 baris kontrak'],
    ] as const)('%s with %i valid row(s): "%s"', async (lng, n, name) => {
      const rows = Array.from({ length: n }, (_, i) => [`L-${i + 1}`, `SVC-${i + 1}`, 'Trenching', 'm', '5', '10']);
      await toPreview(lng, rows);
      expect(await screen.findByRole('button', { name })).toBeEnabled();
    });
  });

  describe('item 3: the result says what happened to every row', () => {
    const rows = [
      ['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'], // created
      ['L-2', 'SVC-2', 'Cabling', 'm', '0', '10'], // refused in preview
      ['L-3', 'SVC-3', 'Piping', 'm', '5', '10'], // already on the contract
      ['L-4', 'SVC-4', 'Ducting', 'm', 'abc', '10'], // refused in preview
    ];
    beforeEach(() => {
      createBoq.mockResolvedValueOnce({ id: 'new' }).mockRejectedValueOnce(new AppError('duplicate', '23505'));
    });

    it('English: created, the rows with errors, the already-imported row, each listed with its reason', async () => {
      const user = await toPreview('en', rows);
      await user.click(await screen.findByRole('button', { name: 'Import 2 contract lines' }));
      const summary = await screen.findByTestId('import-result-summary');
      expect(summary).toHaveTextContent('1 created, 2 skipped for errors, 1 skipped because already imported.');
      const list = screen.getByRole('list', { name: 'Rows not imported' });
      expect(within(list).getByText(/Row 2 \(SVC-2\):/)).toHaveTextContent('Quantity must be a number above 0');
      expect(within(list).getByText(/Row 4 \(SVC-4\):/)).toHaveTextContent('Quantity must be a number above 0');
      expect(within(list).getByText(/Row 3 \(SVC-3\):/)).toHaveTextContent('Already imported');
      expect(within(list).queryByText(/Row 1 /)).toBeNull();
    });

    it('Bahasa says the same in Bahasa', async () => {
      const user = await toPreview('id', rows);
      await user.click(await screen.findByRole('button', { name: 'Impor 2 baris kontrak' }));
      const summary = await screen.findByTestId('import-result-summary');
      expect(summary).toHaveTextContent('1 dibuat, 2 dilewati karena kesalahan, 1 dilewati karena sudah diimpor.');
      const list = screen.getByRole('list', { name: 'Baris yang tidak diimpor' });
      expect(within(list).getByText(/Baris 3 \(SVC-3\):/)).toHaveTextContent('Sudah diimpor');
    });

    it('no skipped part when nothing was skipped', async () => {
      createBoq.mockReset();
      createBoq.mockResolvedValue({ id: 'new' });
      const user = await toPreview('en', [rows[0]]);
      await user.click(await screen.findByRole('button', { name: 'Import 1 contract line' }));
      expect(await screen.findByTestId('import-result-summary')).toHaveTextContent(/^1 created\.$/);
      expect(screen.queryByRole('list', { name: 'Rows not imported' })).toBeNull();
    });
  });

  describe('item 4: the match columns name every field in plain words', () => {
    it.each([
      ['en', ['Line reference', 'Item code', 'Description', 'Unit', 'Quantity', 'Rate (USD)', 'Line number', 'Charged by'], /Unique for each line/],
      ['id', ['Referensi baris', 'Kode item', 'Deskripsi', 'Satuan', 'Kuantitas', 'Harga satuan (USD)', 'Nomor baris', 'Dikenakan per'], /Unik untuk setiap baris/],
    ] as const)('%s: labels, and a one-line explanation under the required reference', async (lng, labels, hint) => {
      vi.mocked(parseWorkbook).mockResolvedValue({ headers: [...HEADERS[lng]], rows: [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10']] });
      const user = userEvent.setup();
      renderWizard(lng);
      await user.upload(screen.getByLabelText(lng === 'en' ? /choose an \.xlsx file/i : /pilih file \.xlsx/i), new File(['x'], 'lines.xlsx'));
      for (const label of labels) expect(await screen.findByText(label, { selector: 'label' })).toBeInTheDocument();
      expect(screen.getByText(hint)).toBeInTheDocument();
      for (const jargon of ['Key', 'Line no', 'Basis', 'Kunci', 'No. baris', 'Dasar perolehan']) expect(screen.queryByText(jargon)).toBeNull();
    });

    it('a sheet that still says Key / Line no / Basis maps onto the renamed fields', async () => {
      vi.mocked(parseWorkbook).mockResolvedValue({
        headers: ['Key', 'Item code', 'Description', 'Unit', 'Quantity', 'Rate', 'Line no', 'Basis'],
        rows: [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10', '1', 'unit_rate']],
      });
      const user = userEvent.setup();
      renderWizard('en');
      await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), new File(['x'], 'lines.xlsx'));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled());
    });
  });

  describe('item 6: a phone preview card is headed by the row, not a bare number', () => {
    const phone = () =>
      vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null, addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      })));

    it.each([
      ['en', 'SVC-1 · Trenching', 'Row 2'],
      ['id', 'SVC-1 · Trenching', 'Baris 2'],
    ] as const)('%s: item code and description, "Row n" when both are empty', async (lng, title, fallback) => {
      phone();
      await toPreview(lng, [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'], ['L-2', '', '', 'm', '5', '10']]);
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.getByText(fallback)).toBeInTheDocument();
      // the heading already says the code and the description: the card does not repeat them
      expect(screen.queryByText(lng === 'en' ? 'Item code' : 'Kode item', { selector: 'dt' })).toBeNull();
      expect(screen.getAllByText(lng === 'en' ? 'Quantity' : 'Kuantitas', { selector: 'dt' }).length).toBeGreaterThan(0);
      // an optional field the sheet leaves empty is not listed with a bare dash
      expect(screen.queryByText(lng === 'en' ? 'Line number' : 'Nomor baris', { selector: 'dt' })).toBeNull();
    });
  });
});

// ── #1278 round D: the preview does not promise a line that will be skipped ─────────────────────────────

describe('#1278 round D', () => {
  const rows = [
    ['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'],
    ['L-2', 'SVC-2', 'Cabling', 'm', '5', '10'],
    ['L-3', 'SVC-3', 'Piping', 'm', '5', '10'],
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    createBoq.mockResolvedValue({ id: 'new' });
  });
  afterEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' }));

  const T = {
    en: { there: 'Already on this contract.', btn: 'Import 2 contract lines', none: 'Nothing to import: every valid line is already on this contract.', cannot: /Could not check for lines already on this contract/ },
    id: { there: 'Sudah ada di kontrak ini.', btn: 'Impor 2 baris kontrak', none: 'Tidak ada yang perlu diimpor: semua baris yang valid sudah ada di kontrak ini.', cannot: /Tidak dapat memeriksa baris yang sudah ada di kontrak ini/ },
  } as const;

  it.each(['en', 'id'] as const)('%s: a line already on the contract is flagged, not counted, and the button counts only the rest', async (lng) => {
    listBoq.mockResolvedValue([{ import_key: 'L-2' }]);
    await toPreview(lng, rows);
    expect(await screen.findByRole('button', { name: T[lng].btn })).toBeEnabled();
    expect(screen.getAllByText(T[lng].there)).toHaveLength(1);
    expect(screen.getByTestId('import-summary')).toHaveTextContent(lng === 'en' ? /2 valid, 0 invalid, 1 already there, 3 total/ : /2 valid, 0 tidak valid, 1 sudah ada, 3 total/);
  });

  it.each(['en', 'id'] as const)('%s: a line already there is "Skipped" in the neutral pill, not error red, and says so once', async (lng) => {
    listBoq.mockResolvedValue([{ import_key: 'L-2' }]);
    await toPreview(lng, rows);
    await screen.findByText(T[lng].there);
    const pill = screen.getByText(lng === 'en' ? 'Skipped' : 'Dilewati');
    const surface = pill.closest('[class*="bg-status-"]');
    expect(surface?.className).toContain('bg-status-neutral-surface');
    expect(surface?.className).not.toContain('bg-status-danger-surface');
    expect(screen.getByText(T[lng].there)).not.toHaveTextContent(/skipped|dilewati/i);
  });

  it.each(['en', 'id'] as const)('%s: every line already there: the button is disabled and the reason is written', async (lng) => {
    listBoq.mockResolvedValue(rows.map((r) => ({ import_key: r[0] })));
    await toPreview(lng, rows);
    expect(await screen.findByText(T[lng].none)).toBeInTheDocument();
    const button = screen.getByRole('button', { name: lng === 'en' ? 'Import 0 contract lines' : 'Impor 0 baris kontrak' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(T[lng].none);
  });

  it.each(['en', 'id'] as const)('%s: the read fails: one line says so, and every valid line can still be imported', async (lng) => {
    listBoq.mockRejectedValue(new Error('network'));
    const user = await toPreview(lng, rows);
    expect(await screen.findByText(T[lng].cannot)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: lng === 'en' ? 'Import 3 contract lines' : 'Impor 3 baris kontrak' }));
    expect(await screen.findByTestId('import-result-summary')).toHaveTextContent(lng === 'en' ? '3 created.' : '3 dibuat.');
  });

  it('the result lists a flagged line under already imported, and the insert-time skip stays the backstop', async () => {
    listBoq.mockResolvedValue([{ import_key: 'L-2' }]);
    createBoq.mockResolvedValueOnce({ id: 'a' }).mockRejectedValueOnce(new AppError('duplicate', '23505')); // L-3 added meanwhile
    const user = await toPreview('en', rows);
    await user.click(await screen.findByRole('button', { name: 'Import 2 contract lines' }));
    expect(await screen.findByTestId('import-result-summary')).toHaveTextContent('1 created, 2 skipped because already imported.');
    const list = screen.getByRole('list', { name: 'Rows not imported' });
    expect(within(list).getByText(/Row 2 \(SVC-2\):/)).toHaveTextContent('Already imported');
    expect(within(list).getByText(/Row 3 \(SVC-3\):/)).toHaveTextContent('Already imported');
    expect(createBoq).toHaveBeenCalledTimes(2);
  });
});

describe('#1278 round E item a: a failed row says it was not created, in the reader\'s language', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBoq.mockResolvedValue([]);
  });
  afterEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' }));

  it.each([['en', 'Row 1 (SVC-1): Not created: boom'], ['id', 'Baris 1 (SVC-1): Tidak dibuat: boom']] as const)('%s: "%s", never "Update failed"', async (lng, line) => {
    createBoq.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'b' });
    const user = await toPreview(lng, [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'], ['L-2', 'SVC-2', 'Cabling', 'm', '5', '10']]);
    await user.click(await screen.findByRole('button', { name: lng === 'en' ? 'Import 2 contract lines' : 'Impor 2 baris kontrak' }));
    const list = await screen.findByRole('list', { name: lng === 'en' ? 'Rows not imported' : 'Baris yang tidak diimpor' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(line);
    expect(list).not.toHaveTextContent(/Update failed/);
  });
});

describe('#1278 round E: the result title says "complete" only when every line was created', () => {
  const rows = [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'], ['L-2', 'SVC-2', 'Cabling', 'm', '5', '10']];
  const T = {
    en: { done: 'Import complete', some: 'Some lines were not imported', btn: 'Import 2 contract lines', btn1: 'Import 1 contract line' },
    id: { done: 'Impor selesai', some: 'Sebagian baris tidak diimpor', btn: 'Impor 2 baris kontrak', btn1: 'Impor 1 baris kontrak' },
  } as const;
  beforeEach(() => {
    vi.clearAllMocks();
    listBoq.mockResolvedValue([]);
    createBoq.mockResolvedValue({ id: 'b' });
  });
  afterEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' }));

  it.each(['en', 'id'] as const)('%s: every line created: "complete"', async (lng) => {
    const user = await toPreview(lng, rows);
    await user.click(await screen.findByRole('button', { name: T[lng].btn }));
    expect(await screen.findByRole('heading', { name: T[lng].done })).toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('%s: created + already there (not a failure): still "complete"', async (lng) => {
    listBoq.mockResolvedValue([{ import_key: 'L-2' }]);
    const user = await toPreview(lng, rows);
    await user.click(await screen.findByRole('button', { name: T[lng].btn1 }));
    expect(await screen.findByRole('heading', { name: T[lng].done })).toBeInTheDocument();
  });

  it.each(['en', 'id'] as const)('%s: created + one failed: "%s"', async (lng) => {
    createBoq.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'b' });
    const user = await toPreview(lng, rows);
    await user.click(await screen.findByRole('button', { name: T[lng].btn }));
    expect(await screen.findByRole('heading', { name: T[lng].some })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: T[lng].done })).toBeNull();
    // the sub-line is unchanged
    expect(screen.getByText(lng === 'en' ? 'Here is what happened.' : 'Begini hasilnya.')).toBeInTheDocument();
  });
});

describe('#1278 round F item 1: a skipped row never shares the failed row\'s red mark', () => {
  const rows = [['L-1', 'SVC-1', 'Trenching', 'm', '5', '10'], ['L-2', 'SVC-2', 'Cabling', 'm', '5', '10'], ['L-3', 'SVC-3', 'Piping', 'm', '5', '10']];
  beforeEach(() => { vi.clearAllMocks(); listBoq.mockResolvedValue([{ import_key: 'L-2' }]); });
  afterEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' }));

  it('the already-there row takes a neutral mark, the failed row keeps the red alert, and the two differ', async () => {
    createBoq.mockRejectedValueOnce(new Error('boom'));
    const user = await toPreview('en', rows);
    await user.click(await screen.findByRole('button', { name: 'Import 2 contract lines' }));
    const list = await screen.findByRole('list', { name: 'Rows not imported' });
    const mark = (re: RegExp) => within(list).getByText(re).closest('li')!.querySelector('svg')!;
    const skipped = mark(/Row 2 \(SVC-2\):/);
    const failed = mark(/Row 1 \(SVC-1\):/);
    expect(failed.getAttribute('data-icon')).toBe('alert');
    expect(failed.getAttribute('class')).toMatch(/text-destructive/);
    expect(skipped.getAttribute('data-icon')).not.toBe('alert');
    expect(skipped.getAttribute('class')).not.toMatch(/text-destructive/);
  });
});
