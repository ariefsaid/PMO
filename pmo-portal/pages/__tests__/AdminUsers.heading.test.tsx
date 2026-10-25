import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/** The selected route job is the page h1, and the matching section link identifies its location. */

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useUserMutations: () => ({
    updateRole: { mutateAsync: vi.fn(), isPending: false },
    assignManager: { mutateAsync: vi.fn(), isPending: false },
    invite: { mutateAsync: vi.fn(), isPending: false },
    setStatus: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => false,
  useOperatorMembership: () => ({ isOperator: false, isPending: false, isError: false, retry: vi.fn() }),
}));
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

import Administration from '../Administration';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const renderAs = (realRole: 'Admin' | 'Executive') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole={realRole}>
        <MemoryRouter initialEntries={['/administration/users']}>
          <ToastProvider>
            <Administration />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

describe('Administration — route job heading identifies the selected destination', () => {
  it('shows one Users route h1 and an active Users destination link', () => {
    renderAs('Admin');
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('aria-current', 'page');
  });
});
