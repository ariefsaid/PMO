import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
        short_name: 'Steelworks',
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

describe('PMDashboard short names (AC-002 #1325)', () => {
  it('shows the short project name once in the merged delivery worklist and preserves its full identity as the title', () => {
    render(<MemoryRouter><PMDashboard /></MemoryRouter>);
    const links = screen.getAllByRole('link', { name: 'Steelworks' });
    expect(links).toHaveLength(1);
    for (const link of links) expect(link).toHaveAttribute('title', 'Meridian Steelworks');
    expect(screen.queryByText('Meridian Steelworks')).toBeNull();
  });
});
