/**
 * AC-PIU-001/002/005/010/011 — the people import wizard previews adds and changes (old to new) in the reader's
 * language from the SHIPPED catalogues, writes nothing until the confirm, then adds and updates.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { I18nextProvider } from 'react-i18next';
import i18next from 'i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue({}), updateFields: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { people: { create: h.create, updateFields: h.updateFields } } }));
vi.mock('@/src/lib/import', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/import')>();
  return { ...actual, parseWorkbook: vi.fn() };
});
import { parseWorkbook } from '@/src/lib/import';
import { ImportWizard } from '../ImportWizard';
import { makePeopleImportDescriptor } from '@/src/lib/import/employeeDescriptor';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const catalogue = (lng: 'en' | 'id') => JSON.parse(readFileSync(join(process.cwd(), 'public/locales', lng, 'import.json'), 'utf8'));
const stored = [{ id: 'a', code: 'P-0001', name: 'Ana', job_title: null, profile_id: null, manager_id: null, archived_at: null }];

function renderWizard(lng: 'en' | 'id', people = async () => stored) {
  setActiveLocale({ locale: lng, numberLocale: lng, timezone: 'UTC' });
  const i18n = i18next.createInstance();
  void i18n.init({ lng, fallbackLng: 'en', defaultNS: 'common', resources: { en: { import: catalogue('en') }, id: { import: catalogue('id') } }, initImmediate: false, interpolation: { escapeValue: false } });
  const descriptor = makePeopleImportDescriptor({ people, managers: [] }, i18n.t.bind(i18n));
  return render(<I18nextProvider i18n={i18n}><MemoryRouter><ImportWizard descriptor={descriptor} onClose={vi.fn()} /></MemoryRouter></I18nextProvider>);
}
const HEADERS = { en: ['Employee code', 'Display name'], id: ['Kode karyawan', 'Nama tampilan'] } as const;
async function toPreview(lng: 'en' | 'id', people?: () => Promise<typeof stored>) {
  vi.mocked(parseWorkbook).mockResolvedValue({ headers: [...HEADERS[lng]], rows: [['P-0001', 'Ana Putri'], ['P-0002', 'Budi']] });
  const user = userEvent.setup();
  renderWizard(lng, people);
  await user.upload(screen.getByLabelText(lng === 'en' ? /choose an \.xlsx file/i : /pilih file \.xlsx/i), new File(['x'], 'people.xlsx'));
  await user.click(await screen.findByRole('button', { name: lng === 'en' ? 'Next' : 'Lanjut' }));
  return user;
}

describe('people import: preview and confirm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => setActiveLocale({ locale: 'en', numberLocale: 'en', timezone: 'UTC' }));

  it('AC-PIU-001/002 previews the change old to new and the add with no write, then the confirm updates and adds', async () => {
    const user = await toPreview('en');
    expect(await screen.findByText('Will update')).toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByText('Display name: Ana → Ana Putri')).toBeInTheDocument();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.updateFields).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Add 1 and update 1' }));
    await waitFor(() => expect(screen.getByTestId('import-result-summary')).toHaveTextContent('1 created, 1 updated'));
    expect(h.updateFields).toHaveBeenCalledWith('a', { name: 'Ana Putri' });
    expect(h.create).toHaveBeenCalledWith({ code: 'P-0002', name: 'Budi' });
  });

  it('AC-PIU-011 reads Bahasa Indonesia: statuses, the change line and the confirm', async () => {
    await toPreview('id');
    expect(await screen.findByText('Akan diperbarui')).toBeInTheDocument();
    expect(screen.getByText('Baru')).toBeInTheDocument();
    expect(screen.getByText('Nama tampilan: Ana → Ana Putri')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah 1 dan perbarui 1' })).toBeEnabled();
  });

  it('AC-PIU-010 when the register cannot be read the confirm is disabled and says so, with a retry', async () => {
    const people = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(stored);
    const user = await toPreview('en', people);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be previewed/i);
    expect(screen.getByRole('button', { name: /^Import 2/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Will update')).toBeInTheDocument();
  });

  it('AC-PIU-005 a file where every row is already in the register: confirm reads "Add 0 and update 0" and is disabled', async () => {
    vi.mocked(parseWorkbook).mockResolvedValue({ headers: [...HEADERS.en], rows: [['P-0001', 'Ana']] });
    const user = userEvent.setup();
    renderWizard('en', async () => [{ ...stored[0], name: 'Ana' }]);
    await user.upload(screen.getByLabelText(/choose an \.xlsx file/i), new File(['x'], 'people.xlsx'));
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('button', { name: 'Add 0 and update 0' })).toBeDisabled();
    expect(screen.getByText('No change')).toBeInTheDocument();
  });
});
