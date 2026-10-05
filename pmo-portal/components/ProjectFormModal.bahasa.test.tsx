/**
 * #693 (F-2) — the create-project form was hard-coded English: a RIS Admin working in Bahasa
 * created their first project in an English form. Rendered under the real `id` catalogue, every
 * label, placeholder, section legend, button and validation message must read as Bahasa.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
vi.mock('@/src/hooks/useProjectNumberProposal', () => ({
  useProjectNumberProposal: () => ({ status: 'success', number: 'PMO-TEST-0001', error: null }),
}));

import ProjectFormModal from './ProjectFormModal';

const en = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/en/common.json'), 'utf8')) as Record<string, unknown>;
const id = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/common.json'), 'utf8')) as Record<string, unknown>;

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});
// No QueryClient in this harness; the currency adornment reads the org currency (#694).
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => ({ data: [{ id: 'c9', name: 'Asset Owner', type: 'Client' }], isError: false }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useClientCompanies: () => ({ data: [{ id: 'c1', name: 'Innovate Corp', type: 'Client' }], isError: false }),
  useProjectManagers: () => ({ data: [{ id: 'u1', full_name: 'Alice Manager' }], isError: false }),
}));

const renderForm = (mode: 'create' | 'editHeader' = 'create') =>
  render(
    <BahasaProvider>
      <ToastProvider>
        <ProjectFormModal
          mode={mode}
          initial={
            mode === 'editHeader'
              ? { id: 'p1', name: 'Existing', code: null, client_id: null, project_manager_id: null }
              : undefined
          }
          onClose={vi.fn()}
          onSubmit={vi.fn()}
          onSave={vi.fn()}
          onError={vi.fn()}
        />
      </ToastProvider>
    </BahasaProvider>,
  );

describe('ProjectFormModal in Bahasa (#693 F-2)', () => {
  it('#693: the create form renders its title, sections, labels, placeholders and submit in Bahasa', () => {
    renderForm();
    expect(screen.getByRole('dialog', { name: 'Proyek baru' })).toBeInTheDocument();
    expect(screen.getByText('Buat proyek', { selector: 'p, div, span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Buat proyek' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Nama proyek/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('mis. Terminal Pelabuhan — Pekerjaan Sipil')).toBeInTheDocument();
    expect(screen.getByText(/Perusahaan klien/)).toBeInTheDocument();
    // #758: Client and End customer both use the same company placeholder, so it may appear more
    // than once — at least one is required.
    expect(screen.getAllByText('Pilih perusahaan…').length).toBeGreaterThan(0);
    expect(screen.getByText(/Manajer proyek/)).toBeInTheDocument();
    expect(screen.getByText('Tetapkan PM…')).toBeInTheDocument();
    expect(screen.getByLabelText('Tahap awal')).toBeInTheDocument();
    expect(screen.getByLabelText(/Nilai estimasi/)).toBeInTheDocument();
    expect(screen.getByLabelText('Perkiraan mulai')).toBeInTheDocument();
    expect(screen.getByLabelText('Perkiraan selesai')).toBeInTheDocument();
    expect(screen.getByText('Jadwal')).toBeInTheDocument();
  });

  it('#693: the origination stage options show Bahasa names while the values stay the enum', () => {
    renderForm();
    const select = screen.getByLabelText('Tahap awal') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['Leads', 'Prospek'],
      ['Internal Project', 'Proyek internal'],
    ]);
  });

  it('#693: the tax treatment question appears in Bahasa once a value is entered', async () => {
    renderForm();
    await userEvent.type(screen.getByLabelText(/Nilai estimasi/), '1000');
    expect(await screen.findByLabelText(/Perlakuan pajak/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Jumlah pajak/)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '— pilih —' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^Exclusive — pajak ditambahkan di atas jumlahnya$/ })).toBeInTheDocument();
    expect(screen.getByTestId('project-tax-required-hint')).toHaveTextContent(/Nyatakan perlakuan pajak/);
  });

  it('#693: required-field errors are Bahasa', async () => {
    renderForm();
    const name = screen.getByLabelText(/Nama proyek/);
    await userEvent.click(name);
    await userEvent.tab();
    expect(await screen.findByText('Nama proyek wajib diisi.')).toBeInTheDocument();
  });

  it('#693: the edit-header form renders in Bahasa', () => {
    renderForm('editHeader');
    expect(screen.getByRole('dialog', { name: 'Edit proyek' })).toBeInTheDocument();
    expect(screen.getByText('Perbarui detail header proyek')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Simpan proyek' })).toBeInTheDocument();
    expect(screen.getByLabelText('Kode Proyek Klien')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Kode opsional yang digunakan organisasi Anda')).toBeInTheDocument();
  });
});
// ── AC-EC-005 (#758) — every new end-customer key ships with a real Bahasa translation. ──────
const KEY_PATH = (o: unknown, path: string) =>
  path.split('.').reduce<unknown>((acc: unknown, k) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[k];
    return undefined;
  }, o);
describe('AC-EC-005 — end-customer i18n catalogue', () => {
  it('AC-EC-005: every end-customer key has an English source and a non-empty Indonesian translation', () => {
    const keys = [
      'projectForm.endCustomer.label',
      'projectForm.endCustomer.placeholder',
      'projectForm.endCustomer.search',
      'projectForm.endCustomer.noun',
      'projects.columns.endCustomer',
      'projects.filters.allEndCustomers',
      'projects.filters.endCustomerLabel',
      'projects.mobile.endCustomer',
      'projects.mobile.removeEndCustomer',
      'projectDetail.rail.endCustomer',
      'sales.column.endCustomer',
      'combobox.clear',
    ];
    for (const k of keys) {
      const e = KEY_PATH(en, k);
      const i = KEY_PATH(id, k);
      expect(typeof e, k).toBe('string');
      expect((e as string).length, k + ' (en)').toBeGreaterThan(0);
      expect(typeof i, k).toBe('string');
      expect((i as string).length, k + ' (id)').toBeGreaterThan(0);
    }
  });

  it('AC-EC-005: the Indonesian End customer label is exactly Pelanggan akhir', () => {
    expect(KEY_PATH(id, 'projectForm.endCustomer.label')).toBe('Pelanggan akhir');
    expect(KEY_PATH(en, 'projectForm.endCustomer.label')).toBe('End customer');
  });
});