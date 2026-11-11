import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * B-2 (AC-W2-IXD-003 part 2 / D5): Finance's Procurement view offers a
 * "Needs approval" segment surfacing Requested PRs awaiting their approval.
 *
 * Finance (and PM) can approve procurement requests (Requested → Approved/Rejected).
 * Without this segment they must hunt the mixed status table to find actionable items.
 * The segment filter shows only Requested-status PRs (the ones needing approval action).
 *
 * Journey (restructured list): an approver lands on the "Needs you" tab, which lists the Requested
 * PRs awaiting their approval, and the Status filter also offers "Needs approval". An Engineer
 * cannot approve, so gets neither.
 */

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useErpPurchases', () => import('@/pages/__tests__/helpers/erpPurchasesMock'));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('react-router', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => navigate };
});

const { procState, auth } = vi.hoisted(() => ({
  auth: { role: 'Finance' as string },
  procState: {
    data: [
      { id: 'pr1', title: 'Pending PR', code: 'PR-001', status: 'Requested', total_value: 5000, currency: 'USD', created_at: '2026-01-01', project: { name: 'Project A', project_manager_id: 'u-self' }, requested_by_id: 'u-alice', requested_by: { full_name: 'Alice' } },
      { id: 'pr2', title: 'Draft PR', code: 'PR-002', status: 'Draft', total_value: 1000, currency: 'USD', created_at: '2026-01-02', project: { name: 'Project B', project_manager_id: 'u-self' }, requested_by_id: 'u-self', requested_by: { full_name: 'Bob' } },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: auth.role }),
}));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({ data: [] }),
  useVendorOptions: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }), useProject: () => ({ data: null }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => procState, useProjectProcurements: () => procState }));
vi.mock('@/src/hooks/useProcurementCrud', () => ({ useCreateProcurement: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
import ProcurementPage from '../Procurement';

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

const statusOptionNames = () =>
  within(screen.getByRole('combobox', { name: 'Status' })).getAllByRole('option').map((option) => option.textContent);

describe('Procurement — approver reaches requests needing approval (B-2, AC-W2-IXD-003)', () => {
  it.each<Role>(['Finance', 'Project Manager'])(
    'AC-W2-IXD-003: %s lands on "Needs you" with the Requested PR awaiting their approval, and can filter Status to "Needs approval"',
    (role) => {
      renderAs(role);
      const needsYou = screen.getByRole('tab', { name: /^Needs you/ });
      expect(needsYou).toHaveAttribute('aria-selected', 'true');
      expect(needsYou).toHaveTextContent('1');
      // The queue holds the pending request only — not the Draft that needs no approval.
      expect(screen.getAllByText('Pending PR').length).toBeGreaterThan(0);
      expect(screen.queryByText('Draft PR')).not.toBeInTheDocument();
      expect(statusOptionNames()).toContain('Needs approval');
    },
  );

  it('AC-W2-IXD-003: an Engineer has an empty "Needs you" queue and no "Needs approval" status (cannot approve)', () => {
    renderAs('Engineer');
    expect(screen.getByRole('tab', { name: /^Needs you/ })).toHaveTextContent('0');
    expect(screen.getByRole('tab', { name: /^All/ })).toHaveAttribute('aria-selected', 'true');
    expect(statusOptionNames()).not.toContain('Needs approval');
    // Engineer only sees their own request, never the approval-pending one raised by someone else.
    expect(screen.queryByText('Pending PR')).not.toBeInTheDocument();
    expect(screen.getAllByText('Draft PR').length).toBeGreaterThan(0);
  });
});

describe('CW-6: Procurement keeps "Needs approval" as the single approvals doorway in the toolbar', () => {
  it('CW-6: an approver does not see a redundant "See all approvals" toolbar link', () => {
    renderAs('Finance');
    expect(screen.queryByRole('link', { name: /all approvals/i })).not.toBeInTheDocument();
  });

  it('CW-6: an Engineer (non-approver) also sees no approvals toolbar link', () => {
    renderAs('Engineer');
    expect(screen.queryByRole('link', { name: /all approvals/i })).not.toBeInTheDocument();
  });
});
