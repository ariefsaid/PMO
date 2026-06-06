import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PMDashboard } from './PMDashboard';

const mine = [
  { id: 'p1', name: 'My Project A', contract_value: 4_000_000, budget: 3_000_000, spent: 1_000_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: { name: 'Acme' }, pm: null },
  { id: 'p2', name: 'My Project B', contract_value: 2_000_000, budget: 1_000_000, spent: 980_000, status: 'Ongoing Project', project_manager_id: 'pm-1', client: { name: 'Beta' }, pm: null },
];
const other = { id: 'p9', name: 'Someone Else', contract_value: 9_000_000, budget: 1, spent: 0, status: 'Ongoing Project', project_manager_id: 'pm-2', client: null, pm: null };

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [...mine, other], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [{ id: 't1' }, { id: 't2' }], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

const renderPane = () => render(<MemoryRouter><PMDashboard /></MemoryRouter>);

describe('PMDashboard (real — my projects + timesheets awaiting)', () => {
  it('counts only my projects (2 of 3)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-my-projects')).toHaveTextContent('2');
  });
  it('sums my contract value, not the whole org', () => {
    renderPane();
    expect(screen.getByTestId('kpi-my-contract-value')).toHaveTextContent('$6,000,000');
  });
  it('counts my at-risk projects (utilization > 90%)', () => {
    renderPane();
    // Project B is 98% utilized → 1 at-risk
    expect(screen.getByTestId('kpi-at-risk')).toHaveTextContent('1');
  });
  it('shows timesheets awaiting approval = 2 (real)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-timesheets-awaiting')).toHaveTextContent('2');
  });
  it('renders the procurement-approvals half as a coming-soon placeholder (not summed)', () => {
    renderPane();
    expect(screen.getByText(/Procurement approvals — coming soon/i)).toBeInTheDocument();
  });
});
