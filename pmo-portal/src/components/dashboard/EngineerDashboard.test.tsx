import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { EngineerDashboard } from './EngineerDashboard';
import { BahasaProvider } from '@/test/bahasa';

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

const tsState: { data: typeof sheets | [] | undefined; isPending: boolean; isError: boolean; refetch: ReturnType<typeof vi.fn> } = {
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

const renderPane = (locale: 'en' | 'id' = 'en') => render(
  <BahasaProvider locale={locale}>
    <MemoryRouter><EngineerDashboard /></MemoryRouter>
  </BahasaProvider>,
);

beforeEach(() => {
  tsState.data = sheets;
  tsState.isPending = false;
  tsState.isError = false;
});

describe('EngineerDashboard KPI grid — monotonic arbitrary breakpoints (C1)', () => {
  it('AC-UXA-002: localizes the week, status, day summaries and actions while retaining data', () => {
    renderPane('id');
    expect(screen.getByRole('heading', { name: 'Dashboard saya' })).toBeInTheDocument();
    expect(screen.getByText('Jam kerja minggu ini dan status timesheet Anda.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Catat jam kerja minggu ini' })).toHaveAttribute('href', '/timesheets');
    expect(screen.getByText('Jam minggu ini')).toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button', { name: 'Bantuan: Jam minggu ini' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Total jam pada timesheet terbaru Anda.');
    expect(screen.getByText('Draf')).toBeInTheDocument();
    expect(screen.getByText('minggu mulai 2026-06-01')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Jam minggu ini menurut hari' })).toBeInTheDocument();
    expect(screen.getByText('Jam Kerja Minggu Ini')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Minggu ini menurut proyek' })).toBeInTheDocument();
    expect(screen.getByText('Entri terbaru')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Sen: 8 jam' })).toBeInTheDocument();
    expect(screen.getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getByText('15.5 jam')).toBeInTheDocument();
    expect(screen.getAllByText('Tidak ada catatan').length).toBeGreaterThan(0);
    expect(screen.getByTestId('kpi-hours-week')).toHaveTextContent('15.5');
    expect(sheets[0].entries[0].hours).toBe(8);
    expect(sheets[0].status).toBe('Draft');

    cleanup();
    const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07'];
    tsState.data = [{ ...sheets[0], entries: days.map((entry_date, index) => ({ ...sheets[0].entries[0], id: `day-${index}`, entry_date, hours: index + 1 })) }];
    renderPane('id');
    for (const [name, hours] of [['Sen', 1], ['Sel', 2], ['Rab', 3], ['Kam', 4], ['Jum', 5], ['Sab', 6], ['Min', 7]] as const) {
      expect(screen.getByRole('progressbar', { name: `${name}: ${hours} jam` })).toBeInTheDocument();
    }

    cleanup();
    tsState.data = [{ ...sheets[0], status: 'Approved' }];
    renderPane('id');
    expect(screen.getByText('Disetujui')).toBeInTheDocument();

    cleanup();
    tsState.data = undefined; tsState.isPending = true; tsState.isError = false;
    renderPane('id');
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText('Memuat…').length).toBeGreaterThanOrEqual(3);

    cleanup();
    tsState.data = undefined; tsState.isPending = false; tsState.isError = true;
    renderPane('id');
    expect(screen.getAllByText('Gagal memuat timesheet Anda').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);

    cleanup();
    tsState.data = []; tsState.isPending = false; tsState.isError = false;
    renderPane('id');
    expect(screen.getByTestId('kpi-timesheet-status')).toHaveTextContent('Tidak ada untuk periode ini');
    expect(screen.getAllByText('Belum ada jam kerja minggu ini').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Buka timesheet untuk mencatat jam kerja minggu ini' })).toHaveAttribute('href', '/timesheets');

    cleanup();
    tsState.data = [{ ...sheets[0], entries: sheets[0].entries.map((entry) => ({ ...entry, hours: 0 })) }];
    renderPane('id');
    expect(screen.getByText('Catat jam kerja untuk melihat ringkasan mingguan.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'A: 0 jam' })).toBeInTheDocument();

    cleanup();
    tsState.data = [{ ...sheets[0], entries: [] }];
    renderPane('id');
    expect(screen.getByText('Jam yang Anda catat akan muncul di sini.')).toBeInTheDocument();
  });
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

  it('M-1: hours bars stay neutral data bars, not blue action bars', () => {
    const { container } = renderPane();
    const dayFill = container.querySelector('[aria-label="Mon: 8 hours"] > span') as HTMLElement;
    expect(dayFill.className).toContain('bg-muted-foreground');
    expect(dayFill.className).not.toContain('bg-primary');

    const projectFill = screen.getByRole('progressbar', { name: /A: 15.5 hours/i }).querySelector('span') as HTMLElement;
    expect(projectFill.className).toContain('bg-muted-foreground');
    expect(projectFill.className).not.toContain('bg-primary');
  });
});
