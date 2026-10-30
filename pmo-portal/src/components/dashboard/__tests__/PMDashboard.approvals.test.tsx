/**
 * Ported from the pre-restructure PMDashboard.test.tsx "N15: combined approvals tile = approvable PRs (1)
 * + timesheets (2) = 3, links to /approvals" (baseline fa511c382). The recomposed PM hub splits the
 * same queue into two doorways — procurement approvals and team timesheets — so the oracle is the same
 * counts (1 approvable request, 2 timesheets, 3 in total) and the same destinations. The REAL
 * useNeedsYou runs here; only the network seams are stubbed, so the count is the hook's own arithmetic.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

const h = vi.hoisted(() => ({
  procurements: [] as unknown[],
  timesheetsAwaiting: [] as Array<{ id: string; entries: Array<{ hours: number }> }>,
}));

const project = {
  id: 'p1', name: 'Project One', short_name: null, status: 'Ongoing Project', client_name: 'Acme Works',
  contract_value: 100_000, currency: 'USD', budget: 100_000, spent: 10_000, actual_currency: 'USD',
  actual_complete: true, budget_currency: 'USD', actual_coverage_count: 1, actual_coverage_total: 1,
  realized_margin: 5_000, realized_margin_pct: 0.05, contract_remaining: 90_000,
};

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: h.procurements, isPending: false, isError: false, refetch: () => Promise.resolve() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: h.timesheetsAwaiting, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/db/timesheetTransition', () => ({
  listTimesheetsAwaitingApproval: () => Promise.resolve(h.timesheetsAwaiting),
}));
vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: () => Promise.resolve({ projects_at_risk: 0 }),
  getFinanceBudgetReview: () => Promise.resolve([]),
  getPMDashboardProjects: () => Promise.resolve([project]),
}));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: { totals: [], incompleteCount: 0 }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useInvoicesAwaitingViewer', () => ({
  useInvoicesAwaitingViewer: () => ({ rows: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/hooks/useFxOrgDay', () => ({ useFxOrgDay: () => ({ day: '2026-10-27', isPending: false, isError: false, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: {}, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: () => ({ data: { pmo_project_number: 'PRJ-26-0001' }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    revenue: { listInvoices: () => Promise.resolve([]) },
    expenseClaim: { list: () => Promise.resolve({ rows: [] }), routes: () => Promise.resolve([]) },
    task: { list: () => Promise.resolve([]) },
  },
}));

import { PMDashboard } from '../PMDashboard';

const renderDashboard = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><PMDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  h.procurements = [
    // Approvable: requested by someone else on the PM's project.
    { id: 'pr1', project_id: 'p1', status: 'Requested', requested_by_id: 'someone-else', approvalRoute: null, title: 'Inverter spares' },
    // Not approvable by the PM: their own request (approver ≠ requester).
    { id: 'pr-own', project_id: 'p1', status: 'Requested', requested_by_id: 'pm-1', approvalRoute: null, title: 'Own request' },
  ];
  h.timesheetsAwaiting = [
    { id: 't1', entries: [{ hours: 8 }] },
    { id: 't2', entries: [{ hours: 4 }] },
  ];
});

describe('PMDashboard approvals queue (ported N15)', () => {
  it('N15: approvable requests (1) and team timesheets (2) — 3 waiting — each link to their approvals queue', async () => {
    renderDashboard();

    // The real hook resolves its queries asynchronously; allow for a loaded shared machine.
    const requests = await screen.findByRole('link', { name: /^1 approval waiting for you$/i }, { timeout: 5000 });
    expect(requests).toHaveAttribute('href', '/approvals');
    const timesheets = screen.getByRole('link', { name: /^2 team timesheets to approve$/i });
    expect(timesheets).toHaveAttribute('href', '/approvals?scope=timesheets');

    // The PM's own request is never counted as waiting for them; nothing is double-counted.
    expect(screen.queryByRole('link', { name: /^2 approvals waiting for you$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^3 approvals waiting for you$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Procurement approvals — coming soon/i)).not.toBeInTheDocument();
  });

  it('AC-SL-A-001: nothing waiting → no approvals doorway', async () => {
    h.procurements = [];
    h.timesheetsAwaiting = [];
    renderDashboard();

    expect(await screen.findByRole('link', { name: 'Project One' }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^\d+ approvals? waiting for you$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^\d+ team timesheets? to approve$/i })).not.toBeInTheDocument();
  });
});
