import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { AuthContext, type Role } from '@/src/auth/AuthContext';
import { BahasaProvider } from '@/test/bahasa';
import type { TimesheetForReview } from '@/src/lib/db/timesheets';

const h = vi.hoisted(() => ({
  role: 'Engineer' as Role,
  builtInRole: 'hr_officer' as string | null,
  sheets: [] as TimesheetForReview[],
  projects: [
    { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' },
    { id: 'p-beta', name: 'Beta Tank', short_name: null, code: 'P-02' },
  ],
  listForReview: vi.fn(),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({
    currentUser: { id: 'u-hr', org_id: 'org-1', built_in_role: h.builtInRole },
    role: h.role,
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: h.projects, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    timesheet: {
      listForReview: (...args: unknown[]) => h.listForReview(...args),
    },
  },
}));

import TimesheetReview from './TimesheetReview';
import { TimesheetWeekToolbar } from './timesheets/TimesheetWeekToolbar';

const UrlProbe = () => {
  const loc = useLocation();
  return <output data-testid="url-search">{loc.search}</output>;
};

const sampleSheets: TimesheetForReview[] = [
  {
    id: 'ts-1',
    org_id: 'org-1',
    user_id: 'u-sari',
    week_start_date: '2026-11-16',
    status: 'Submitted',
    submitted_at: '2026-11-22T10:00:00Z',
    approved_by: null,
    approved_at: null,
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    owner: { id: 'u-sari', full_name: 'Sari Putri' },
    entries: [
      {
        id: 'e-1',
        org_id: 'org-1',
        timesheet_id: 'ts-1',
        project_id: 'p-alpha',
        work_order_id: null,
        discipline_id: null,
        entry_date: '2026-11-16',
        hours: 8,
        notes: 'Welding inspection',
        project: { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' },
        work_order: null,
      },
      {
        id: 'e-2',
        org_id: 'org-1',
        timesheet_id: 'ts-1',
        project_id: 'p-alpha',
        work_order_id: null,
        discipline_id: null,
        entry_date: '2026-11-17',
        hours: 7.5,
        notes: null,
        project: { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' },
        work_order: null,
      },
    ],
  },
  {
    id: 'ts-2',
    org_id: 'org-1',
    user_id: 'u-budi',
    week_start_date: '2026-11-02',
    status: 'Approved',
    submitted_at: '2026-11-08T10:00:00Z',
    approved_by: 'u-pm',
    approved_at: '2026-11-09T09:00:00Z',
    rejected_by: null,
    rejected_at: null,
    rejection_reason: null,
    owner: { id: 'u-budi', full_name: 'Budi Santoso' },
    entries: [
      {
        id: 'e-3',
        org_id: 'org-1',
        timesheet_id: 'ts-2',
        project_id: 'p-beta',
        work_order_id: null,
        discipline_id: null,
        entry_date: '2026-11-03',
        hours: 6,
        notes: null,
        project: { id: 'p-beta', name: 'Beta Tank', short_name: null, code: 'P-02' },
        work_order: null,
      },
    ],
  },
];

const mountReview = (initialEntry = '/timesheets/review', bahasa = false) => {
  const tree = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={{ currentUser: { id: 'u-hr', org_id: 'org-1', built_in_role: h.builtInRole }, role: h.role } as never}>
        <ImpersonationProvider realRole={h.role}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <ToastProvider>
              <TimesheetReview />
              <UrlProbe />
            </ToastProvider>
          </MemoryRouter>
        </ImpersonationProvider>
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return render(bahasa ? <BahasaProvider>{tree}</BahasaProvider> : tree);
};

describe('HR Officer timesheet review list (AC-HTR-001..006)', () => {
  beforeEach(() => {
    h.role = 'Engineer';
    h.builtInRole = 'hr_officer';
    h.sheets = sampleSheets;
    h.listForReview.mockReset().mockImplementation(async () => h.sheets);
  });

  it('AC-HTR-001 shows the Review timesheets doorway on TimesheetWeekToolbar for HR Officer and blocks non-HR Engineers on /timesheets/review', () => {
    const { unmount } = render(
      <ImpersonationProvider realRole="Engineer">
        <MemoryRouter>
          <TimesheetWeekToolbar
            weekRangeLabel="16 – 22 Nov 2026"
            isApprover={false}
            canReview
            pendingCount={null}
            busy={false}
            stepWeek={vi.fn()}
            pendingWeekDelta={null}
            discardHasInvalid={false}
            onCancelDiscard={vi.fn()}
            onConfirmDiscard={vi.fn()}
          />
        </MemoryRouter>
      </ImpersonationProvider>,
    );
    expect(screen.getByRole('link', { name: 'Review timesheets' })).toHaveAttribute('href', '/timesheets/review');
    unmount();

    h.builtInRole = 'storekeeper';
    mountReview();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it('AC-HTR-003, AC-HTR-005 lists timesheets, expands read-only entries, and renders NO approve, return, reject or reopen action', async () => {
    const user = userEvent.setup();
    mountReview();
    const list = within(await screen.findByTestId('timesheet-review-list'));
    expect(list.getByText('Sari Putri')).toBeInTheDocument();
    expect(list.getByText('Budi Santoso')).toBeInTheDocument();
    // The week's hours sit in the Hours column.
    expect(list.getByRole('cell', { name: '15.5' })).toBeInTheDocument();

    await user.click(list.getByRole('button', { name: /Show entries for Sari Putri/i }));
    // The entries open read-only in the side drawer.
    expect(within(await screen.findByRole('dialog')).getAllByText(/Alpha Jetty/).length).toBeGreaterThan(0);

    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /return/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reopen/i })).toBeNull();
  });

  it('AC-TRW-001 shows each line work order attribution separately when a week spans two work orders on the same project', async () => {
    const user = userEvent.setup();
    h.sheets = [
      {
        ...sampleSheets[0],
        entries: [
          {
            id: 'e-wo1',
            org_id: 'org-1',
            timesheet_id: 'ts-1',
            project_id: 'p-alpha',
            work_order_id: 'wo-1',
            discipline_id: null,
            entry_date: '2026-11-16',
            hours: 8,
            notes: null,
            project: { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' },
            work_order: { wo_number: 'WO-001', title: 'Structural erection' },
          },
          {
            id: 'e-wo2',
            org_id: 'org-1',
            timesheet_id: 'ts-1',
            project_id: 'p-alpha',
            work_order_id: 'wo-2',
            discipline_id: null,
            entry_date: '2026-11-17',
            hours: 5,
            notes: null,
            project: { id: 'p-alpha', name: 'Alpha Jetty', short_name: null, code: 'P-01' },
            work_order: { wo_number: 'WO-002', title: 'Piping tie-in' },
          },
        ],
      },
    ];
    mountReview();
    const list = within(await screen.findByTestId('timesheet-review-list'));
    await user.click(list.getByRole('button', { name: /Show entries for Sari Putri/i }));
    const drawer = within(await screen.findByRole('dialog'));
    expect(drawer.getByText('WO-001 · Structural erection')).toBeInTheDocument();
    expect(drawer.getByText('WO-002 · Piping tie-in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /return/i })).toBeNull();
  });

  it('AC-HTR-004 filters by period, project and person and keeps filter values in the URL', async () => {
    const user = userEvent.setup();
    mountReview();
    const list = within(await screen.findByTestId('timesheet-review-list'));
    expect(list.getByText('Sari Putri')).toBeInTheDocument();

    // Filter by person
    await user.selectOptions(screen.getByRole('combobox', { name: 'Person' }), 'u-sari');
    expect(list.getByText('Sari Putri')).toBeInTheDocument();
    expect(list.queryByText('Budi Santoso')).toBeNull();
    expect(screen.getByTestId('url-search').textContent).toContain('person=u-sari');

    // Clear person, filter by project
    await user.selectOptions(screen.getByRole('combobox', { name: 'Person' }), '');
    await user.selectOptions(screen.getByLabelText('Project'), 'p-beta');
    expect(list.getByText('Budi Santoso')).toBeInTheDocument();
    expect(list.queryByText('Sari Putri')).toBeNull();
    expect(screen.getByTestId('url-search').textContent).toContain('project=p-beta');

    // Clear project, filter by period (From / To)
    await user.selectOptions(screen.getByLabelText('Project'), '');
    const fromInput = screen.getByLabelText('From');
    await user.type(fromInput, '2026-11-15');
    expect(list.getByText('Sari Putri')).toBeInTheDocument();
    expect(list.queryByText('Budi Santoso')).toBeNull();
    expect(screen.getByTestId('url-search').textContent).toContain('from=2026-11-15');
    expect(h.listForReview).toHaveBeenCalledTimes(1);
  });

  it('AC-HTR-006 renders in Bahasa Indonesia', async () => {
    mountReview('/timesheets/review', true);
    expect(await screen.findByRole('heading', { name: /Tinjauan/i })).toBeInTheDocument();
    const toolbar = screen.getByTestId('list-page-toolbar');
    expect(within(toolbar).getByLabelText('Proyek')).toBeInTheDocument();
    expect(within(toolbar).getByLabelText('Orang')).toBeInTheDocument();
  });
});
