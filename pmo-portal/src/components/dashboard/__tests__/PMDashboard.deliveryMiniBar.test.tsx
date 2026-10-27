import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PMDashboard } from '../PMDashboard';

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  usePMDashboardProjects: () => ({
    data: [
      {
        id: 'p1',
        name: 'Meridian Steelworks',
        contract_value: 4_000_000, currency: 'USD',
        budget: 3_000_000,
        spent: 1_000_000,
        realized_margin_pct: null,
        contract_remaining: 3_000_000,
        status: 'Ongoing Project',
        project_manager_id: 'pm-1',
        client_name: 'Acme',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: { p1: 32 } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: () => ({ data: { pmo_project_number: 'PRJ-26-0001' }, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useProjectStatusLabel', () => ({ useProjectStatusLabel: () => (status: string) => status }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('../restructure/useNeedsYou', () => ({
  useNeedsYou: () => ({ items: [], pmOverdueTasksByProject: {}, isPending: false, isError: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

describe('PMDashboard delivery mini-bar', () => {
  it('preserves the delivery progress label and project status in the project area', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><PMDashboard /></MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Delivery 32%')).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Meridian Steelworks' })).toHaveAttribute('href', '/projects/p1');
  });
});
