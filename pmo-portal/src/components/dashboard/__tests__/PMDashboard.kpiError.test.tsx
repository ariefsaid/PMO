import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { PMDashboard } from '../PMDashboard';

/**
 * W2-4d — PM delivery evidence remains unavailable, not zero, when project data fails.
 * AC-W2-4-04: scope keeps an unavailable state and offers a local retry.
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

describe('PMDashboard — delivery worklist on projects fetch error (AC-W2-4-04)', () => {
  it('AC-W2-4-04: shows unavailable scope and retry without fabricated zero values', () => {
    renderPMDashboard();

    expect(screen.getByTestId('pm-project-scope')).toHaveTextContent('Not available yet');
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your projects");
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByTestId('pm-projects-empty')).not.toBeInTheDocument();
  });
});
