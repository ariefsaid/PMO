/**
 * Section-header molecule consistency (ops-admin Discover fix, `docs/decisions.md` "section-header
 * molecule"). Usage, Credits, and Features each render EXACTLY ONE <h2> heading using the shared
 * `SectionHeader` structure on their selected canonical route — Credits keeps its Grant credits
 * action in the same header row; Usage and Features pass no action.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
  isOperatorState: { value: true, pending: false },
}));

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({
  useIsOperator: () => isOperatorState.value,
  useOperatorMembership: () => ({
    isOperator: isOperatorState.value,
    isPending: isOperatorState.pending,
    isError: false,
  }),
}));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: () => {} }),
}));
vi.mock('@/src/hooks/useOrgFeatures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/hooks/useOrgFeatures')>()),
  // A resolved set with a mix of sources so every row kind renders (S3: the panel reads the
  // database projection, and `usePlans` imports the query keys from this same module).
  useOrgFeatures: () => ({
    data: { incidents: true, crm: false, procurement: true },
    states: {
      incidents: { enabled: true, displayEnabled: true, source: 'override' },
      crm: { enabled: false, displayEnabled: false, source: 'plan' },
      procurement: { enabled: true, displayEnabled: true, source: 'global' },
    },
  }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    credits: { getOrgBalance: () => Promise.resolve(100), grant: () => Promise.resolve(undefined) },
    orgFeature: {
      listOwn: vi.fn().mockResolvedValue({ display: {}, states: {} }),
      listForOrg: vi.fn().mockResolvedValue({
        display: { incidents: true, crm: false, procurement: true },
        states: {
          incidents: { enabled: true, displayEnabled: true, source: 'override' },
          crm: { enabled: false, displayEnabled: false, source: 'plan' },
          procurement: { enabled: true, displayEnabled: true, source: 'global' },
        },
      }),
      getPlanCatalogue: vi.fn().mockResolvedValue({
        plans: [{ planId: 'starter', name: 'Starter', seatLimit: 10, projectLimit: 25, aiMonthlyMessages: 300 }],
        defaults: { starter: { incidents: true, crm: false, procurement: true } },
        global: { incidents: true, crm: true, procurement: true },
      }),
      getOrgPlan: vi.fn().mockResolvedValue('starter'),
      listOverrides: vi.fn().mockResolvedValue([]),
      getOwnPlan: vi.fn().mockResolvedValue({
        planId: 'starter',
        name: 'Starter',
        seatLimit: 10,
        projectLimit: 25,
        aiMonthlyMessages: 300,
      }),
      toggle: vi.fn().mockResolvedValue(undefined),
      clearOverride: vi.fn().mockResolvedValue(undefined),
      setOrgPlan: vi.fn().mockResolvedValue(undefined),
      setGlobal: vi.fn().mockResolvedValue(undefined),
      setPlanFeature: vi.fn().mockResolvedValue(undefined),
      setPlanLimits: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

import Administration from '../Administration';

const renderPage = (section: 'usage' | 'credits' | 'features') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ImpersonationProvider realRole="Admin">
        <MemoryRouter initialEntries={[`/administration/${section}`]}>
          <ToastProvider>
            <Administration />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );

describe('Administration — section-header molecule consistency', () => {
  it('renders Usage, Credits, and Features each as exactly one <h2> on its selected route', () => {
    for (const [section, title] of [
      ['usage', 'Usage'],
      ['credits', 'Credits'],
      ['features', 'Features'],
    ] as const) {
      const view = renderPage(section);
      expect(screen.getAllByRole('heading', { level: 2, name: title })).toHaveLength(1);
      view.unmount();
    }
  });

  it('Credits renders its Grant-credits action in the same header row as its <h2> (Operator)', () => {
    renderPage('credits');
    const creditsHeading = screen.getByRole('heading', { level: 2, name: 'Credits' });
    const headerRow = creditsHeading.parentElement!;
    expect(within(headerRow).getByRole('button', { name: /grant credits/i })).toBeInTheDocument();
  });
});
