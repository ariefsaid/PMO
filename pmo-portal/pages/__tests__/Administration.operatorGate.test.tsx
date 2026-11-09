/**
 * AC-OPR-003 — Operator-only affordance gating (ops-admin-surface S4). Renders the page for
 * (a) the seeded Operator → the "Invite user" control accepts inviting into ANY org (the
 * cross-org p_org_id path is exercised through useIsOperator=true), and (b) a plain org-Admin
 * → the invite path is pinned to their own org only (useIsOperator=false). The Credits/Features
 * *sections* land in S5/S6 (this test asserts the affordance-gate contract via useIsOperator,
 * not the not-yet-built sections).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

const { listState, mutations, isOperatorState } = vi.hoisted(() => ({
  listState: {
    data: [
      { id: 'self-admin', full_name: 'Org Admin', email: 'admin@example.com', role: 'Admin', manager_id: null, org_id: 'org-1', status: 'active' },
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
  isOperatorState: { value: false },
}));

vi.mock('@/src/hooks/useUsers', () => {
  type MockUser = { full_name: string; email: string; org_id: string; role: string; status: string };
  type MockState = { data?: readonly unknown[] | null; isPending?: boolean; isError?: boolean; refetch?: () => unknown };
  const directoryPage = (state: MockState, input: { pageSize?: number; page?: number; search?: string } = {}) => {
    const size = input.pageSize || 50;
    const pageNo = input.page || 1;
    const term = String(input.search || '').trim().toLowerCase();
    const all = (state.data || []) as MockUser[];
    const matched = term ? all.filter((u) => u.full_name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)) : all;
    return {
      data: { rows: matched.slice((pageNo - 1) * size, pageNo * size), total: matched.length },
      isPending: state.isPending, isError: state.isError, isFetching: false, refetch: state.refetch,
    };
  };
  const adminCounts = (state: MockState) => {
    const out: Record<string, number> = {};
    for (const u of (state.data || []) as MockUser[]) {
      if (out[u.org_id] === undefined) out[u.org_id] = 0;
      if (u.role === 'Admin' && u.status === 'active') out[u.org_id] += 1;
    }
    return { data: out, isPending: false, isError: false };
  };
  return {
    useUsers: () => listState,
    useUsersPage: (input: { page?: number; pageSize?: number; search?: string }) => directoryPage(listState, input),
    useActiveAdminCounts: () => adminCounts(listState),
    useUserFocusPage: () => ({ data: null, isPending: false, isError: false }),
    useManagerChoices: () => listState,
    useUserMutations: () => mutations,
  };
});
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => isOperatorState.value }));
vi.mock('@/src/hooks/useUsage', () => ({
  useUsage: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useAgentRunStats: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// S6: the Credits + Features sections reach react-query + the repository seam directly.
vi.mock('@/src/hooks/useOrgFeatures', () => ({
  useOrgFeatures: () => ({ data: {} }),
}));
vi.mock('@/src/lib/repositories/admin', () => ({
  creditsRepository: { getOrgBalance: vi.fn().mockResolvedValue(0), grant: vi.fn().mockResolvedValue(undefined) },
  orgFeatureRepository: { listOwn: vi.fn().mockResolvedValue({}), toggle: vi.fn().mockResolvedValue(undefined) },
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
  isOperatorState.value = false;
});

describe('AdminUsers — Operator affordance gating (AC-OPR-003)', () => {
  it('an org-Admin (non-Operator) sees the "Invite user" control gated to their own org', async () => {
    isOperatorState.value = false;
    renderPage();
    const addBtn = screen.getByRole('button', { name: /invite user/i });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });

  it('the seeded Operator ALSO sees the "Invite user" control (Operator may invite even without org-Admin role)', async () => {
    isOperatorState.value = true;
    renderPage();
    const addBtn = screen.getByRole('button', { name: /invite user/i });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });
});
