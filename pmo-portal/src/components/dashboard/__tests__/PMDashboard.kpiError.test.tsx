import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PMDashboard } from '../PMDashboard';
import { pinHomeLayout } from '@/test/homeLayout';

pinHomeLayout('focused');

const { projectsRefetch } = vi.hoisted(() => ({ projectsRefetch: vi.fn() }));

/**
 * W2-4d — PMDashboard KPI band omits unavailable values when projects fetch errors.
 * AC-W2-4-04: the error state explains the failed read and offers retry without a fabricated value.
 */

// FR-L10N-020: this tree reads useOrgCurrency (org-denominated aggregates). Pinned here rather
// than left to a real query. ⚑ At LINE-START — inside a neighbouring vi.mock it parses as a
// syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useDashboard', () => ({
  usePMDashboardProjects: () => ({
    data: undefined,
    isPending: false,
    isError: true,
    refetch: projectsRefetch,
  }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: undefined }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false, refetch: vi.fn() }),
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

const renderPMDashboard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><PMDashboard /></MemoryRouter>
    </QueryClientProvider>,
  );

describe('PMDashboard — KPI band on projects fetch error (AC-W2-4-04)', () => {
  it('AC-W2-4-04: draws no contract figure, explains the project error once, and keeps retry available', () => {
    renderPMDashboard();

    // The failed read draws no contract figure (no fabricated zero) and the projects card explains it once, with retry.
    expect(screen.queryByTestId('kpi-my-contract-value')).not.toBeInTheDocument();
    expect(screen.queryByText('$0')).not.toBeInTheDocument();
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(projectsRefetch).toHaveBeenCalled();
    expect(within(screen.getByTestId('pm-projects')).getAllByText(/couldn.t load projects/i)).toHaveLength(1);
  });
});
