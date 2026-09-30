/**
 * #693 (F-2) — the create-project form was hard-coded English: a RIS Admin working in Bahasa
 * created their first project in an English form. Rendered under the real `id` catalogue, every
 * label, placeholder, section legend, button and validation message must read as Bahasa.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';
import ProjectFormModal from './ProjectFormModal';

vi.mock('@/src/hooks/useOrgTaxDefault', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useOrgTaxDefault: () => undefined };
});
// No QueryClient in this harness; the currency adornment reads the org currency (#694).
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
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
    expect(screen.getByText('Pilih perusahaan…')).toBeInTheDocument();
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
    expect(screen.getByLabelText('Kode proyek')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('mis. OPP-2041')).toBeInTheDocument();
  });
});
