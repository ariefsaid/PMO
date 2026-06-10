import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * A-3 Engineer own-scoped procurement (AC-W2-RBAC-006, rbac-visibility §A/§E + OD-W2-1):
 *   An Engineer who reaches /procurement sees it scoped to THEIR OWN requests — the page reads
 *   as "your requests" (copy) AND the list is actually narrowed to rows they requested
 *   (requested_by_id === their uid), since procurements_select RLS is org-wide, not requester-
 *   scoped (so the FE narrows the cached list for clarity). It still offers "Raise request"
 *   (any member may raise). NO approve/edit/manage affordances appear here (the index has none;
 *   lifecycle gating lives on the detail page). The route is NOT blocked.
 *
 * Two-sided: Engineer (own-scoped copy + only their own rows + Raise request); a manager (PM)
 * sees the org index copy + ALL org rows + Raise request.
 */
const { procState, createState } = vi.hoisted(() => ({
  procState: {
    // Two requesters: u-self (the signed-in Engineer) and u-other. The org-wide RLS read
    // returns both; the page must narrow to u-self's row for an Engineer.
    data: [
      {
        id: 'pr1',
        title: 'Crane hire',
        code: 'PR-2606010001',
        status: 'Requested',
        total_value: 5000,
        created_at: '2026-06-01T00:00:00Z',
        project: { name: 'Harbour' },
        requested_by_id: 'u-self',
        requested_by: { full_name: 'Erin Engineer' },
      },
      {
        id: 'pr2',
        title: 'Scaffolding rental',
        code: 'PR-2606010002',
        status: 'Requested',
        total_value: 8000,
        created_at: '2026-06-02T00:00:00Z',
        project: { name: 'Harbour' },
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

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useCreateProcurement: () => createState }));
vi.mock('@/src/hooks/useProcurementView', () => ({
  useProcurementView: () => ['table', vi.fn()],
}));

import ProcurementPage from '../../pages/Procurement';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <ProcurementPage />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  procState.isPending = false;
  procState.isError = false;
});

describe('Procurement — Engineer own-scoped view (A-3)', () => {
  it('AC-W2-RBAC-006: an Engineer reads as "your requests" (own-scoped) and can Raise request', () => {
    renderAs('Engineer');
    // Own-scoped copy: the page describes the Engineer's OWN requests, not the org index.
    expect(screen.getAllByText(/your.*requests/i)[0]).toBeInTheDocument();
    // Raise request stays available (any member may raise).
    expect(screen.getByRole('button', { name: /Raise request/i })).toBeInTheDocument();
  });

  it("AC-W2-RBAC-006: an Engineer's list contains ONLY their own requests, not the whole org", () => {
    renderAs('Engineer');
    // u-self's request is shown…
    expect(screen.getAllByText('Crane hire')[0]).toBeInTheDocument();
    // …but u-other's request is NOT (the org-wide RLS read is narrowed to the caller).
    expect(screen.queryByText('Scaffolding rental')).not.toBeInTheDocument();
  });

  it('AC-W2-RBAC-006: a PM sees the org-wide procurement index (NOT the "your requests" scoping)', () => {
    renderAs('Project Manager');
    // The org-index copy describes separation-of-duties gates across all PRs.
    expect(screen.getAllByText(/separation-of-duties/i)[0]).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Raise request/i })).toBeInTheDocument();
    // No "your requests" own-scoping framing for a manager.
    expect(screen.queryByText(/^Your purchase requests$/i)).not.toBeInTheDocument();
    // A manager sees EVERY requester's rows (org index), including u-other's.
    expect(screen.getAllByText('Crane hire')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Scaffolding rental')[0]).toBeInTheDocument();
  });
});
