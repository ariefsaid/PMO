import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * B-8 (AC-W2-IA-003): The Administration page heading must agree with its route
 * breadcrumb. Route = /administration · breadcrumb = "Administration" · page <h1>
 * was "Users" — a three-way mismatch (OUTSTANDING E4).
 *
 * Fix: set <h1> to "Administration" (the route/rail/crumb label); the Users
 * directory becomes a section sub-heading below it. This way the page, its
 * breadcrumb, and the rail item all say the same word — no cognitive disconnect.
 */

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
vi.mock('@/src/auth/useIsOperator', () => ({ useIsOperator: () => false }));

import AdminUsers from '../AdminUsers';

const renderAs = (realRole: 'Admin' | 'Executive') =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <AdminUsers />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('AdminUsers — heading matches breadcrumb (B-8, AC-W2-IA-003)', () => {
  it('AC-W2-IA-003: the page <h1> is "Administration" matching the route/crumb label (not "Users")', () => {
    renderAs('Admin');
    // h1 must say "Administration" — same as the rail item and breadcrumb label.
    expect(screen.getByRole('heading', { level: 1, name: /^Administration$/i })).toBeInTheDocument();
    // "Users" may appear as a sub-heading but must not be the primary h1.
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toMatch(/^Administration$/i);
  });
});
