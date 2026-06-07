import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const tsState: { data: typeof sheets | []; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
  data: sheets,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
vi.mock('@/src/hooks/useTimesheets', () => ({
  useTimesheets: () => tsState,
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'eng-1', org_id: 'o1' }, role: 'Engineer' }),
}));

const renderPane = () => render(<MemoryRouter><EngineerDashboard /></MemoryRouter>);

beforeEach(() => {
  tsState.data = sheets;
  tsState.isPending = false;
  tsState.isError = false;
});

describe('EngineerDashboard KPI grid — monotonic arbitrary breakpoints (C1)', () => {
  it('KPI band uses only arbitrary min-[] variants — no named sm: mixed in', () => {
    const { container } = renderPane();
    const band = container.querySelector('[aria-label="My KPIs"]') as HTMLElement;
    expect(band.className).toContain('min-[560px]:grid-cols-2');
    expect(band.className).not.toContain('sm:grid-cols');
  });
});

describe('EngineerDashboard (real hours, deferred tasks)', () => {
  it('sums hours this week from the latest sheet (8 + 7.5 = 15.5)', () => {
    renderPane();
    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('15.5');
  });
  it('shows the latest timesheet status pill', () => {
    renderPane();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
  it('G4: with no current timesheet, the status reads "None this period" (no em-dash)', () => {
    tsState.data = [];
    renderPane();
    const tile = screen.getByTestId('kpi-timesheet-status');
    expect(tile).toHaveTextContent('None this period');
    expect(tile.textContent).not.toContain('—');
  });
  it('does NOT render a tasks coming-soon placeholder (removed; tracked in backlog)', () => {
    renderPane();
    expect(screen.queryByText(/Task tracking is coming soon/i)).not.toBeInTheDocument();
  });
  it('renders a weekly-hours breakdown labelled for a11y', () => {
    renderPane();
    expect(screen.getByRole('group', { name: /Hours this week by day/i })).toBeInTheDocument();
  });
});
