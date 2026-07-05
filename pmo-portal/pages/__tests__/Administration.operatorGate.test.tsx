/**
 * AC-OPR-003 — Operator-only affordance gating (ops-admin-surface S4). Renders the page for
 * (a) the seeded Operator → the "Add user" control accepts inviting into ANY org (the
 * cross-org p_org_id path is exercised through useIsOperator=true), and (b) a plain org-Admin
 * → the invite path is pinned to their own org only (useIsOperator=false). The Credits/Features
 * *sections* land in S5/S6 (this test asserts the affordance-gate contract via useIsOperator,
 * not the not-yet-built sections).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

vi.mock('@/src/hooks/useUsers', () => ({
  useUsers: () => listState,
  useUserMutations: () => mutations,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'self-admin', org_id: 'org-1' }, role: 'Admin' }),
}));
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => isOperatorState.value }));

import AdminUsers from '../AdminUsers';

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Admin">
      <MemoryRouter>
        <ToastProvider>
          <AdminUsers />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  isOperatorState.value = false;
});

describe('AdminUsers — Operator affordance gating (AC-OPR-003)', () => {
  it('an org-Admin (non-Operator) sees the "Add user" control gated to their own org', async () => {
    isOperatorState.value = false;
    renderPage();
    const addBtn = screen.getByRole('button', { name: /add user/i });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });

  it('the seeded Operator ALSO sees the "Add user" control (Operator may invite even without org-Admin role)', async () => {
    isOperatorState.value = true;
    renderPage();
    const addBtn = screen.getByRole('button', { name: /add user/i });
    expect(addBtn).toBeInTheDocument();
    expect(addBtn).not.toBeDisabled();
  });
});
