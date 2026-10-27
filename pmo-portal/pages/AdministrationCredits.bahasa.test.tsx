/**
 * #693 (F-1) — Administration › Credits shipped hard-coded English ("Org balance", "credits",
 * "Grant credits", the error state and the grant form). Rendered under the real `id` catalogue they
 * must read as Bahasa.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

const { getOrgBalance, grant } = vi.hoisted(() => ({ getOrgBalance: vi.fn(), grant: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: { credits: { getOrgBalance, grant } },
}));

import AdministrationCredits from './AdministrationCredits';

const renderPanel = (isOperator = true) =>
  render(
    <BahasaProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <AdministrationCredits isOperator={isOperator} orgId="org-1" />
        </ToastProvider>
      </QueryClientProvider>
    </BahasaProvider>,
  );

beforeEach(() => {
  getOrgBalance.mockReset();
  grant.mockReset();
});

describe('Administration Credits in Bahasa (#693 F-1)', () => {
  it('#693: the balance readout and Grant affordance are Bahasa', async () => {
    getOrgBalance.mockResolvedValue(1200);
    renderPanel();
    expect(await screen.findByText('Saldo organisasi')).toBeInTheDocument();
    expect(screen.getByText('kredit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Berikan kredit' })).toBeInTheDocument();
    expect(screen.queryByText('Grant credits')).toBeNull();
  });

  it('#693: the load-error state is Bahasa with a Bahasa Retry', async () => {
    getOrgBalance.mockRejectedValue(new Error('boom'));
    renderPanel();
    expect(await screen.findByText('Gagal memuat saldo')).toBeInTheDocument();
    expect(screen.getByText('Permintaan gagal. Periksa koneksi Anda dan coba lagi.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });

  it('#693: the grant form and its validation are Bahasa', async () => {
    getOrgBalance.mockResolvedValue(0);
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Berikan kredit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Berikan kredit' });
    expect(within(dialog).getByText('Tambahkan kredit ke pool organisasi. Berlaku segera.')).toBeInTheDocument();
    expect(within(dialog).getByText('Detail pemberian')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Jumlah/)).toBeInTheDocument();
    expect(within(dialog).getByText('Harus lebih besar dari nol.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Catatan')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/Jumlah/), '0');
    await userEvent.tab();
    expect(await within(dialog).findByText('Jumlah pemberian harus positif.')).toBeInTheDocument();
  });
});
