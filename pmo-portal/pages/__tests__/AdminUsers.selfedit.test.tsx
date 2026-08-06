/**
 * 0179 self-edit gate (migration `0179_profiles_hierarchy_write.sql`): the signed-in
 * caller's own row must NOT offer the 'Edit role' / 'Change manager' row-menu items.
 * That migration made the profiles write RLS deny an Admin editing their OWN role or
 * manager_id — so the FE affordance is gated off on the own-row (UX-only per ADR-0016;
 * RLS stays the enforcement authority) instead of dying with a 42501 toast. The two
 * items are OMITTED (the page's convention for unavailable actions — RowMenuItem has
 * no disabled/title field and DataTable is shared/out-of-scope), and every other row
 * is unaffected.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

const openRowMenu = async (name: string) => {
  const row = screen.getByText(name).closest('tr') ?? screen.getByText(name).closest('div');
  const menuBtn = within(row as HTMLElement).getByRole('button', { name: /Row actions/i });
  await userEvent.click(menuBtn);
};

describe('AdminUsers — self-edit affordance gate (0179 profiles hierarchy write)', () => {
  it('omits "Edit role" and "Change manager" on the signed-in caller\'s own row', async () => {
    renderPage();
    await openRowMenu('Sole Admin');
    // The menu DID open — the own-row Disable (not a self-edit) stays present.
    expect(await screen.findByRole('menuitem', { name: /^disable$/i })).toBeInTheDocument();
    // The two self-edit affordances are NOT offered on the caller's own row.
    expect(screen.queryByRole('menuitem', { name: /edit role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /change manager/i })).not.toBeInTheDocument();
  });

  it('still offers "Edit role" and "Change manager" on another user\'s row', async () => {
    renderPage();
    await openRowMenu('Engineer One');
    expect(await screen.findByRole('menuitem', { name: /edit role/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change manager/i })).toBeInTheDocument();
  });
});
