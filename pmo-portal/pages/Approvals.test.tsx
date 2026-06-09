import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
import { ToastProvider } from '@/src/components/ui';
import ApprovalsPage from './Approvals';

// ---------------------------------------------------------------------------
// Shared hook state (mutated per test)
// ---------------------------------------------------------------------------
type QueryState = {
  data: TimesheetAwaitingApproval[] | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
type MutationState = {
  mutate: ReturnType<typeof vi.fn>;
  isPending: boolean;
};

const queryState: QueryState = {
  data: undefined,
  isPending: false,
  isError: false,
  refetch: vi.fn(),
};
const approveMutation: MutationState = { mutate: vi.fn(), isPending: false };
const rejectMutation: MutationState = { mutate: vi.fn(), isPending: false };

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queryState,
  useTimesheetMutations: () => ({
    approve: approveMutation,
    reject: rejectMutation,
    submit: { mutate: vi.fn(), isPending: false },
  }),
}));

// N6: /approvals is now the unified inbox — it also reads the procurement queue.
// These timesheet-flow tests keep procurement empty so the timesheet section is
// the surface under test (its behavior is unchanged, just embedded in the inbox).
const procState = { data: [] as unknown[], isPending: false, isError: false };
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState, refetch: vi.fn() }),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-mgr', org_id: 'org-1' }, role: 'Project Manager' }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));

const submittedSheets: TimesheetAwaitingApproval[] = [
  {
    id: 'ts-1',
    user_id: 'u-dave',
    week_start_date: '2026-06-01',
    status: 'Submitted',
    submitted_at: '2026-06-08T17:00:00Z',
    approved_by: null,
    approved_at: null,
    org_id: 'org-1',
    owner: { full_name: 'Dave Engineer' },
    entries: [
      {
        id: 'e1',
        timesheet_id: 'ts-1',
        project_id: 'pr1',
        entry_date: '2026-06-01',
        hours: 8,
        notes: null,
        org_id: 'org-1',
        project: { name: 'Project Alpha', code: 'PA' },
      },
    ],
  },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ApprovalsPage />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  queryState.data = undefined;
  queryState.isPending = false;
  queryState.isError = false;
  queryState.refetch = vi.fn();
  approveMutation.mutate = vi.fn();
  rejectMutation.mutate = vi.fn();
  procState.data = [];
  procState.isPending = false;
  procState.isError = false;
});

// ---------------------------------------------------------------------------
// C3 — Loading / empty / error+retry states (AC-904)
// ---------------------------------------------------------------------------

describe('Approvals page states', () => {
  it('AC-904: Approvals page renders approvals-loading skeleton while pending, approvals-empty when no submitted sheets, error + Retry that re-runs the query (NFR-TS-UI-001)', () => {
    // Loading
    queryState.isPending = true;
    queryState.data = undefined;
    renderPage();
    expect(screen.getByTestId('approvals-loading')).toBeInTheDocument();
  });

  it('AC-904 / N6: nothing in EITHER queue → the inbox shows the page-level "all caught up" empty', () => {
    queryState.isPending = false;
    queryState.data = [];
    procState.data = [];
    renderPage();
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('AC-904: timesheet error + Retry re-runs the query (NFR-TS-UI-001)', () => {
    // A non-empty proc count keeps the page out of the caught-up collapse so the
    // timesheet section (and its error+Retry) renders independently.
    procState.data = [{ id: 'pr1', status: 'Requested', requested_by_id: 'someone' }];
    queryState.isPending = false;
    queryState.isError = true;
    queryState.data = undefined;
    const refetchMock = vi.fn();
    queryState.refetch = refetchMock;
    renderPage();
    const retryBtn = screen.getAllByRole('button', { name: /retry/i });
    expect(retryBtn.length).toBeGreaterThan(0);
    fireEvent.click(retryBtn[retryBtn.length - 1]);
    expect(refetchMock).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// C3 — Data renders (AC-904)
// ---------------------------------------------------------------------------

describe('Approvals page data', () => {
  it('renders submitted sheets with owner full_name and the formatted week label', () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    renderPage();
    expect(screen.getByText('Dave Engineer')).toBeInTheDocument();
    // Week of 2026-06-01 → "Week of Jun 1" (formatted, TZ-safe).
    expect(screen.getByText(/Jun 1/)).toBeInTheDocument();
  });

  it('renders summed hours per sheet', () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    renderPage();
    // 8 hours in entries
    expect(screen.getByText(/8\.0/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// C4 — Approve/Reject buttons wired to mutations (AC-911 UI, FR-TS-005)
// ---------------------------------------------------------------------------

describe('Approvals page actions', () => {
  it("T2/AC-911 (UI): an Approvals row offers Approve and Return; Approve opens a default-tone confirm and the approve mutation fires only on Confirm, then toasts (FR-TS-005)", async () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    approveMutation.mutate = vi.fn(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    renderPage();

    const approveBtn = screen.getByRole('button', { name: /approve/i });
    // "Return" is the IA-3 label for the reject transition (sends the week back).
    const returnBtn = screen.getByRole('button', { name: /return/i });
    expect(approveBtn).toBeInTheDocument();
    expect(returnBtn).toBeInTheDocument();

    await userEvent.click(approveBtn);
    // Owner rule: nothing approves on the first click.
    expect(approveMutation.mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /^Approve$/i }));
    expect(approveMutation.mutate).toHaveBeenCalledWith(
      { id: 'ts-1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });

  it('T3: Return opens a DESTRUCTIVE modal and the reject mutation fires only on Confirm', async () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    rejectMutation.mutate = vi.fn(
      (_vars: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.(),
    );
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: /return/i }));
    expect(rejectMutation.mutate).not.toHaveBeenCalled();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: /Return timesheet/i }));
    expect(rejectMutation.mutate).toHaveBeenCalledWith(
      { id: 'ts-1' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });
});
