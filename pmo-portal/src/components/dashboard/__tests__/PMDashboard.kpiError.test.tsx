import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PMDashboard } from '../PMDashboard';

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
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: undefined }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const renderPMDashboard = () =>
  render(
    <MemoryRouter>
      <PMDashboard />
    </MemoryRouter>,
  );

describe('PMDashboard — KPI band on projects fetch error (AC-W2-4-04)', () => {
  it('AC-W2-4-04: omits KPI values and shows the project read error with retry', () => {
    renderPMDashboard();

    const myProjects = screen.getByTestId('kpi-my-projects');
    const contractValue = screen.getByTestId('kpi-my-contract-value');
    const atRisk = screen.getByTestId('kpi-at-risk');

    // Each tile omits its unavailable figure; ListState carries the explanation.
    expect(within(myProjects).queryByText('—')).toBeNull();
    expect(within(contractValue).queryByText('—')).toBeNull();
    expect(within(atRisk).queryByText('—')).toBeNull();

    // Must NOT show fabricated zeros
    expect(within(myProjects).queryByText('0')).toBeNull();
    expect(within(contractValue).queryByText('$0')).toBeNull();
    expect(screen.getAllByText("Couldn't load your projects").length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
});
