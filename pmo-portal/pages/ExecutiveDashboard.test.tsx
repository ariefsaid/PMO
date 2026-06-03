import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import ExecutiveDashboard from './ExecutiveDashboard';

const populated = {
  active_projects: 2, total_contract_value: 8000000, avg_gross_margin: 0.30162, projects_at_risk: 1,
  projects_by_status: [
    { status: 'Ongoing Project', count: 2 }, { status: 'Tender Submitted', count: 1 },
    { status: 'PQ Submitted', count: 1 },
  ],
  procurements_by_status: [
    { status: 'Draft', count: 1 }, { status: 'Requested', count: 1 }, { status: 'Vendor Quoted', count: 1 },
    { status: 'Ordered', count: 1 }, { status: 'Paid', count: 1 },
  ],
  top_projects: [
    { id: 'p1', name: 'Innovate Corp HQ Fit-Out', client_name: 'Innovate Corp',
      contract_value: 5000000, budget: 4700000, spent: 2100000, status: 'Ongoing Project' },
    { id: 'p3', name: 'Acme Internal Platform', client_name: 'Innovate Corp',
      contract_value: 3000000, budget: 2000000, spent: 1900000, status: 'Ongoing Project' },
  ],
};
const dashState: {
  data: typeof populated | { active_projects: 0; total_contract_value: 0; avg_gross_margin: 0; projects_at_risk: 0; projects_by_status: never[]; procurements_by_status: never[]; top_projects: never[] };
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = { data: populated, isPending: false, isError: false, refetch: vi.fn() };

vi.mock('@/src/hooks/useDashboard', () => ({ useDashboard: () => dashState }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive' }) }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Executive' }),
}));

const renderPage = () => render(<MemoryRouter><ExecutiveDashboard /></MemoryRouter>);

describe('ExecutiveDashboard (real data)', () => {
  it('renders Active Projects = 2 and Total Contract Value $8,000,000 (AC-701)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('kpi-active-projects')).toHaveTextContent('2');
    expect(screen.getByTestId('kpi-total-contract-value')).toHaveTextContent('$8,000,000');
  });
  it('renders Avg Gross Margin 30.2% and Projects at Risk 1 (AC-702)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('kpi-avg-gross-margin')).toHaveTextContent('30.2%');
    expect(screen.getByTestId('kpi-projects-at-risk')).toHaveTextContent('1');
  });
  it('pipeline region shows the Ongoing count 2 (AC-703)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('dashboard-pipeline')).toHaveTextContent('2');
  });
  it('procurement-by-status region shows 5 statuses (AC-704)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByTestId('dashboard-proc-status')).toHaveTextContent('5');
  });
  it('top projects table shows joined client name (AC-705)', () => {
    dashState.isPending = false; dashState.isError = false; dashState.data = populated;
    renderPage();
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getAllByText('Innovate Corp').length).toBeGreaterThan(0);
  });
});

describe('ExecutiveDashboard states', () => {
  it('loading skeleton while pending (AC-706)', () => {
    dashState.isPending = true; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    dashState.isPending = false;
  });
  it('error state with retry (AC-707)', () => {
    dashState.isError = true; dashState.isPending = false;
    renderPage();
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    dashState.isError = false;
  });
  it('empty state when org has no projects/procurements (AC-708)', () => {
    dashState.data = { active_projects: 0, total_contract_value: 0, avg_gross_margin: 0,
      projects_at_risk: 0, projects_by_status: [], procurements_by_status: [], top_projects: [] };
    dashState.isPending = false; dashState.isError = false;
    renderPage();
    expect(screen.getByTestId('dashboard-empty')).toBeInTheDocument();
    dashState.data = populated;
  });
});
