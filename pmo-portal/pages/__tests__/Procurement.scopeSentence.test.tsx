import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * L3 (dropped-restored §2): the list's role-specific scope sentence was restored by
 * ux1110/r2-proc-losses but shipped with no owning test, so a later refactor could drop it again
 * silently — the same failure mode that produced the original loss (`2b7fff674` removed the role
 * descriptions). These bind the sentence for the two roles that get it: an Engineer reads their
 * own raised procurements, a PM reads the procurements of the projects they manage. The PM's
 * project scope is stated nowhere else on the page.
 */
const { procState, createState, auth } = vi.hoisted(() => ({
  auth: { role: 'Engineer' as string },
  procState: {
    data: [
      {
        id: 'pr1',
        title: 'Crane hire',
        code: 'PR-2606010001',
        status: 'Requested',
        total_value: 5000,
        currency: 'USD',
        created_at: '2026-06-01T00:00:00Z',
        project: { name: 'Harbour', project_manager_id: 'u-self' },
        requested_by_id: 'u-self',
        requested_by: { full_name: 'Erin Engineer' },
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  createState: { mutateAsync: vi.fn() },
}));

vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: auth.role }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useCreateProcurement: () => createState }));
import ProcurementPage from '../../pages/Procurement';

const renderAs = (realRole: Role) => {
  auth.role = realRole;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ImpersonationProvider realRole={realRole}>
        <MemoryRouter>
          <ToastProvider>
            <ProcurementPage />
          </ToastProvider>
        </MemoryRouter>
      </ImpersonationProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  procState.isPending = false;
  procState.isError = false;
});

describe('L3: the procurement list states each role’s scope', () => {
  it('an Engineer reads that the list is the procurements they raised', () => {
    renderAs('Engineer');
    expect(screen.getByText(/procurements you raised/i)).toBeInTheDocument();
    // The manager's project scope is not this reader's scope.
    expect(screen.queryByText(/Procurements for projects you manage/i)).not.toBeInTheDocument();
  });

  it('a PM reads that the list is the procurements for the projects they manage', () => {
    renderAs('Project Manager');
    expect(screen.getByText(/Procurements for projects you manage/i)).toBeInTheDocument();
    expect(screen.queryByText(/procurements you raised/i)).not.toBeInTheDocument();
  });

  it('a reader with org-wide scope gets no personal scope sentence', () => {
    renderAs('Executive');
    expect(screen.queryByText(/procurements you raised/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Procurements for projects you manage/i)).not.toBeInTheDocument();
  });
});
