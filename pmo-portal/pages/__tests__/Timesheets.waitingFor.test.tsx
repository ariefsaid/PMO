import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * fix-waiting item 3 (FR-WAIT-006) — the requester's own Submitted week names who it waits for, from
 * the server-computed route. The route words are the shipped derivation; this suite binds the shipped
 * page + sentence to the three honest states (pending/error, known empty, named facts) and proves the
 * existing status / empty-week rendering still stands.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { sheetsState, routeState } = vi.hoisted(() => ({
  sheetsState: { data: [] as Array<Record<string, unknown>>, isPending: false, isError: false, refetch: vi.fn() },
  routeState: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => sheetsState }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: vi.fn(), isPending: false },
    reopen: { mutate: vi.fn(), isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
  useOwnTimesheetPushState: () => ({ data: null, isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-1'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
    isReconciling: false,
    retryDeleteRefresh: vi.fn(),
    reconciledDelete: null,
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectPickerOptions: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
// Keep the SHIPPED sentence derivation; stub only the network read.
vi.mock('@/src/hooks/useTimesheetApprovalRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useTimesheetApprovalRoute')>();
  return { ...actual, useTimesheetApprovalRoute: () => routeState };
});
vi.mock('@/src/auth/impersonation', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/auth/impersonation')>();
  return { ...real, useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) };
});

import TimesheetsPage from '../Timesheets';

function getWeekStartDate(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d;
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

const currentWeekStr = () => iso(getWeekStartDate());

const submittedSheet = (id = 'ts-submitted') => ({
  id,
  user_id: 'u-self',
  week_start_date: currentWeekStr(),
  status: 'Submitted',
  submitted_at: '2026-06-01T08:00:00Z',
  approved_by: null,
  approved_at: null,
  org_id: 'org-1',
  entries: [],
});

const renderPage = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter initialEntries={['/timesheets']}>
        <Routes>
          <Route path="/timesheets" element={
            <ToastProvider>
              <TimesheetsPage />
            </ToastProvider>
          } />
        </Routes>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  sheetsState.data = [submittedSheet()];
  sheetsState.isPending = false;
  sheetsState.isError = false;
  routeState.data = undefined;
  routeState.isPending = false;
  routeState.isError = false;
  routeState.refetch.mockReset();
});

describe('FR-WAIT-006 a Submitted week names who it waits for', () => {
  it('names the manager with their real role and Admin as a true alternative', async () => {
    routeState.data = {
      routeKind: 'line_manager',
      approvers: [
        { id: 'u-manager', name: 'Ani', role: 'line_manager' },
        { id: 'u-admin', name: 'Budi', role: 'Admin' },
      ],
    };
    renderPage();

    expect(await screen.findByTestId('timesheet-waiting-for'))
      .toHaveTextContent('Waiting for Ani, line manager or Admin');
    // Existing status rendering is untouched.
    expect(within(screen.getByTestId('timesheets-entry-header')).getByText('Submitted')).toBeInTheDocument();
  });

  it('uses the actual role words when no manager is assigned', async () => {
    routeState.data = {
      routeKind: 'admin_executive',
      approvers: [
        { id: 'u-admin', name: 'Budi', role: 'Admin' },
        { id: 'u-exec', name: 'Cici', role: 'Executive' },
      ],
    };
    renderPage();
    expect(await screen.findByTestId('timesheet-waiting-for'))
      .toHaveTextContent('Waiting for Admin or Executive');
  });

  it('reports a known empty configured route honestly — never done, never a fabricated name', async () => {
    routeState.data = { routeKind: 'line_manager', approvers: [] };
    renderPage();
    expect(await screen.findByTestId('timesheet-waiting-for'))
      .toHaveTextContent('Nobody active holds these roles right now.');
    expect(within(screen.getByTestId('timesheets-entry-header')).queryByText(/Ani|Budi|Approved/))
      .not.toBeInTheDocument();
  });

  it('while the route is pending, shows the plain sentence and invents no names', async () => {
    routeState.isPending = true;
    renderPage();
    expect(await screen.findByTestId('timesheet-waiting-for'))
      .toHaveTextContent('Waiting for approval');
    expect(screen.getByTestId('timesheet-waiting-for')).not.toHaveTextContent(/,/);
  });

  it('a failed route keeps the plain sentence and offers a retry', async () => {
    routeState.isError = true;
    renderPage();
    expect(await screen.findByTestId('timesheet-waiting-for'))
      .toHaveTextContent('Waiting for approval');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(routeState.refetch).toHaveBeenCalledTimes(1);
  });

  it('an unavailable shape (read raced a status change) shows no route sentence at all', () => {
    routeState.data = { routeKind: 'unavailable', approvers: [] };
    renderPage();
    expect(screen.queryByTestId('timesheet-waiting-for')).not.toBeInTheDocument();
  });
});
