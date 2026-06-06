import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { TimesheetAwaitingApproval } from '@/src/lib/db/timesheetTransition';
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

const renderPage = () => render(<MemoryRouter><ApprovalsPage /></MemoryRouter>);

beforeEach(() => {
  queryState.data = undefined;
  queryState.isPending = false;
  queryState.isError = false;
  queryState.refetch = vi.fn();
  approveMutation.mutate = vi.fn();
  rejectMutation.mutate = vi.fn();
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

  it('AC-904: approvals-empty when no submitted sheets (NFR-TS-UI-001)', () => {
    queryState.isPending = false;
    queryState.data = [];
    renderPage();
    expect(screen.getByTestId('approvals-empty')).toBeInTheDocument();
  });

  it('AC-904: error + Retry re-runs the query (NFR-TS-UI-001)', () => {
    queryState.isPending = false;
    queryState.isError = true;
    queryState.data = undefined;
    const refetchMock = vi.fn();
    queryState.refetch = refetchMock;
    renderPage();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
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
  it("AC-911 (UI): an Approvals row for a report's Submitted sheet offers Approve and Return; clicking Approve calls the approve mutation with the row id (FR-TS-005)", () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    renderPage();

    const approveBtn = screen.getByRole('button', { name: /approve/i });
    // "Return" is the IA-3 label for the reject transition (sends the week back).
    const returnBtn = screen.getByRole('button', { name: /return/i });
    expect(approveBtn).toBeInTheDocument();
    expect(returnBtn).toBeInTheDocument();

    fireEvent.click(approveBtn);
    expect(approveMutation.mutate).toHaveBeenCalledWith({ id: 'ts-1' });
  });

  it('clicking Return calls the reject mutation with the row id', () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /return/i }));
    expect(rejectMutation.mutate).toHaveBeenCalledWith({ id: 'ts-1' });
  });
});
