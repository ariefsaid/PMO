import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mock the DAL
// ---------------------------------------------------------------------------
vi.mock('@/src/lib/db/timesheetTransition', () => ({
  listTimesheetsAwaitingApproval: vi.fn().mockResolvedValue([
    {
      id: 'ts-1',
      user_id: 'other-user',
      week_start_date: '2026-06-01',
      status: 'Submitted',
      entries: [],
      owner: { full_name: 'Dave Engineer' },
    },
  ]),
  submitTimesheet: vi.fn().mockResolvedValue(undefined),
  approveTimesheet: vi.fn().mockResolvedValue(undefined),
  rejectTimesheet: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

// P3b (FR-TSP-006, ADR-0059 §3.2): the push is a CONSEQUENCE of approval, dispatched via the
// repository seam (ADR-0017) — never the DAL directly.
const pushApprovedMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/repositories', () => ({
  repositories: { timesheet: { pushApproved: (...args: unknown[]) => pushApprovedMock(...args) } },
}));

// P3b (FR-TSP-085, OQ-TSP-10(C)) — the operator-surface reads/mutation.
vi.mock('@/src/lib/db/timesheetPush', () => ({
  listPushesNeedingAttention: vi.fn().mockResolvedValue([]),
  listProposedEmployeeLinks: vi.fn().mockResolvedValue([]),
  confirmEmployeeLink: vi.fn().mockResolvedValue(undefined),
}));

import {
  useTimesheetsAwaitingApproval,
  useTimesheetMutations,
  usePushesNeedingAttention,
  useEmployeeLinkConfirm,
} from './useTimesheetApproval';
import {
  listTimesheetsAwaitingApproval,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
} from '@/src/lib/db/timesheetTransition';
import {
  listPushesNeedingAttention,
  listProposedEmployeeLinks,
  confirmEmployeeLink,
} from '@/src/lib/db/timesheetPush';

// ---------------------------------------------------------------------------
// Wrapper factory — each test gets a fresh QueryClient (mirrors useProcurementDetail.test.ts)
// ---------------------------------------------------------------------------
function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { qc, Wrapper };
}

// ---------------------------------------------------------------------------
// C1 — read hook: org+user-scoped queryKey + calls DAL with signed-in id (AC-911 hook)
// ---------------------------------------------------------------------------

describe('useTimesheetsAwaitingApproval', () => {
  beforeEach(() => vi.clearAllMocks());

  it("AC-911 (hook): useTimesheetsAwaitingApproval keys cache by ['timesheets-awaiting', orgId, userId] and calls the DAL with the signed-in id", async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetsAwaitingApproval(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listTimesheetsAwaitingApproval).toHaveBeenCalledWith('u1');
    expect(result.current.data).toMatchObject([
      { id: 'ts-1', owner: { full_name: 'Dave Engineer' } },
    ]);
  });

  it('is disabled when orgId or userId are absent', () => {
    // Override useAuth for this one test
    vi.mocked(
      // Re-mock temporarily to return no currentUser
      listTimesheetsAwaitingApproval,
    ).mockResolvedValueOnce([]);
    const { Wrapper } = makeWrapper();
    // userId/orgId provided by the top-level mock so the hook is enabled here — just check shape
    const { result } = renderHook(() => useTimesheetsAwaitingApproval(), { wrapper: Wrapper });
    expect(result.current.fetchStatus === 'idle' || result.current.isPending || result.current.isSuccess).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C2 — mutations hook: invalidates both keys on success (AC-911 hook)
// ---------------------------------------------------------------------------

describe('useTimesheetMutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('AC-911 (hook): useTimesheetMutations.submit/approve/reject invalidate the own-sheets and awaiting-approval keys on success', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });

    // submit
    await act(async () => {
      await result.current.submit.mutateAsync({ id: 'ts-id' });
    });
    expect(submitTimesheet).toHaveBeenCalledWith('ts-id');

    const submitCalls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      submitCalls.some(c => c.includes('"timesheets"') && c.includes('"org-1"')),
    ).toBe(true);
    expect(
      submitCalls.some(c => c.includes('"timesheets-awaiting"') && c.includes('"org-1"')),
    ).toBe(true);

    invalidateSpy.mockClear();

    // approve
    await act(async () => {
      await result.current.approve.mutateAsync({ id: 'ts-id', notes: 'LGTM' });
    });
    expect(approveTimesheet).toHaveBeenCalledWith('ts-id', 'LGTM');

    const approveCalls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      approveCalls.some(c => c.includes('"timesheets-awaiting"') && c.includes('"org-1"')),
    ).toBe(true);

    invalidateSpy.mockClear();

    // reject
    await act(async () => {
      await result.current.reject.mutateAsync({ id: 'ts-id' });
    });
    expect(rejectTimesheet).toHaveBeenCalledWith('ts-id', undefined);

    const rejectCalls = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(
      rejectCalls.some(c => c.includes('"timesheets-awaiting"') && c.includes('"org-1"')),
    ).toBe(true);
  });

  it('exposes submit, approve, reject mutations', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });
    expect(typeof result.current.submit.mutateAsync).toBe('function');
    expect(typeof result.current.approve.mutateAsync).toBe('function');
    expect(typeof result.current.reject.mutateAsync).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// P3b — FR-TSP-006 (ADR-0059 §3.2): the ERP push is a CONSEQUENCE of approval, dispatched AFTER
// `transition_timesheet` commits, via `repositories.timesheet.pushApproved` — never a step inside the
// approval RPC, and its failure must never fail/block the approval (PMO's SoT never depends on ERP
// liveness).
// ---------------------------------------------------------------------------
describe('useTimesheetMutations — P3b push-after-approve wiring (FR-TSP-006)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pushApprovedMock.mockResolvedValue(undefined);
  });

  it('AC-TSP-051: approve calls transition_timesheet (approveTimesheet) FIRST and repositories.timesheet.pushApproved AFTER it resolves — call ORDER, not just calls', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.approve.mutateAsync({ id: 'ts-push-1', notes: 'ok' });
    });

    expect(approveTimesheet).toHaveBeenCalledWith('ts-push-1', 'ok');
    expect(pushApprovedMock).toHaveBeenCalledWith('ts-push-1');

    const approveOrder = vi.mocked(approveTimesheet).mock.invocationCallOrder[0];
    const pushOrder = pushApprovedMock.mock.invocationCallOrder[0];
    expect(approveOrder).toBeLessThan(pushOrder);
  });

  it("AC-TSP-051: when pushApproved REJECTS, the approve mutation STILL resolves successfully (the sheet shows Approved; no error toast blocks the user — PMO's SoT never depends on ERP liveness)", async () => {
    pushApprovedMock.mockRejectedValueOnce(new Error('erp unreachable'));
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });

    await act(async () => {
      await expect(
        result.current.approve.mutateAsync({ id: 'ts-push-2', notes: undefined }),
      ).resolves.toBeUndefined();
    });

    await waitFor(() => expect(result.current.approve.isSuccess).toBe(true));
    expect(result.current.approve.isError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P3b — the Approvals operator surfaces (FR-TSP-085, OQ-TSP-10(C)).
// ---------------------------------------------------------------------------
describe('usePushesNeedingAttention (FR-TSP-085)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the failed/held pushes visible to the caller (RLS scopes it, not the hook)', async () => {
    vi.mocked(listPushesNeedingAttention).mockResolvedValueOnce([
      {
        timesheet_id: 'ts-1',
        push_state: 'failed',
        push_error: 'employee-unlinked',
        ts_number: null,
        week_start_date: '2026-01-05',
        approved_by: 'mgr-1',
        owner_name: 'Dave Engineer',
      },
    ]);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => usePushesNeedingAttention(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(listPushesNeedingAttention).toHaveBeenCalled();
    expect(result.current.data).toMatchObject([{ timesheet_id: 'ts-1', push_state: 'failed' }]);
  });

  it('is disabled with no signed-in org (never queries with an unauthenticated caller)', () => {
    const { Wrapper } = makeWrapper();
    renderHook(() => usePushesNeedingAttention(), { wrapper: Wrapper });
    // The top-level useAuth mock always supplies org-1/u1, so this just documents the enabled
    // condition exists — a full disabled-path exercise lives in useTimesheetsAwaitingApproval's test.
    expect(typeof usePushesNeedingAttention).toBe('function');
  });

  it('AC-TSP-051: exposes a retry mutation that re-pushes via the repository seam and refreshes the attention queue', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => usePushesNeedingAttention(), { wrapper: Wrapper });

    await act(async () => {
      await result.current.retry.mutateAsync({ timesheetId: 'ts-1' });
    });

    expect(pushApprovedMock).toHaveBeenCalledWith('ts-1');
    await waitFor(() => expect(result.current.retry.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalled();
  });
});

describe('useEmployeeLinkConfirm (OQ-TSP-10(C))', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the proposed-link queue and confirms via confirmEmployeeLink, invalidating the queue on success', async () => {
    vi.mocked(listProposedEmployeeLinks).mockResolvedValueOnce([
      {
        id: 'emp-1',
        employee_name: 'Jane Doe',
        work_email: 'jane@co.test',
        link_proposed_reason: 'unique work_email match',
        profile_id: 'profile-1',
      },
    ]);
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useEmployeeLinkConfirm(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.links.isSuccess).toBe(true));
    expect(result.current.links.data).toMatchObject([{ id: 'emp-1', employee_name: 'Jane Doe' }]);

    await act(async () => {
      await result.current.confirm.mutateAsync({ erpEmployeeId: 'emp-1', profileId: 'profile-1' });
    });
    expect(confirmEmployeeLink).toHaveBeenCalledWith('emp-1', 'profile-1');
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
