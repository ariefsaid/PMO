import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EngineerDashboard } from './EngineerDashboard';

// listTimesheets returns newest-first; the latest sheet is "this week".
const sheets = [
  {
    id: 's1', status: 'Draft', week_start_date: '2026-06-01', user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e1', hours: 8, entry_date: '2026-06-01', project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
      { id: 'e2', hours: 7.5, entry_date: '2026-06-02', project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
    ],
  },
  {
    id: 's0', status: 'Approved', week_start_date: '2026-05-25', user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e0', hours: 40, entry_date: '2026-05-25', project_id: 'p1', timesheet_id: 's0', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
    ],
  },
];

vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => ({ data: sheets, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'eng-1', org_id: 'o1' }, role: 'Engineer' }),
}));

const renderPane = () => render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);

describe('EngineerDashboard (real hours, deferred tasks)', () => {
  it('sums hours this week from the latest sheet (8 + 7.5 = 15.5)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('15.5');
  });
  it('shows the latest timesheet status pill', () => {
    renderPane();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
  it('renders the tasks block as a single coming-soon placeholder (no mock tasks)', () => {
    renderPane();
    expect(screen.getByText(/Task tracking is coming soon/i)).toBeInTheDocument();
  });
  it('renders a weekly-hours breakdown labelled for a11y', () => {
    renderPane();
    expect(screen.getByRole('group', { name: /Hours this week by day/i })).toBeInTheDocument();
  });
});
