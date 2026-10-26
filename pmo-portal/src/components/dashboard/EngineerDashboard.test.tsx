import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { EngineerDashboard } from './EngineerDashboard';
import { PageFrame } from '@/src/components/shell';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function mondayOf(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
  return monday;
}

const currentWeekStartDate = mondayOf(new Date());
const olderWeekStartDate = new Date(currentWeekStartDate);
olderWeekStartDate.setDate(olderWeekStartDate.getDate() - 7);
const currentWeekStart = dateKey(currentWeekStartDate);
const olderWeekStart = dateKey(olderWeekStartDate);
const currentTuesday = new Date(currentWeekStartDate);
currentTuesday.setDate(currentTuesday.getDate() + 1);

// Sheets arrive newest-first; only an exact calendar-week match is current.
type TestSheet = {
  id: string;
  status: string;
  week_start_date: string;
  user_id: string;
  org_id: string;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  entries: Array<{
    id: string;
    hours: number;
    entry_date: string;
    project_id: string;
    timesheet_id: string;
    org_id: string;
    notes: string | null;
    project: { name: string; code: string | null };
  }>;
};

const sheets: TestSheet[] = [
  {
    id: 's1', status: 'Draft', week_start_date: currentWeekStart, user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e1', hours: 8, entry_date: currentWeekStart, project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
      { id: 'e2', hours: 7.5, entry_date: dateKey(currentTuesday), project_id: 'p1', timesheet_id: 's1', org_id: 'o1', notes: null, project: { name: 'A', code: null } },
    ],
  },
  {
    id: 's0', status: 'Approved', week_start_date: olderWeekStart, user_id: 'eng-1', org_id: 'o1',
    submitted_at: null, approved_at: null, approved_by: null,
    entries: [
      { id: 'e0', hours: 40, entry_date: olderWeekStart, project_id: 'p1', timesheet_id: 's0', org_id: 'o1', notes: 'Earlier entry', project: { name: 'A', code: null } },
    ],
  },
];

const tsState: { data: TestSheet[] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
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

const renderPane = (locale: 'en' | 'id' = 'en') => {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  return render(
    <BahasaProvider locale={locale}>
      <MemoryRouter>
        <PageFrame breadcrumb={[
          { label: locale === 'id' ? 'Beranda' : 'Home', href: '/' },
          { label: locale === 'id' ? 'Dasbor' : 'Dashboard' },
        ]}>
          <EngineerDashboard />
        </PageFrame>
      </MemoryRouter>
    </BahasaProvider>,
  );
};

beforeEach(() => {
  tsState.data = sheets;
  tsState.isPending = false;
  tsState.isError = false;
});

describe('EngineerDashboard localization and weekly facts', () => {
  it('AC-UXA-002: localizes the week, status, day summaries and action while retaining values', () => {
    renderPane('id');
    expect(screen.getByRole('heading', { name: 'Dashboard saya' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Beranda');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Dasbor');
    expect(screen.getByTestId('engineer-week-scope')).toHaveAttribute('data-week-start', currentWeekStart);
    expect(screen.getByRole('link', { name: 'Catat jam kerja minggu ini' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByRole('heading', { name: 'Minggu ini · 15,5 jam' })).toBeInTheDocument();
    expect(screen.getByText('Draf')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Jam minggu ini menurut hari' })).toBeInTheDocument();
    expect(screen.getByText('Jam kerja minggu ini menurut hari')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Jam minggu ini menurut proyek' })).toBeInTheDocument();
    expect(screen.getByText('Entri terbaru')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Sen: 8 jam' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Minggu ini: 15,5 jam' })).toBeInTheDocument();
    expect(screen.getByTestId('engineer-hours-total')).toHaveTextContent('15,5');
    expect(sheets[0].entries[0].hours).toBe(8);
    expect(sheets[0].status).toBe('Draft');

    cleanup();
    const dates = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(currentWeekStartDate);
      date.setDate(date.getDate() + index);
      return dateKey(date);
    });
    tsState.data = [{ ...sheets[0], entries: dates.map((entry_date, index) => ({ ...sheets[0].entries[0], id: `day-${index}`, entry_date, hours: index + 1 })) }];
    renderPane('id');
    for (const [name, hours] of [['Sen', 1], ['Sel', 2], ['Rab', 3], ['Kam', 4], ['Jum', 5], ['Sab', 6], ['Min', 7]] as const) {
      expect(screen.getByRole('progressbar', { name: `${name}: ${hours} jam` })).toBeInTheDocument();
    }
  });
});

describe('Engineer dashboard weekly summary', () => {
  it('AC-806-ENG-01: an older latest sheet stays historical when this calendar week has no sheet', () => {
    tsState.data = [sheets[1]];
    renderPane();

    expect(screen.getByTestId('engineer-week-scope')).toHaveAttribute('data-week-start', currentWeekStart);
    expect(screen.getByTestId('engineer-hours-total')).toHaveTextContent('0');
    expect(screen.getByTestId('engineer-timesheet-status')).toHaveTextContent('No timesheet this week');
    expect(screen.getByTestId('engineer-timesheet-status')).not.toHaveTextContent('Approved');
    expect(screen.getByTestId('engineer-recent-row-e0')).toHaveTextContent('Earlier entry');
    expect(screen.getByRole('link', { name: "Log this week's hours" })).toHaveAttribute('href', '/timesheets');
  });

  it('AC-806-ENG-02: a failed timesheet read keeps the week scope and action but withholds hours and status', () => {
    tsState.data = undefined;
    tsState.isError = true;
    renderPane();

    expect(screen.getByTestId('engineer-week-scope')).toHaveAttribute('data-week-start', currentWeekStart);
    expect(screen.getByTestId('engineer-hours-total')).toHaveTextContent('—');
    expect(screen.getByTestId('engineer-timesheet-status')).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: "Log this week's hours" })).toHaveAttribute('href', '/timesheets');
    expect(screen.getAllByRole('button', { name: /Retry/i })).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your timesheets");
    expect(screen.queryByText('Hours this week by day')).not.toBeInTheDocument();
    expect(screen.queryByText("This week's hours by project")).not.toBeInTheDocument();
    expect(screen.queryByText('Recent entries')).not.toBeInTheDocument();
  });

  it('AC-806-ENG-03: a known-empty week has one date and omits empty breakdown cards', () => {
    tsState.data = [];
    renderPane();

    const week = screen.getByTestId('engineer-week-scope');
    expect(screen.getAllByText(week.textContent!)).toHaveLength(1);
    expect(screen.getByTestId('engineer-empty-week-note')).toHaveTextContent('No hours are recorded for this calendar week yet.');
    expect(screen.queryByText('Hours this week by day')).not.toBeInTheDocument();
    expect(screen.queryByText('This week by project')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Log this week's hours" })).toHaveAttribute('href', '/timesheets');
  });
});

// ── Phase 3: T7–T10 — densification tests ───────────────────────────────────

describe('EngineerDashboard T7: This week by project bars', () => {
  it('T7: renders a "This week by project" group with one HoursBar per distinct project', () => {
    renderPane();
    const group = screen.getByRole('group', { name: /This week's hours by project/i });
    expect(group).toBeInTheDocument();
    // fixture has p1 only — one progressbar
    expect(group.querySelectorAll('[role="progressbar"]')).toHaveLength(1);
  });
  it('T7: shows the project name inside the group', () => {
    renderPane();
    const group = screen.getByRole('group', { name: /This week's hours by project/i });
    expect(group.textContent).toContain('A'); // project name from fixture
  });
});

describe('EngineerDashboard T9: Recent entries card', () => {
  it('T9: renders "Recent entries" heading', () => {
    renderPane();
    expect(screen.getByText(/Recent entries/i)).toBeInTheDocument();
  });
  it('T9: shows the latest eight entries with project, date, note and hours', () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      ...sheets[0].entries[0],
      id: `recent-${String(index).padStart(2, '0')}`,
      entry_date: dateKey(new Date(currentWeekStartDate.getFullYear(), currentWeekStartDate.getMonth(), currentWeekStartDate.getDate() + Math.min(index, 6))),
      notes: index === 9 ? 'A long note that remains visible in the recent entry row instead of being clipped.' : `Entry ${index}`,
      hours: index + 1,
    }));
    tsState.data = [{ ...sheets[0], entries }];
    renderPane();
    const recentList = screen.getByRole('list', { name: 'Recent entries' });
    const rows = within(recentList).getAllByRole('listitem');
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveAttribute('data-testid', 'engineer-recent-row-recent-06');
    expect(screen.getByTestId('engineer-recent-row-recent-09')).toHaveTextContent('A long note that remains visible in the recent entry row instead of being clipped.');
    expect(screen.getByTestId('engineer-recent-row-recent-09')).toHaveTextContent('10');
    expect(rows[7]).toHaveAttribute('data-testid', 'engineer-recent-row-recent-02');
  });
});

describe('EngineerDashboard T10: single CTA rule', () => {
  it('T10: empty state for recent entries has NO action button (no competing CTA)', () => {
    tsState.data = [];
    renderPane();
    expect(screen.getAllByRole('link', { name: "Log this week's hours" })).toHaveLength(1);
  });
});

describe('EngineerDashboard (real hours, deferred tasks)', () => {
  it('sums hours this week from the latest sheet (8 + 7.5 = 15.5)', () => {
    renderPane();
    expect(screen.getByTestId('engineer-hours-total')).toHaveTextContent('15.5');
  });
  it('shows the latest timesheet status pill', () => {
    renderPane();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });
  it('G4: with no current timesheet, the status reads "None this period" (no em-dash)', () => {
    tsState.data = [];
    renderPane();
    const status = screen.getByTestId('engineer-timesheet-status');
    expect(status).toHaveTextContent('No timesheet this week');
    expect(status.textContent).not.toContain('—');
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
