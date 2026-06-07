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

// ── Phase 3: T7–T10 — densification tests ───────────────────────────────────

describe('EngineerDashboard T7: This week by project bars', () => {
  it('T7: renders a "This week by project" group with one HoursBar per distinct project', () => {
    renderPane();
    const group = screen.getByRole('group', { name: /This week by project/i });
    expect(group).toBeInTheDocument();
    // fixture has p1 only — one progressbar
    expect(group.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });
  it('T7: shows the project name inside the group', () => {
    renderPane();
    const group = screen.getByRole('group', { name: /This week by project/i });
    expect(group.textContent).toContain('A'); // project name from fixture
  });
});

describe('EngineerDashboard T9: Recent entries card', () => {
  it('T9: renders "Recent entries" heading', () => {
    renderPane();
    expect(screen.getByText(/Recent entries/i)).toBeInTheDocument();
  });
  it('T9: shows up to 8 recent entries as list items', () => {
    renderPane();
    // fixture has 3 entries total
    expect(document.querySelectorAll('li').length).toBeGreaterThanOrEqual(1);
  });
});

describe('EngineerDashboard T10: single CTA rule', () => {
  it('T10: empty state for recent entries has NO action button (no competing CTA)', () => {
    tsState.data = [];
    renderPane();
    // hours-card shows Log hours CTA but recent-entries empty must NOT add another
    const buttons = Array.from(document.querySelectorAll('button'));
    const logButtons = buttons.filter((b) => /log hours/i.test(b.textContent ?? ''));
    // At most ONE Log hours button
    expect(logButtons.length).toBeLessThanOrEqual(1);
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
