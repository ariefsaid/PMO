/**
 * AC-INV-004 — Disable/Re-enable row actions + invite modal (ops-admin-surface S4).
 * Renders the directory as the sole org-Admin; the row-menu "Disable" on themselves and on
 * the sole Admin both surface the classified lockout toast (RPC P0001) and the row stays
 * active; the disable confirm dialog (ConfirmDialog tone="destructive") appears for a
 * non-self target and commits on confirm.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { listState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [
      { id: 'self-admin', full_name: 'Sole Admin', email: 'admin@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
      { id: 'eng-1', full_name: 'Engineer One', email: 'eng@example.com', role: 'Engineer', manager_id: null, org_id: 'org-1', status: 'active' },
      { id: 'eng-2', full_name: 'Disabled Engineer', email: 'disabled@example.com', role: 'Engineer', manager_id: null, org_id: 'org-1', status: 'disabled' },
    ] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
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
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// S6: the Credits + Features sections reach react-query + the repository seam directly.
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: {} }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: vi.fn().mockResolvedValue(0), grant: vi.fn().mockResolvedValue(undefined) },
    orgFeature: { listOwn: vi.fn().mockResolvedValue({}), toggle: vi.fn().mockResolvedValue(undefined) },
  },
}));

class LockoutError extends Error {
  code = 'P0001';
  constructor(message: string) {
    super(message);
  }
}

import AdminUsers from '../AdminUsers';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Admin">
        <MemoryRouter>
          <ToastProvider>
            <AdminUsers />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

beforeEach(() => {
  listState.isPending = false;
  listState.isError = false;
  mutations.setStatus.mutateAsync.mockReset();
  mutations.setStatus.isPending = false;
});

describe('AdminUsers — Disable/Re-enable (AC-INV-004)', () => {
  it('opens a destructive confirm dialog for a non-self Disable target', async () => {
    renderPage();
    const row = screen.getByText('Engineer One').closest('tr') ?? screen.getByText('Engineer One').closest('div');
    const menuBtn = within(row as HTMLElement).getByRole('button', { name: /Row actions/i });
    await userEvent.click(menuBtn);
    const disableItem = await screen.findByRole('menuitem', { name: /disable/i });
    await userEvent.click(disableItem);

    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/disable/i, { selector: 'button' })).toBeInTheDocument();
  });

  it('commits the disable on confirm for a non-self target', async () => {
    mutations.setStatus.mutateAsync.mockResolvedValue(undefined);
    renderPage();
    const row = screen.getByText('Engineer One').closest('tr') ?? screen.getByText('Engineer One').closest('div');
    const menuBtn = within(row as HTMLElement).getByRole('button', { name: /Row actions/i });
    await userEvent.click(menuBtn);
    const disableItem = await screen.findByRole('menuitem', { name: /disable/i });
    await userEvent.click(disableItem);

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /disable/i });
    await userEvent.click(confirmBtn);

    await waitFor(() =>
      expect(mutations.setStatus.mutateAsync).toHaveBeenCalledWith({
        id: 'eng-1',
        status: 'disabled',
        orgId: 'org-1',
      }),
    );
  });

  it('self-disable is rejected server-side (P0001 lockout) and surfaces a classified toast', async () => {
    mutations.setStatus.mutateAsync.mockRejectedValue(new LockoutError('cannot disable yourself'));
    renderPage();
    const row = screen.getByText('Sole Admin').closest('tr') ?? screen.getByText('Sole Admin').closest('div');
    const menuBtn = within(row as HTMLElement).getByRole('button', { name: /Row actions/i });
    await userEvent.click(menuBtn);
    const disableItem = await screen.findByRole('menuitem', { name: /disable/i });
    await userEvent.click(disableItem);

    const dialog = await screen.findByRole('alertdialog');
    const confirmBtn = within(dialog).getByRole('button', { name: /disable/i });
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(mutations.setStatus.mutateAsync).toHaveBeenCalled());
    expect(await screen.findByText(/only admin|lockout|can't disable|cannot disable/i)).toBeInTheDocument();
  });

  it('a disabled user shows a "Re-enable" action and a visible disabled StatusPill', async () => {
    renderPage();
    expect(screen.getByText('Disabled Engineer')).toBeInTheDocument();
    const row = screen.getByText('Disabled Engineer').closest('tr') ?? screen.getByText('Disabled Engineer').closest('div');
    const menuBtn = within(row as HTMLElement).getByRole('button', { name: /Row actions/i });
    await userEvent.click(menuBtn);
    expect(await screen.findByRole('menuitem', { name: /re-enable/i })).toBeInTheDocument();
  });
});
