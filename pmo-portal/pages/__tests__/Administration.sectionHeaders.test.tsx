/**
 * Section-header molecule consistency (ops-admin Discover fix, `docs/decisions.md` "section-header
 * molecule"). Usage, Credits, and Features each render EXACTLY ONE <h2> heading using the shared
 * `SectionHeader` structure — Credits used to roll its own internal header + action row; now all
 * three are hoisted to one shared pattern (Credits passes its "Grant credits" button into the
 * trailing action slot; Usage/Features pass none).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { listState, mutations, isOperatorState } = vi.hoisted(() => ({
  listState: {
    data: [
      { id: 'self-admin', full_name: 'Org Admin', email: 'admin@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
    ] as unknown[],
    isPending: false,
    isError: false,
    refetch: () => {},
  },
  mutations: {
    updateRole: { mutateAsync: () => Promise.resolve(), isPending: false },
    assignManager: { mutateAsync: () => Promise.resolve(), isPending: false },
    invite: { mutateAsync: () => Promise.resolve(), isPending: false },
    setStatus: { mutateAsync: () => Promise.resolve(), isPending: false },
  },
  isOperatorState: { value: true },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => isOperatorState.value }));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: { incidents: true } }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: () => Promise.resolve(100), grant: () => Promise.resolve(undefined) },
    orgFeature: { listOwn: () => Promise.resolve({}), toggle: () => Promise.resolve(undefined) },
  },
}));

import AdminUsers from '../AdminUsers';

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

describe('Administration — section-header molecule consistency', () => {
  it('renders Usage, Credits, and Features each as exactly one <h2>', () => {
    renderPage();
    expect(screen.getAllByRole('heading', { level: 2, name: 'Usage' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2, name: 'Credits' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2, name: 'Features' })).toHaveLength(1);
  });

  it('Credits renders its Grant-credits action in the same header row as its <h2> (Operator)', () => {
    renderPage();
    const creditsHeading = screen.getByRole('heading', { level: 2, name: 'Credits' });
    const headerRow = creditsHeading.parentElement!;
    expect(within(headerRow).getByRole('button', { name: /grant credits/i })).toBeInTheDocument();
  });
});
