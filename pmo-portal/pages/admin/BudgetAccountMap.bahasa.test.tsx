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
  it('#693: heading, intro, column headers, unmapped pill and row actions are Bahasa', async () => {
    listMock.mockResolvedValue([{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Peta akun anggaran' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Peta kategori anggaran ke akun ERP' })).toBeInTheDocument();
    expect(screen.getByText(/Setiap kategori anggaran harus dipetakan ke akun ERP/)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Kategori' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Akun ERP' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Aksi' })).toBeInTheDocument();
    expect(screen.getAllByText('Belum dipetakan — memblokir setiap push').length).toBe(6);
    expect(screen.getByRole('button', { name: 'Edit Labor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Petakan Materials' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hapus pemetaan Labor' })).toBeInTheDocument();
  });

  it('#693: the load-error state is Bahasa', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByText('Gagal memuat peta akun')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('#693: the map form and its conflict message are Bahasa', async () => {
    listMock.mockResolvedValue([{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Petakan Materials' }));
    const dialog = await screen.findByRole('dialog', { name: 'Petakan Materials' });
    expect(within(dialog).getByText('Pilih akun ERP tujuan push kategori ini')).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText('mis. 5100 - Biaya Langsung')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Akun ERP/), '5100 - Direct Costs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan pemetaan' }));
    // The message renders in the field error AND the error summary — both must read Bahasa.
    expect((await within(dialog).findAllByText('5100 - Direct Costs sudah dipetakan ke Labor.')).length).toBeGreaterThan(0);
  });

  it('#693: the unmap confirm is Bahasa', async () => {
    listMock.mockResolvedValue([{ category: 'Labor', erpAccount: '5100 - Direct Costs' }]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Hapus pemetaan Labor' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Hapus pemetaan Labor?' });
    expect(within(confirm).getByRole('button', { name: 'Hapus pemetaan' })).toBeInTheDocument();
    expect(within(confirm).getByText(/Kategori ini tidak akan memiliki akun ERP/)).toBeInTheDocument();
  });
});
