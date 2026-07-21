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

// P3b (FR-TSP-085, OQ-TSP-10(C)) — the "needs attention" ERP-push queue + the Employee-link confirm
// queue. Default EMPTY (no mirror row / no proposed link — FR-TSP-173: the page must still render
// fully, the badge/section simply absent). Individual tests overwrite these per scenario.
type AttentionRow = {
  timesheet_id: string;
  push_state: string;
  push_error: string | null;
  ts_number: string | null;
  week_start_date: string;
  approved_by: string | null;
  owner_name: string;
};
type ProposedLink = {
  id: string;
  employee_name: string | null;
  work_email: string | null;
  link_proposed_reason: string | null;
  profile_id: string | null;
};
const attentionState: { data: AttentionRow[]; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const retryMutation: MutationState = { mutate: vi.fn(), isPending: false };
const linksState: { data: ProposedLink[]; isPending: boolean; isError: boolean } = {
  data: [],
  isPending: false,
  isError: false,
};
const confirmMutation: MutationState = { mutate: vi.fn(), isPending: false };

vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => queryState,
  useTimesheetMutations: () => ({
    approve: approveMutation,
    reject: rejectMutation,
    submit: { mutate: vi.fn(), isPending: false },
  }),
  usePushesNeedingAttention: () => ({ ...attentionState, retry: retryMutation }),
  useEmployeeLinkConfirm: () => ({ links: linksState, confirm: confirmMutation }),
}));

// N6: /approvals is now the unified inbox — it also reads the procurement queue.
// These timesheet-flow tests keep procurement empty so the timesheet section is
// the surface under test (its behavior is unchanged, just embedded in the inbox).
const procState = { data: [] as unknown[], isPending: false, isError: false };
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ ...procState, refetch: vi.fn() }),
}));

// Mutable so a P3b test can flip the signed-in role to Admin/Engineer without a per-test module mock.
const authState = { userId: 'u-mgr', orgId: 'org-1', role: 'Project Manager' as string };

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: authState.userId, org_id: authState.orgId }, role: authState.role }),
}));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: authState.role, realRole: authState.role }),
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

// CW-6: /approvals now splits its two modules into deep-linkable scope tabs. This file
// tests the TIMESHEET section's behavior (approve/return), so it deep-links to that scope
// (`?scope=timesheets`) — the timesheet panel is the surface under test here.
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/approvals?scope=timesheets']}>
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
  attentionState.data = [];
  attentionState.isPending = false;
  attentionState.isError = false;
  retryMutation.mutate = vi.fn();
  retryMutation.isPending = false;
  linksState.data = [];
  linksState.isPending = false;
  linksState.isError = false;
  confirmMutation.mutate = vi.fn();
  confirmMutation.isPending = false;
  authState.userId = 'u-mgr';
  authState.orgId = 'org-1';
  authState.role = 'Project Manager';
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
    expect(screen.getAllByTestId('liststate-loading').length).toBeGreaterThan(0);
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
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    expect(within(preview).getByText('Dave Engineer')).toBeInTheDocument();
    // Week of 2026-06-01 → "Week of Jun 1" (formatted, TZ-safe).
    expect(within(preview).getByText(/Jun 1/)).toBeInTheDocument();
  });

  it('renders summed hours per sheet', () => {
    queryState.isPending = false;
    queryState.isError = false;
    queryState.data = submittedSheets;
    renderPage();
    const preview = screen.getByRole('region', { name: /Approval preview/i });
    // 8 hours in entries
    expect(within(preview).getByText(/8\.0/)).toBeInTheDocument();
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

    const preview = screen.getByRole('region', { name: /Approval preview/i });
    const approveBtn = within(preview).getByRole('button', { name: /approve/i });
    // "Return" is the IA-3 label for the reject transition (sends the week back).
    const returnBtn = within(preview).getByRole('button', { name: /return/i });
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

    const preview = screen.getByRole('region', { name: /Approval preview/i });
    await userEvent.click(within(preview).getByRole('button', { name: /return/i }));
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

// ---------------------------------------------------------------------------
// P3b — the ERP push "needs attention" + Employee-link Confirm operator surfaces (AC-TSP-051)
// ---------------------------------------------------------------------------
describe('Approvals page — P3b ERP push attention + Employee-link confirm (AC-TSP-051)', () => {
  const failedRow = {
    timesheet_id: 'ts-99',
    push_state: 'failed',
    push_error: 'employee-unlinked',
    ts_number: null,
    week_start_date: '2026-01-05',
    approved_by: 'u-mgr',
    owner_name: 'Dave Engineer',
  };
  const proposedLink = {
    id: 'emp-1',
    employee_name: 'Jane Doe',
    work_email: 'jane@co.test',
    link_proposed_reason: 'unique work_email match',
    profile_id: 'profile-1',
  };

  it('AC-TSP-051: an authorized approver (the sheet\'s own approved_by) sees the failure + reason + a Retry affordance', async () => {
    authState.userId = 'u-mgr';
    authState.role = 'Project Manager';
    attentionState.data = [failedRow];
    renderPage();

    expect(screen.getByText('Dave Engineer')).toBeInTheDocument();
    expect(screen.getByText(/employee-unlinked/)).toBeInTheDocument();
    const retryBtn = screen.getByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await userEvent.click(retryBtn);
    expect(retryMutation.mutate).toHaveBeenCalledWith(
      { timesheetId: 'ts-99' },
      expect.anything(),
    );
  });

  // NOTE: the "sees the failure but no Retry" negative case is unreachable AT THIS PAGE by
  // construction — `canApproveTimesheets` (Admin·Exec·PM, gating the whole ERP-attention section's
  // visibility) is a strict subset of the push_timesheet privileged set (Admin·Exec·PM·Finance), so
  // every role that can even see this section is retry-privileged. The canRetry=false render path
  // (a viewer who is neither the approver nor privileged) is proven at the component layer instead:
  // `src/components/timesheets/PushStateBadge.test.tsx` ("a non-privileged viewer sees the failure but
  // NO Retry affordance").

  it('FR-TSP-173: with NO mirror row (attention queue empty) the page renders fully — no ERP section, no error state', () => {
    attentionState.data = [];
    queryState.data = submittedSheets;
    renderPage();
    expect(screen.queryByText(/employee-unlinked/)).not.toBeInTheDocument();
    // The ordinary approvals surface still renders (never blocked by the ERP badge's absence).
    expect(screen.getByRole('region', { name: /Approval preview/i })).toBeInTheDocument();
  });

  it('AC-TSP-092(ux): an Admin sees a proposed Employee link + match reason + a Confirm affordance', async () => {
    authState.role = 'Admin';
    linksState.data = [proposedLink];
    renderPage();

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText(/unique work_email match/)).toBeInTheDocument();
    const confirmBtn = screen.getByRole('button', { name: /^confirm$/i });

    await userEvent.click(confirmBtn);
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /confirm link/i }));
    expect(confirmMutation.mutate).toHaveBeenCalledWith(
      { erpEmployeeId: 'emp-1', profileId: 'profile-1' },
      expect.anything(),
    );
  });

  it('AC-TSP-092(ux): a non-Admin sees the proposed link but NO Confirm affordance', () => {
    authState.role = 'Project Manager';
    linksState.data = [proposedLink];
    renderPage();

    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^confirm$/i })).not.toBeInTheDocument();
  });
});
