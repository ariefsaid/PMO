/**
 * #693 (F-1) — Administration › Users shipped hard-coded English. Rendered under the real `id`
 * catalogue the directory, toolbar, row menu, confirm dialogs, invite/role/manager modals and toasts
 * must read as Bahasa. Role NAMES are translated once (a single label map) so the pill, the select
 * options and every sentence naming a role agree.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { BahasaProvider } from '@/test/bahasa';

const { listState, mutations } = vi.hoisted(() => ({
  listState: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  mutations: {
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
    invite: { mutateAsync: vi.fn(), isPending: false },
    setStatus: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import AdminUsers from './AdminUsers';

const seed = [
  { id: 'u1', full_name: 'Renata Halloway', email: 'renata@meridian.example', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
  { id: 'u2', full_name: 'Desmond Achebe', email: 'desmond@meridian.example', role: 'Project Manager', manager_id: 'u1', org_id: 'org-1', status: 'active' },
  { id: 'u4', full_name: 'Tobias Lindqvist', email: 'tobias@meridian.example', role: 'Finance', manager_id: null, org_id: 'org-1', status: 'disabled' },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <BahasaProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>
            <AdminUsers />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    </BahasaProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
});

describe('Admin Users in Bahasa (#693 F-1)', () => {
  it('#693: the directory heading, toolbar, columns, status and role pills are Bahasa', () => {
    renderPage();
    expect(screen.getByText('Semua pengguna')).toBeInTheDocument();
    expect(screen.getByLabelText('Cari pengguna')).toHaveAttribute('placeholder', 'Cari berdasarkan nama atau email…');
    expect(screen.getByRole('button', { name: 'Undang pengguna' })).toBeInTheDocument();
    for (const h of ['Pengguna', 'Role', 'Status', 'Manajer']) {
      expect(screen.getAllByRole('columnheader', { name: h }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Manajer Proyek').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Keuangan').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Aktif').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nonaktif').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Tanpa manajer').length).toBeGreaterThan(0);
    expect(screen.queryByText('No manager')).toBeNull();
    expect(screen.queryByText('Invite user')).toBeNull();
  });

  it('#693: the empty-search message is Bahasa', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText('Cari pengguna'), 'zzzz');
    expect(await screen.findByText('Tidak ada pengguna yang cocok dengan pencarian')).toBeInTheDocument();
    expect(screen.getByText('Coba nama atau email lain.')).toBeInTheDocument();
  });

  it('#693: the error and empty states are Bahasa, and the error keeps a Retry', async () => {
    listState.isError = true;
    const { unmount } = renderPage();
    expect(screen.getByText('Gagal memuat pengguna')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
    unmount();
    listState.isError = false;
    listState.data = [];
    renderPage();
    expect(screen.getByText('Belum ada pengguna')).toBeInTheDocument();
    expect(screen.getByText('Orang akan muncul di sini setelah diundang ke workspace.')).toBeInTheDocument();
  });

  it('#693: the invite modal, its validation and its role options are Bahasa', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Undang pengguna' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Undang seseorang ke workspace Anda lewat email — mereka akan menetapkan kata sandi sendiri.')).toBeInTheDocument();
    expect(within(dialog).getByText('Detail undangan')).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Manajer Proyek' })).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Eksekutif' })).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'bukan-email');
    await userEvent.tab();
    expect(await within(dialog).findByText('Masukkan alamat email yang valid.')).toBeInTheDocument();
  });

  it('#693: the row menu, role confirm and its toast are Bahasa', async () => {
    renderPage();
    await userEvent.click(
      within(screen.getByText('Desmond Achebe').closest('tr')!).getByRole('button', { name: /Row actions/i }),
    );
    expect(await screen.findByRole('menuitem', { name: 'Ubah manajer' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Nonaktifkan' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit role' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Tetapkan role workspace untuk Desmond Achebe')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Role/), 'Executive');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Simpan role' }));
    const confirm = await screen.findByRole('dialog', { name: 'Ubah role Desmond Achebe menjadi Eksekutif?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Ubah role' }));
    await waitFor(() => expect(mutations.updateRole.mutateAsync).toHaveBeenCalled());
    expect(await screen.findByText('Desmond Achebe sekarang Eksekutif.')).toBeInTheDocument();
  });
});
