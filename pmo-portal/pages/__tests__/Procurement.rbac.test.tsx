import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-3 Engineer own-scoped procurement (AC-W2-RBAC-006, rbac-visibility §A/§E + OD-W2-1):
 *   An Engineer who reaches /procurement sees it scoped to THEIR OWN requests — the page reads
 *   as "your requests" (copy) AND the list is actually narrowed to rows they requested
 *   (requested_by_id === their uid), since procurements_select RLS is org-wide, not requester-
 *   scoped (so the FE narrows the cached list for clarity). It still offers "New procurement"
 *   (any member may raise). NO approve/edit/manage affordances appear here (the index has none;
 *   lifecycle gating lives on the detail page). The route is NOT blocked.
 *
 * Two-sided: Engineer (own-scoped copy + only their own rows + Raise request); a manager (PM)
 * sees the manager copy + every requester's rows for their projects + New procurement.
 */
const { procState, createState, auth } = vi.hoisted(() => ({
  auth: { role: 'Engineer' as string },
  procState: {
    // Two requesters: u-self (the signed-in Engineer) and u-other. The org-wide RLS read
    // returns both; the page must narrow to u-self's row for an Engineer.
    data: [
      {
        id: 'pr1',
        title: 'Crane hire',
        code: 'PR-2606010001',
        status: 'Requested',
        total_value: 5000, currency: 'USD',
        created_at: '2026-06-01T00:00:00Z',
        project: { name: 'Harbour', project_manager_id: 'u-self' },
        requested_by_id: 'u-self',
        requested_by: { full_name: 'Erin Engineer' },
      },
      {
        id: 'pr2',
        title: 'Scaffolding rental',
        code: 'PR-2606010002',
        status: 'Requested',
        total_value: 8000, currency: 'USD',
        created_at: '2026-06-02T00:00:00Z',
        project: { name: 'Harbour', project_manager_id: 'u-self' },
        requested_by_id: 'u-other',
        requested_by: { full_name: 'Olive Other' },
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  createState: { mutateAsync: vi.fn() },
}));

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
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
  auth.role = realRole; // the signed-in session role the shared list block reads
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

describe('Procurement — Engineer own-scoped view (A-3)', () => {
  it('AC-W2-RBAC-006: an Engineer reads as "your requests" (own-scoped) and can Raise request', () => {
    renderAs('Engineer');
    // Own-scoped copy: the page describes the Engineer's OWN procurements, not the org index.
    expect(screen.getByRole('heading', { level: 1, name: 'Your procurements' })).toBeInTheDocument();
    expect(screen.getByText(/procurements you raised/i)).toBeInTheDocument();
    // Raising a procurement stays available (any member may raise).
    expect(screen.getAllByRole('button', { name: /New procurement/i }).length).toBeGreaterThan(0);
  });

  it("AC-W2-RBAC-006: an Engineer's list contains ONLY their own requests, not the whole org", () => {
    renderAs('Engineer');
    // u-self's request is shown…
    expect(screen.getByText('Crane hire')).toBeInTheDocument();
    // …but u-other's request is NOT (the org-wide RLS read is narrowed to the caller).
    expect(screen.queryByText('Scaffolding rental')).not.toBeInTheDocument();
  });

  it('AC-W2-RBAC-006: a PM sees every requester\'s rows for their projects (NOT the "your procurements" scoping)', async () => {
    renderAs('Project Manager');
    // The manager description stays distinct from the own-scoped requester copy.
    expect(screen.getByRole('heading', { level: 1, name: 'Procurement' })).toBeInTheDocument();
    expect(screen.getByText(/Procurements for projects you manage/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /New procurement/i }).length).toBeGreaterThan(0);
    // No own-scoping framing for a manager.
    expect(screen.queryByRole('heading', { name: 'Your procurements' })).not.toBeInTheDocument();
    // The PM opens the full list: every requester's rows for the PM's projects, including u-other's.
    await userEvent.click(screen.getByRole('tab', { name: /^All/ }));
    expect(screen.getByText('Crane hire')).toBeInTheDocument();
    expect(screen.getByText('Scaffolding rental')).toBeInTheDocument();
  });
});
