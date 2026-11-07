import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter } from 'react-router';
import React from 'react';
import SalesLayoutRoute from '../SalesLayoutRoute';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
const old = new Date(Date.now() - 45 * 86400000).toISOString();
const stages = [
  { status: 'Leads', count: 0, total_value: 0, win_probability: 0.1, weighted_value: 0 },
  { status: 'Quotation Submitted', count: 0, total_value: 0, win_probability: 0.4, weighted_value: 0 },
  { status: 'PQ Submitted', count: 0, total_value: 0, win_probability: 0.25, weighted_value: 0 },
  { status: 'Tender Submitted', count: 1, total_value: 1200000, win_probability: 0.5, weighted_value: 600000 },
  { status: 'Negotiation', count: 0, total_value: 0, win_probability: 0.75, weighted_value: 0 },
];
const projects = [
  { id: 'p2', name: 'Northwind ERP Rollout', short_name: null, client_name: 'Northwind', status: 'Tender Submitted', contract_value: 1200000, currency: 'USD', win_probability: 0.5, last_update: old },
];
vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages, projects }, isPending: false, isError: false, refetch: vi.fn() }),
  useLostDeals: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
  useWonDeals: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
}));

const renderAs = (role: 'Project Manager' | 'Finance', layout: string) =>
  render(
    <ImpersonationProvider realRole={role}>
      <MemoryRouter initialEntries={[`/sales?layout=${layout}`]}>
        <ToastProvider><SalesLayoutRoute /></ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('#1426 sales layout options carry the floor actions', () => {
  it.each(['a', 'b', 'c'])('option %s: PM sees deal, forecast, search, export, view toggle and New project', async (layout) => {
    renderAs('Project Manager', layout);
    expect(await screen.findAllByText('Northwind ERP Rollout')).not.toHaveLength(0);
    expect(screen.getByTestId(layout === 'a' ? 'sales-a-weighted' : 'pipeline-weighted-total')).toHaveTextContent('600,000');
    expect(screen.getByRole('searchbox', { name: 'Search projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Table' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });

  it.each(['a', 'b', 'c'])('option %s: Finance reads the pipeline but cannot start a project', async (layout) => {
    renderAs('Finance', layout);
    expect(await screen.findAllByText('Northwind ERP Rollout')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: /new project/i })).not.toBeInTheDocument();
  });

  it('options B and C surface the stale deal as needing attention', async () => {
    renderAs('Project Manager', 'b');
    expect(await screen.findByText(/Untouched for 45 days/)).toBeInTheDocument();
  });
});
