/**
 * #693 (F-1) — Administration › Budget account map shipped hard-coded English. Rendered under the
 * real `id` catalogue the heading, column headers, unmapped pill, row actions, dialogs and
 * validation must read as Bahasa. Budget category NAMES (domain vocabulary shared with the budget
 * tabs) stay as they are.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('@/src/lib/repositories/budgetProjection', () => ({
  listBudgetCategoryAccountMap: listMock,
  createBudgetCategoryAccountMapRow: vi.fn(),
  updateBudgetCategoryAccountMapRow: vi.fn(),
  deleteBudgetCategoryAccountMapRow: vi.fn(),
  setBudgetPushAccount: vi.fn(),
}));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import BudgetAccountMap from './BudgetAccountMap';

const renderPage = () =>
  render(
    <BahasaProvider>
      <MemoryRouter initialEntries={['/administration/accounting']}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ToastProvider>
            <BudgetAccountMap />
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </BahasaProvider>,
  );

beforeEach(() => {
  realRole = 'Admin';
  listMock.mockReset();
});

describe('Budget account map in Bahasa (#693 F-1)', () => {
  it('AC-CAT-005: translates the new category in the row and mapping dialog while retaining existing names', async () => {
    listMock.mockResolvedValue([{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);
    renderPage();
    expect(await screen.findByText('Biaya khusus')).toBeInTheDocument();
    expect(screen.getByText('Labor')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Petakan Biaya khusus' }));
    expect(await screen.findByRole('dialog', { name: 'Petakan Biaya khusus' })).toBeInTheDocument();
  });

  it('#693: heading, intro, column headers, unmapped pill and row actions are Bahasa', async () => {
    listMock.mockResolvedValue([{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Peta akun anggaran' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Peta kategori anggaran ke akun ERP' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Setiap kategori anggaran harus dipetakan ke akun ERP sebelum jumlahnya dapat dikirim ke ERP. Kategori yang belum dipetakan memblokir pengiriman SELURUH anggaran, bukan hanya baris itu.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kategori' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Akun ERP' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Aksi' })).toBeInTheDocument();
    expect(screen.getAllByText('Belum dipetakan — memblokir setiap pengiriman').length).toBe(7);
    expect(screen.getByRole('button', { name: 'Edit 5100 - Direct Costs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Petakan Materials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus 5100 - Direct Costs' })).toBeInTheDocument();
  });

  it('#693: the load-error state is Bahasa', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Gagal memuat peta akun')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('#693: the map form and its conflict message are Bahasa', async () => {
    listMock.mockResolvedValue([{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Petakan Materials' }));
    const dialog = await screen.findByRole('dialog', { name: 'Petakan Materials' });
    expect(within(dialog).getByText('Pilih akun ERP tujuan pengiriman kategori ini')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('mis. 5100 - Biaya Langsung')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Akun ERP/), '5100 - Direct Costs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan pemetaan' }));
    // The message renders in the field error AND the error summary — both must read Bahasa.
    expect((await within(dialog).findAllByText('5100 - Direct Costs sudah dipetakan ke Labor.')).length).toBeGreaterThan(0);
  });

  it('#693: the unmap confirm is Bahasa', async () => {
    listMock.mockResolvedValue([{ id: 'm-labor', category: 'Labor', erpAccount: '5100 - Direct Costs', isPushTarget: true }]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus 5100 - Direct Costs' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Hapus pemetaan Labor?' });
    expect(within(confirm).getByRole('button', { name: 'Hapus pemetaan' })).toBeInTheDocument();
    expect(
      within(confirm).getByText(
        'Kategori ini tidak akan memiliki akun ERP. Pengiriman anggaran dengan jumlah bukan nol pada kategori ini akan ditolak hingga dipetakan kembali.',
      ),
    ).toBeInTheDocument();
  });
});
