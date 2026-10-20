import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetail from '../ProjectDetail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// PD-B (owner 2026-10-20 subtraction): a delivery project with no budget, phases, work orders,
// purchase requests or statements shows only what exists — not a wall of "nothing here" cards.
const project = {
  id: 'p1', name: 'Harbour Pipeline Works', code: 'PRJ-001', status: 'Ongoing Project', client_id: 'c2',
  project_manager_id: 'u-pm', contract_value: 5000000, currency: 'USD', tax_treatment: 'exclusive',
  start_date: '2026-01-01', end_date: '2026-12-18', contract_date: '2026-01-10',
  client: { name: 'Synthetic Client' }, pm: { full_name: 'Synthetic PM' },
} as unknown as ProjectWithRefs;

const h = vi.hoisted(() => ({ role: 'Admin' }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [project], isPending: false, isError: false, refetch: vi.fn() }),
  useProject: () => ({ data: project, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectMutations: () => ({ updateHeader: { mutateAsync: vi.fn(), isPending: false }, archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false }, setContractValue: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [], isError: false }),
  useProjectManagers: () => ({ data: [], isError: false }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u-admin', org_id: 'org-1' }, role: h.role }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: h.role, realRole: h.role }) }));
vi.mock('@/src/hooks/useBudget', () => ({
  useProjectBudget: () => ({ data: 0, isPending: false, isError: false, refetch: vi.fn() }),
  useBudgetVersions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProjectFinances', () => ({
  useProjectFinances: () => ({ data: { project_id: 'p1', contract_invoiced: '0.00', remaining_to_invoice: '5000000.00', invoices: [], budget: null,
    actuals: { currency: 'USD', total: '1200.00', as_of: '2026-10-14T00:00:00Z', excludes_restricted_rows: false,
      categories: [{ category: 'Labor', mapped: true, amount: '1200.00' }, { category: 'Materials', mapped: false, amount: null }] } },
  isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectProcurements: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useProjectCommittedSpend: () => ({ data: undefined, isPending: false, isError: false, commitmentSource: 'not-tracked', ledgerBasis: 'erp', refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useWorkOrders', () => ({
  useProjectDrawdown: () => ({ data: { committed: 0, draft: 0, ceiling: 5000000, currency: 'USD', basis: 'net' }, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useFinancialStatements', () => ({
  useFinancialStatementCatalogue: () => ({ data: { state: 'unavailable', periods: [], scopes: [] }, isPending: false, isError: false, eligible: true, refetch: vi.fn() }),
  useFinancialStatement: () => ({ data: undefined, isPending: false, isError: false, isFetching: false, eligible: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useMilestones', () => ({
  useMilestones: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useMilestoneMutations: () => ({ create: { mutateAsync: vi.fn() }, update: { mutateAsync: vi.fn() }, remove: { mutateAsync: vi.fn() } }),
}));
vi.mock('@/src/hooks/useTasks', () => ({ useTasks: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }));
vi.mock('@/src/lib/db/opportunity', () => ({ useOpportunity: () => ({ data: undefined, isPending: false, isError: false }) }));
vi.mock('@/src/components/comments/CommentsSection', () => ({
  CommentsSection: () => <section aria-labelledby="comments-h"><h2 id="comments-h">Comments</h2></section>,
}));

const renderOverview = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/projects/p1/overview']}>
        <ToastProvider>
          <Routes><Route path="/projects/:projectId/:tab" element={<ProjectDetail />} /></Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.queryByTestId('project-detail-panel-loading')).not.toBeInTheDocument());
  const panel = screen.getByRole('tabpanel');
  await within(panel).findByRole('heading', { level: 2, name: 'Comments' });
  return panel;
};

describe('PD-B Overview renders only blocks with data', () => {
  it('PD-B: with no budget, phases, work orders, requests or statements, Overview is one phases line + Project finances + Comments', async () => {
    const panel = await renderOverview();
    expect(within(panel).getAllByRole('heading', { level: 2 }).map((el) => el.textContent)).toEqual(['Project finances', 'Comments']);
    const phases = within(panel).getByTestId('milestone-strip-empty');
    expect(phases).toHaveTextContent('No delivery phases yet');
    expect(within(phases).getByRole('button', { name: 'Plan delivery phases' })).toBeInTheDocument();
    for (const gone of ['Budget utilization', 'Budget snapshot', 'Procurement summary', 'Contract drawdown', 'Progress curve',
      'Project profit and loss', 'No active budget', 'Statements are not available yet', "Plan this project's delivery phases",
      'No purchase requests for this project yet', 'No dated phases yet']) {
      expect(within(panel).queryByText(gone)).toBeNull();
    }
  });
});
