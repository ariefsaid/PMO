/**
 * AC-W2-8-01: ApprovalsQueue single-row approve/revise action routes errors through
 * classifyMutationError (no raw err.message in the toast headline).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';

// A Postgres-coded error that classifyMutationError maps to a specific headline.
const pgPermissionError = Object.assign(new Error('permission denied for table timesheets'), {
  code: '42501',
});

const { queue, approveMutate } = vi.hoisted(() => ({
  queue: {
    data: [
      {
        id: 's1',
        status: 'Submitted',
        week_start_date: '2026-06-01',
        owner: { full_name: 'Dana Report' },
        entries: [{ hours: 8 }],
      },
    ] as Array<Record<string, unknown>>,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  // approve.mutate will call onError with a coded error
  approveMutate: vi.fn(),
}));

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queue,
  useTimesheetMutations: () => ({
    approve: {
      mutate: approveMutate,
      isPending: false,
    },
    reject: { mutate: vi.fn(), isPending: false },
  }),
}));

import { ApprovalsQueue } from '../ApprovalsQueue';

beforeEach(() => {
  vi.clearAllMocks();
  // Simulate onError being called with a Postgres 42501 error
  approveMutate.mockImplementation((_args: unknown, opts?: { onError?: (err: unknown) => void }) => {
    opts?.onError?.(pgPermissionError);
  });
});

describe('ApprovalsQueue error classification (W2-8)', () => {
  it("AC-W2-8-01: single-row approve onError routes through classifyMutationError (headline is the classified string, not raw err.message)", async () => {
    const user = userEvent.setup();
    render(
      <ImpersonationProvider realRole="Project Manager">
        <ToastProvider>
          <ApprovalsQueue />
        </ToastProvider>
      </ImpersonationProvider>,
    );

    // Click Approve on the single row (the row-level Approve button)
    const approveBtns = screen.getAllByRole('button', { name: /Approve/i });
    // The first one is the row-level approve button (before the dialog opens)
    await user.click(approveBtns[0]);

    // The confirm dialog opens — confirm it (dialog has another Approve button)
    await waitFor(() => {
      expect(screen.getByText(/Approve Dana Report's week/i)).toBeInTheDocument();
    });
    const allBtns = screen.getAllByRole('button', { name: /Approve/i });
    // Click the last Approve (the ConfirmDialog's confirm button)
    await user.click(allBtns[allBtns.length - 1]);

    // The toast headline must be the classified one (not the raw error message)
    await waitFor(() => {
      // classifyMutationError('42501') → "You don't have permission to do that."
      expect(screen.getByText(/you don't have permission to do that/i)).toBeInTheDocument();
    });

    // The raw error message must NOT be the toast headline
    expect(screen.queryByRole('heading', { name: /permission denied for table timesheets/i })).not.toBeInTheDocument();
  });
});
