import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';

/** #1522 site reports list: the QS queue first (FR-DSR-017), then the filtered, paged list (AC-DSR-015). */
const h = vi.hoisted(() => ({
  realRole: 'Finance',
  builtInRole: null as string | null,
  validateRoles: [] as string[],
  rows: [] as unknown[],
  hasMore: false, queueError: false, retryQueue: vi.fn(),
  queue: [] as unknown[],
  calls: [] as Array<[unknown, number]>,
  crews: [{ id: 'c1', code: 'CR-1', name: 'Pipe crew' }] as unknown[],
}));
vi.mock('@/src/hooks/useCrews', () => ({ useCrews: () => ({ data: h.crews }) }));
vi.mock('@/src/hooks/useDailySiteReports', () => ({
  useDailySiteReports: (filter: unknown, page: number) => { h.calls.push([filter, page]); return { data: { rows: h.rows, hasMore: h.hasMore }, isPending: false, isError: false, refetch: vi.fn() }; },
  useDsrValidationQueue: (enabled: boolean) => ({ data: enabled ? h.queue : undefined, isError: h.queueError, refetch: h.retryQueue }),
}));
vi.mock('@/src/hooks/useDailyReportValidateRoles', () => ({
  useDailyReportValidateRoles: () => ({ data: h.validateRoles, isPending: false, isError: false }),
}));
vi.mock('./NewSiteReportDialog', () => ({ NewSiteReportDialog: () => <div data-testid="new-dialog" /> }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', built_in_role: h.builtInRole } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import SiteReports from './SiteReports';

const row = (id: string, status: string, crew_name: string | null = null, person_name: string | null = null) => ({ id, work_date: '2026-03-10', work_order_label: `WO ${id}`, author_name: 'Field One', status, crew_name, person_name });
const renderAt = (url = '/site-reports') => render(<MemoryRouter initialEntries={[url]}><SiteReports /></MemoryRouter>);

beforeEach(() => { h.queueError = false; h.realRole = 'Finance'; h.builtInRole = null; h.validateRoles = []; h.rows = []; h.hasMore = false; h.queue = []; h.calls.length = 0; h.crews = [{ id: 'c1', code: 'CR-1', name: 'Pipe crew' }]; });

describe('site reports list', () => {
  it('lets a reviewer identify and open each report from its row', () => {
    h.rows = [row('a', 'submitted', 'Pipe crew'), row('b', 'draft', null, 'Roster person')];
    renderAt();
    expect(screen.getByRole('link', { name: /WO a/ })).toHaveAttribute('href', '/site-reports/a');
    expect(screen.getByRole('link', { name: /WO b/ })).toHaveAttribute('href', '/site-reports/b');
    expect(screen.getByText('Person Roster person')).toBeInTheDocument();
    const reportRow = screen.getByRole('link', { name: /WO b/ }).closest('tr');
    expect(reportRow).not.toBeNull();
    expect(within(reportRow as HTMLElement).getByText('Person Roster person')).toBeInTheDocument();
  });

  it('AC-SRC-006 the list shows each report\'s crew and filters by crew in the address', async () => {
    h.rows = [row('a', 'submitted', 'Pipe crew'), row('b', 'draft')];
    renderAt('/site-reports?crew=c1');
    expect(h.calls.at(-1)).toEqual([{ crewId: 'c1' }, 0]);
    expect(screen.getByTestId('dsr-crew')).toHaveTextContent('Crew Pipe crew');
    expect(screen.getAllByTestId('dsr-crew')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Crew' })).toHaveValue('c1');
  });

  it('AC-SRC-006 the list identifies a named person separately from the report author', () => {
    h.rows = [row('person-report', 'draft', null, 'Roster person')];
    renderAt();
    expect(screen.getByTestId('dsr-person')).toHaveTextContent('Person Roster person');
    expect(screen.queryByTestId('dsr-crew')).toBeNull();
    expect(screen.getByText('Field One')).toBeInTheDocument();
  });

  it('AC-SRC-006 an organisation with no crews sees no crew filter', () => {
    h.crews = [];
    renderAt();
    expect(screen.queryByRole('combobox', { name: 'Crew' })).toBeNull();
  });

  it('FR-DSR-017 a validator sees the queue first with age and unrated count', () => {
    h.queue = [{ report_id: 'r9', work_order_label: 'WO-1 · Pipe', work_date: '2026-03-08', author_name: 'Field One', age_days: 2, unrated_lines: 1, waiting_for_validator: false }];
    renderAt();
    const queue = screen.getByTestId('dsr-queue');
    expect(queue).toHaveTextContent('To validate');
    expect(queue).toHaveTextContent('Due 2 days');
    expect(queue).toHaveTextContent('1 without rate');
  });

  it('a field role gets the New report doorway and no queue', () => {
    h.realRole = 'Engineer';
    h.queue = [{ report_id: 'r9' }];
    renderAt();
    expect(screen.queryByTestId('dsr-queue')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'New report' }).length).toBeGreaterThan(0);
  });

  it('a Finance user (validator, not enterer) gets no New report action', () => {
    renderAt();
    expect(screen.queryByRole('button', { name: 'New report' })).toBeNull();
  });

  it('AC-DSR-015 the status filter and page live in the address and reach the read', async () => {
    h.rows = [row('a', 'submitted')]; h.hasMore = true;
    renderAt('/site-reports?status=submitted');
    expect(h.calls.at(-1)).toEqual([{ status: 'submitted' }, 0]);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(h.calls.at(-1)).toEqual([{ status: 'submitted' }, 1]);
    expect(screen.getByText('WO a')).toBeInTheDocument();
  });

  it('shows one line and the fixing control when there are no reports', () => {
    h.realRole = 'Engineer';
    renderAt();
    expect(screen.getByText('No site reports yet')).toBeInTheDocument();
  });

  it('AC-DRVR-007 an Engineer holding an assigned validator job role sees the validation queue without revenue figures', () => {
    h.realRole = 'Engineer';
    h.builtInRole = 'site_supervisor';
    h.validateRoles = ['site_supervisor'];
    h.queue = [{ report_id: 'r9', work_order_label: 'WO-1 · Pipe', work_date: '2026-03-08', author_name: 'Field One', total_revenue: null, age_days: 2, unrated_lines: 0, waiting_for_validator: false }];
    renderAt();
    const queue = screen.getByTestId('dsr-queue');
    expect(queue).toHaveTextContent('To validate');
    expect(queue).toHaveTextContent('WO-1 · Pipe');
  });
});

it("shows retry when the validation queue read fails", async () => { h.realRole = "Finance"; h.queueError = true; renderAt(); await userEvent.click(screen.getByRole("button", { name: /retry/i })); expect(h.retryQueue).toHaveBeenCalled(); });
