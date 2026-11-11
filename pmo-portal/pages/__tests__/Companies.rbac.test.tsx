import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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
vi.mock('@/src/hooks/useDomainOwnershipMode', async () => await import('@/test/domainOwnershipMock'));

vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const { h } = vi.hoisted(() => ({
  // #1989: the page reads one SERVER page; the stub mirrors the directory read's contract.
  h: {
    directory: [
      { id: 'c1', name: 'Cascade Port Authority', type: 'Client', archived_at: null },
    ] as Array<Record<string, unknown>>,
    pending: false,
    error: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/src/hooks/useCompanies', () => ({
  useCompaniesPage: (input: { type: string; search: string; page: number; pageSize: number }) => {
    const q = input.search.trim().toLowerCase();
    const matching = h.directory.filter((c) => {
      const typeOk = input.type === 'All' || c.type === input.type;
      const searchOk = !q || String(c.name).toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const start = (input.page - 1) * input.pageSize;
    return {
      data: { rows: matching.slice(start, start + input.pageSize), total: matching.length },
      isPending: h.pending,
      isError: h.error,
      isFetching: false,
      refetch: h.refetch,
    };
  },
  useCompaniesTotal: () => ({ data: null, isPending: false, isError: false }),
  useCompaniesExportAll: () => ({ mutateAsync: vi.fn(async () => h.directory), isPending: false }),
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
  h.pending = false;
  h.error = false;
});

describe('Companies — Engineer page view-gate (A-5)', () => {
  it('AC-W2-RBAC-010: a PM sees the company directory (authorized)', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeInTheDocument();
    expect(screen.getByText('Cascade Port Authority')).toBeInTheDocument();
  });

  it('AC-W2-RBAC-010 AC-CO-001b: an Engineer sees an access-denied surface, not the directory or New company button', () => {
    renderAs('Engineer');
    expect(screen.queryByText('Cascade Port Authority')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new company/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /don't have access/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to dashboard/i })).toBeInTheDocument();
  });
});
