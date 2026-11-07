import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQueryClient as render } from '@/test/renderWithQueryClient';
import { MemoryRouter } from 'react-router';
import React from 'react';
import SalesLayoutRoute from '../SalesLayoutRoute';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => false }));
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

describe('#1426 sales layout options on phone', () => {
  it.each(['a', 'b', 'c'])('option %s: one search, figures row; B has a single stage control', async (layout) => {
    renderAs('Project Manager', layout);
    expect(await screen.findAllByText('Northwind ERP Rollout')).not.toHaveLength(0);
    expect(screen.getAllByRole('searchbox', { name: 'Search projects' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Pipeline figures' })).toHaveTextContent('600,000');
    if (layout === 'b') {
      expect(screen.getAllByRole('combobox', { name: 'Pipeline stage' })).toHaveLength(1);
      expect(screen.queryByRole('tab', { name: 'Open' })).not.toBeInTheDocument();
    }
  });
});
