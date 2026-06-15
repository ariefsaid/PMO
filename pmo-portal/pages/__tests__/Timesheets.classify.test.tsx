/**
 * AC-W2-8-02: Timesheet submit + reopen onError routes through classifyMutationError
 * (toast headline = classified string, not raw err.message).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// A Postgres-coded error that classifyMutationError maps to a specific headline.
const pgPermissionError = Object.assign(new Error('permission denied for table timesheets'), {
  code: '42501',
});

// Clock pin — consistent with Timesheets.test.tsx
const PINNED_NOW = new Date('2026-06-03T12:00:00');
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

const submitMutate = vi.fn();
const reopenMutate = vi.fn();

const tsState = {
  data: [
    {
      id: 'ts-pm',
      user_id: 'u-alice',
      week_start_date: '2026-06-01',
      status: 'Draft',
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      org_id: 'org-1',
      entries: [
        {
          id: 'e1',
          timesheet_id: 'ts-pm',
          project_id: 'pr1',
          entry_date: '2026-06-01',
          hours: 6,
          notes: null,
          project: { name: 'Test Project', code: 'P001' },
        },
      ],
    },
  ] as unknown as TimesheetWithEntries[],
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};

vi.mock('@/src/hooks/useTimesheets', () => ({ useTimesheets: () => tsState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetMutations: () => ({
    submit: { mutate: submitMutate, isPending: false },
    reopen: { mutate: reopenMutate, isPending: false },
    approve: { mutate: vi.fn(), isPending: false },
    reject: { mutate: vi.fn(), isPending: false },
  }),
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useTimesheetEntries', () => ({
  useTimesheetEntryMutations: () => ({
    saveWeek: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue('ts-pm'), isPending: false },
    deleteRow: { mutate: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [] }),
}));

import Timesheets from '../Timesheets';

const renderPage = () =>
  render(
    <MemoryRouter>
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <Timesheets />
        </ToastProvider>
      </ImpersonationProvider>
    </MemoryRouter>,
  );

describe('Timesheets error classification (W2-8)', () => {
  it('AC-W2-8-02: submit onError routes through classifyMutationError (classified headline, not raw err.message)', async () => {
    const user = userEvent.setup();

    // submitMutate calls onError with a 42501 error
    submitMutate.mockImplementation((_args: unknown, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(pgPermissionError);
    });

    renderPage();

    // Click "Submit timesheet" — opens confirm dialog
    const submitBtn = await screen.findByRole('button', { name: /submit timesheet/i });
    await user.click(submitBtn);

    // Confirm dialog — confirm
    await waitFor(() => {
      expect(screen.getByText(/submit this week for approval/i)).toBeInTheDocument();
    });
    // Multiple "Submit timesheet" buttons — get all and click the confirm one
    const allSubmitBtns = screen.getAllByRole('button', { name: /submit timesheet/i });
    await user.click(allSubmitBtns[allSubmitBtns.length - 1]);

    // The toast headline must be classified (42501 → "You don't have permission to do that.")
    await waitFor(() => {
      expect(screen.getByText(/you don't have permission to do that/i)).toBeInTheDocument();
    });
  });
});
