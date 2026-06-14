import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { PMDashboard } from '../PMDashboard';

/**
 * W2-4d — PMDashboard KPI band shows "—" (not 0/$0/0) when projects fetch errors.
 * AC-W2-4-04: "My projects", "My contract value", and "At risk" tiles show "—" on error.
 */

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
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
  it('AC-W2-4-04: shows "—" (not 0/$0/0) in the three data-driven KPI tiles on error', () => {
    renderPMDashboard();

    const myProjects = screen.getByTestId('kpi-my-projects');
    const contractValue = screen.getByTestId('kpi-my-contract-value');
    const atRisk = screen.getByTestId('kpi-at-risk');

    // Each tile should show em-dash, not a fabricated 0/$0/0
    expect(within(myProjects).getByText('—')).toBeInTheDocument();
    expect(within(contractValue).getByText('—')).toBeInTheDocument();
    expect(within(atRisk).getByText('—')).toBeInTheDocument();

    // Must NOT show fabricated zeros
    expect(within(myProjects).queryByText('0')).toBeNull();
    expect(within(contractValue).queryByText('$0')).toBeNull();
  });
});
