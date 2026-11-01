/** AC-INV-004 — status actions respect the current account and active Admin boundary. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
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

  it('omits self-disable and explains the sole Admin restriction', () => {
    renderPage();
    const row = screen.getByText('Sole Admin').closest('tr') as HTMLElement;
    expect(within(row).queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
    expect(within(row).getByText(/only active admin/i)).toBeInTheDocument();
  });

  it('explains why a different sole Admin cannot be disabled', async () => {
    const original = listState.data;
    listState.data = [
      { id: 'self-admin', full_name: 'Operator', email: 'operator@example.com', role: 'Engineer', manager_id: null, org_id: 'org-1', status: 'active' },
      { id: 'other-admin', full_name: 'Other Admin', email: 'other@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
    ];
    try {
      renderPage();
      const row = screen.getByText('Other Admin').closest('tr') as HTMLElement;
      expect(within(row).getByText(/only active admin/i)).toBeInTheDocument();
      await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
      expect(screen.queryByRole('menuitem', { name: /^disable$/i })).not.toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: /edit role/i })).toBeInTheDocument();
    } finally { listState.data = original; }
  });

  it('offers disabling another active Admin when more than one is visible', async () => {
    const original = listState.data;
    listState.data = [...original, { id: 'admin-2', full_name: 'Second Admin', email: 'second@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' }];
    try {
      renderPage();
      const row = screen.getByText('Second Admin').closest('tr') as HTMLElement;
      await userEvent.click(within(row).getByRole('button', { name: /row actions/i }));
      expect(screen.getByRole('menuitem', { name: /^disable$/i })).toBeInTheDocument();
    } finally { listState.data = original; }
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
