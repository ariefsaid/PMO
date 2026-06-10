import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-5 Companies page view-gate (AC-W2-RBAC-010, rbac-visibility §D):
 *   Companies view = Admin·Exec·PM·Finance; Engineer = ○ (no nav, no page). The write
 *   affordances are already gated, but the map says Engineer has NO company directory at all —
 *   so an Engineer reaching /companies by URL gets a clean access-denied surface, not the
 *   directory.
 *
 * Two-sided: a PM sees the directory; an Engineer sees the denied region + Back.
 */
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const { companiesState } = vi.hoisted(() => ({
  companiesState: {
    data: [{ id: 'c1', name: 'Cascade Port Authority', type: 'Client', archived_at: null }] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompanies: () => companiesState,
  useCompanyMutations: () => ({
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}));

import Companies from '../../pages/Companies';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <Companies />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  navigate.mockClear();
  companiesState.isPending = false;
  companiesState.isError = false;
});

describe('Companies — Engineer page view-gate (A-5)', () => {
  it('AC-W2-RBAC-010: a PM sees the company directory (authorized)', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeInTheDocument();
    expect(screen.getAllByText('Cascade Port Authority')[0]).toBeInTheDocument();
  });

  it('AC-W2-RBAC-010: an Engineer sees an access-denied surface, not the directory', () => {
    renderAs('Engineer');
    expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /don't have access/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
  });
});
