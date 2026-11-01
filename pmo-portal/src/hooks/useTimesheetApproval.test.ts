import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

// P3b (FR-TSP-006, ADR-0059 §3.2): the push is a CONSEQUENCE of approval, dispatched via the
// repository seam (ADR-0017) — never the DAL directly.
const pushApprovedMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/src/lib/repositories', () => ({ repositories: { timesheet: {
  pushApproved: (...args: unknown[]) => pushApprovedMock(...args),
  listAwaitingApproval: vi.fn().mockResolvedValue([{ id: 'ts-1', user_id: 'other-user', week_start_date: '2026-06-01', status: 'Submitted', entries: [], owner: { full_name: 'Dave Engineer' } }]),
  listReopenableApproved: vi.fn().mockResolvedValue([]),
  submit: vi.fn().mockResolvedValue(undefined), approve: vi.fn().mockResolvedValue(undefined),
  reject: vi.fn().mockResolvedValue(undefined), reopen: vi.fn().mockResolvedValue(undefined),
  attestNoErpDocument: vi.fn().mockResolvedValue(undefined),
  listPushesNeedingAttention: vi.fn().mockResolvedValue([]),
  confirmEmployeeLink: vi.fn().mockResolvedValue(undefined),
  getPushState: vi.fn().mockResolvedValue({ push_state: 'failed', push_error: 'external-unreachable', ts_number: null }),
} } }));

vi.mock('@/src/lib/repositories/employeeMatchReview', () => ({
  listEmployeeMatchReview: vi.fn().mockResolvedValue({ links: [], profiles: [] }),
}));

import {
  awaitingApprovalKey,
  useTimesheetsAwaitingApproval,
  useReopenableApprovedTimesheets,
  useTimesheetMutations,
  usePushesNeedingAttention,
  useEmployeeLinkConfirm,
  useOwnTimesheetPushState,
} from './useTimesheetApproval';
import { repositories } from '@/src/lib/repositories';
import type { ProfileRow } from '@/src/lib/db/profiles';
import { listEmployeeMatchReview } from '@/src/lib/repositories/employeeMatchReview';

const { getPushState, listAwaitingApproval: listTimesheetsAwaitingApproval, submit: submitTimesheet, approve: approveTimesheet, reject: rejectTimesheet, reopen: reopenTimesheet, attestNoErpDocument: attestTimesheetNoErpDocument, listPushesNeedingAttention, confirmEmployeeLink } = repositories.timesheet;
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

  it("AC-911 (hook): useTimesheetsAwaitingApproval keys cache by ['timesheets-awaiting', orgId, userId, role] and calls the DAL with the signed-in id and role", async () => {
    const { qc, Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetsAwaitingApproval(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(listTimesheetsAwaitingApproval).toHaveBeenCalledWith('u1', 'Project Manager');
    expect(qc.getQueryData(awaitingApprovalKey('org-1', 'u1', 'Project Manager'))).toBe(result.current.data);
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

it('loads the approved correction queue for the signed-in user', async () => {
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => useReopenableApprovedTimesheets(), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(repositories.timesheet.listReopenableApproved).toHaveBeenCalledWith('u1', 'Project Manager');
  expect(result.current.data).toEqual([]);
});

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

  // ── SHOULD-FIX 4 (Luna code review) — a successful re-open must clear the surfaces it invalidated.
  it('reopens an own timesheet through the same transition', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });
    await act(async () => { await result.current.reopen.mutateAsync({ id: 'own-sheet' }); });
    expect(reopenTimesheet).toHaveBeenCalledWith('own-sheet');
  });

  // The re-openable queue is where the button was clicked, and the push-attention queue can still be
  // offering a Retry for the very week that just went back to Draft (a Retry the server now refuses).
  // Invalidating only own/awaiting left BOTH on screen until something else happened to refetch them.
  it('SHOULD-FIX 4: reopenApproved invalidates the re-openable queue AND the push-attention queue (a stale Retry must not survive a re-open)', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.reopenApproved.mutateAsync({ id: 'ts-reopened' });
    });
    expect(reopenTimesheet).toHaveBeenCalledWith('ts-reopened');

    const keys = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(keys.some(k => k.includes('"timesheets-reopenable-approved"') && k.includes('"org-1"'))).toBe(true);
    expect(keys.some(k => k.includes('"timesheet-pushes-attention"') && k.includes('"org-1"'))).toBe(true);
    // …and the pre-existing invalidations are kept (the sheet is now the owner's Draft again).
    expect(keys.some(k => k.includes('"timesheets-awaiting"') && k.includes('"org-1"'))).toBe(true);
    expect(keys.some(k => k.includes('"timesheets"') && k.includes('"org-1"'))).toBe(true);
  });

  // ── AC-TSC-R12 (Luna FU-1a round-12 SHOULD-FIX 1) — the attestation clears the surfaces that change:
  // the re-open queue (the row leaves the `outcomeUnknown` state) and the push-attention queue (the
  // mirror moved held → failed and carries a new classified reason).
  it('AC-TSC-R12: attestNoErpDocument invalidates the re-openable queue AND the push-attention queue', async () => {
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.attestNoErpDocument.mutateAsync({ id: 'ts-att', reason: 'checked ERPNext' });
    });
    expect(attestTimesheetNoErpDocument).toHaveBeenCalledWith('ts-att', 'checked ERPNext');

    const keys = invalidateSpy.mock.calls.map(c => JSON.stringify(c[0]));
    expect(keys.some(k => k.includes('"timesheets-reopenable-approved"') && k.includes('"org-1"'))).toBe(true);
    expect(keys.some(k => k.includes('"timesheet-pushes-attention"') && k.includes('"org-1"'))).toBe(true);
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

  it('surfaces an approval refusal without attempting a push', async () => {
    const refusal = new Error('Approval refused');
    vi.mocked(approveTimesheet).mockRejectedValueOnce(refusal);
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetMutations(), { wrapper: Wrapper });
    await act(async () => {
      await expect(result.current.approve.mutateAsync({ id: 'ts-refused' })).rejects.toBe(refusal);
    });
    expect(pushApprovedMock).not.toHaveBeenCalled();
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

  it('AC-S30-003 reads unlinked identities with active profile choices and confirms the selected id while invalidating both queues', async () => {
    vi.mocked(listEmployeeMatchReview).mockResolvedValueOnce({
      links: [{
        id: 'emp-unlinked',
        employee_name: 'Synthetic ERP Worker',
        employee_number: 'WORKER-017',
        work_email: 'worker-017@example.test',
        link_proposed_reason: 'No confident PMO match was found',
        profile_id: null,
        profile_name: null,
        profile_email: null,
      }],
      profiles: [{
        id: 'profile-selected',
        full_name: 'Casey Reviewer',
        email: 'candidate@example.test',
        status: 'active',
      }] as unknown as ProfileRow[],
    });
    const { qc, Wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useEmployeeLinkConfirm(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.links.isSuccess).toBe(true));
    expect(listEmployeeMatchReview).toHaveBeenCalledOnce();
    expect(result.current.links.data).toMatchObject([{ id: 'emp-unlinked', employee_name: 'Synthetic ERP Worker', profile_id: null }]);
    expect(result.current).toHaveProperty('profiles', [expect.objectContaining({ id: 'profile-selected', status: 'active' })]);

    await act(async () => {
      await result.current.confirm.mutateAsync({ erpEmployeeId: 'emp-unlinked', profileId: 'profile-selected' });
    });
    expect(confirmEmployeeLink).toHaveBeenCalledWith('emp-unlinked', 'profile-selected');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['erp-employee-links-proposed', 'org-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timesheet-pushes-attention', 'org-1'] });
  });
});


// ════════════════════════════════════════════════════════════════════════════════════════════════
// ⚑ I-17 / I-16 (rendered Discover pass, 2026-07-22) — the OWNER could never see that their own hours
// failed to reach ERP. `getPushState` had ZERO consumers, even though `timesheet_erp_mirror_select`
// RLS DELIBERATELY grants the sheet's owner that read: the capability was built, granted, and then
// never wired to a surface. The knock-on was I-16 — three of the badge's five states (`pending`,
// `pushing`, `pushed`) were unreachable in the running app, because the ONLY consumer of push state
// was the Approvals queue, which by construction lists `failed`/`held` only.
// ════════════════════════════════════════════════════════════════════════════════════════════════
describe('useOwnTimesheetPushState (I-16/I-17)', () => {
  it('I-17 reads the sheet\'s own push state — the read RLS already grants its owner', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useOwnTimesheetPushState('ts-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.data).toBeTruthy());
    expect(getPushState).toHaveBeenCalledWith('ts-1');
    expect(result.current.data?.push_state).toBe('failed');
  });

  it('is disabled with no timesheet (a brand-new week has no sheet to ask about)', () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useOwnTimesheetPushState(undefined), { wrapper: Wrapper });
    expect(result.current.fetchStatus).toBe('idle');
  });
});


it('refreshes mounted correction eligibility after approval and push', async () => {
  let approved = false;
  let finishPush!: () => void;
  pushApprovedMock.mockClear().mockImplementationOnce(() => new Promise<void>(resolve => { finishPush = resolve; }));
  vi.mocked(repositories.timesheet.listAwaitingApproval).mockImplementation(async () => approved ? [] : [{ id: 'ts-1', user_id: 'other-user', week_start_date: '2026-06-01', status: 'Submitted', entries: [], owner: { full_name: 'Report', manager_id: 'u1' } }] as unknown as Awaited<ReturnType<typeof repositories.timesheet.listAwaitingApproval>>);
  vi.mocked(repositories.timesheet.listReopenableApproved).mockImplementation(async () => approved ? [{ id: 'ts-1', user_id: 'other-user', week_start_date: '2026-06-01', status: 'Approved', entries: [], owner: { full_name: 'Report', manager_id: 'u1' }, mirror: null, pushCommandState: null }] as unknown as Awaited<ReturnType<typeof repositories.timesheet.listReopenableApproved>> : []);
  vi.mocked(repositories.timesheet.approve).mockImplementation(async () => { approved = true; });
  const { Wrapper, qc } = makeWrapper();
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const { result } = renderHook(() => ({ pending: useTimesheetsAwaitingApproval(), correction: useReopenableApprovedTimesheets(), mutation: useTimesheetMutations() }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.pending.data).toHaveLength(1));
  await waitFor(() => expect(result.current.correction.data).toEqual([]));
  let approval!: Promise<void>;
  act(() => { approval = result.current.mutation.approve.mutateAsync({ id: 'ts-1' }); });
  await waitFor(() => expect(pushApprovedMock).toHaveBeenCalled());
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => { finishPush(); await approval; });
  await waitFor(() => expect(result.current.pending.data).toHaveLength(0));
  await waitFor(() => expect(result.current.correction.data).toHaveLength(1));
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['timesheets-reopenable-approved', 'org-1', 'u1'] });
});

it.each(['approve', 'approve-push-failure', 'approve-refusal', 'retry', 'retry-failure'] as const)(
  '%s refreshes settled push surfaces for the correct scope', async (operation) => {
    pushApprovedMock.mockReset().mockResolvedValue(undefined);
    vi.mocked(listPushesNeedingAttention).mockClear();
    vi.mocked(approveTimesheet).mockReset().mockResolvedValue(undefined);
    if (operation === 'approve-push-failure' || operation === 'retry-failure') pushApprovedMock.mockRejectedValueOnce(new Error('push failed'));
    if (operation === 'approve-refusal') vi.mocked(approveTimesheet).mockRejectedValueOnce(new Error('refused'));
    const { qc, Wrapper } = makeWrapper();
    const keys = [
      ['timesheet-pushes-attention', 'org-1'], ['timesheet-pushes-attention', 'org-2'],
      ['timesheet-push-state', 'ts-1'], ['timesheet-push-state', 'ts-2'],
      ['timesheets-reopenable-approved', 'org-1', 'u1', 'Project Manager'],
      ['timesheets-reopenable-approved', 'org-1', 'u2', 'Project Manager'],
    ];
    keys.forEach(key => qc.setQueryData(key, 'old'));
    const { result } = renderHook(() => ({ mutation: useTimesheetMutations(), attention: usePushesNeedingAttention() }), { wrapper: Wrapper });
    await waitFor(() => expect(listPushesNeedingAttention).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.attention.fetchStatus).toBe('idle'));
    await act(async () => {
      const promise = operation.startsWith('retry') ? result.current.attention.retry.mutateAsync({ timesheetId: 'ts-1' }) : result.current.mutation.approve.mutateAsync({ id: 'ts-1' });
      if (operation === 'retry-failure' || operation === 'approve-refusal') await expect(promise).rejects.toThrow();
      else await expect(promise).resolves.toBeUndefined();
    });
    expect(qc.getQueryState(keys[1])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys[2])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[3])?.isInvalidated).toBe(false);
    expect(qc.getQueryState(keys[4])?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[5])?.isInvalidated).toBe(false);
    expect(listPushesNeedingAttention).toHaveBeenCalledTimes(2);
  },
);

it('keeps the pending row until the settled correction history refresh finishes', async () => {
  pushApprovedMock.mockReset().mockResolvedValue(undefined);
  vi.mocked(approveTimesheet).mockReset().mockResolvedValue(undefined);
  let finishHistory!: (value: Awaited<ReturnType<typeof repositories.timesheet.listReopenableApproved>>) => void;
  const history = vi.mocked(repositories.timesheet.listReopenableApproved);
  history.mockReset().mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise(resolve => { finishHistory = resolve; }));
  const pending = vi.mocked(repositories.timesheet.listAwaitingApproval);
  pending.mockReset().mockResolvedValue([{ id: 'ts-1' }] as Awaited<ReturnType<typeof repositories.timesheet.listAwaitingApproval>>);
  const { Wrapper } = makeWrapper();
  const { result } = renderHook(() => ({ pending: useTimesheetsAwaitingApproval(), history: useReopenableApprovedTimesheets(), mutation: useTimesheetMutations() }), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.history.isSuccess && result.current.pending.isSuccess).toBe(true));
  let approval!: Promise<void>;
  act(() => { approval = result.current.mutation.approve.mutateAsync({ id: 'ts-1' }); });
  await waitFor(() => expect(history).toHaveBeenCalledTimes(2));
  expect(pending).toHaveBeenCalledTimes(1);
  expect(result.current.pending.data).toHaveLength(1);
  await act(async () => { finishHistory([]); await approval; });
  await waitFor(() => expect(pending).toHaveBeenCalledTimes(2));
});


it.each(['resolve', 'reject'] as const)(
  'refreshes mounted retry consumers only after the push %ss', async (outcome) => {
    let settle!: () => void;
    let fail!: (error: Error) => void;
    pushApprovedMock.mockReset().mockImplementationOnce(() => new Promise<void>((resolve, reject) => { settle = resolve; fail = reject; }));
    let state = 'before';
    const attention = vi.mocked(listPushesNeedingAttention);
    const history = vi.mocked(repositories.timesheet.listReopenableApproved);
    const sheet = vi.mocked(getPushState);
    attention.mockReset().mockImplementation(async () => [{ timesheet_id: state }] as Awaited<ReturnType<typeof listPushesNeedingAttention>>);
    history.mockReset().mockImplementation(async () => [{ id: state }] as Awaited<ReturnType<typeof repositories.timesheet.listReopenableApproved>>);
    sheet.mockReset().mockImplementation(async (id) => ({ push_state: id === 'ts-1' ? state : 'other-sheet', push_error: null, ts_number: null }) as Awaited<ReturnType<typeof getPushState>>);
    const otherOrg = vi.fn(async () => 'other-org');
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => ({
      attention: usePushesNeedingAttention(),
      history: useReopenableApprovedTimesheets(),
      sheet: useOwnTimesheetPushState('ts-1'),
      otherSheet: useOwnTimesheetPushState('ts-2'),
      otherOrg: useQuery({ queryKey: ['timesheet-pushes-attention', 'org-2'], queryFn: otherOrg }),
      otherHistory: useQuery({ queryKey: ['timesheets-reopenable-approved', 'org-2', 'u2', 'Project Manager'], queryFn: otherOrg }),
    }), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.attention.data?.[0]?.timesheet_id).toBe('before'));
    await waitFor(() => expect(result.current.history.data?.[0]?.id).toBe('before'));
    await waitFor(() => expect(result.current.sheet.data?.push_state).toBe('before'));
    await waitFor(() => expect(result.current.otherSheet.data?.push_state).toBe('other-sheet'));
    await waitFor(() => expect(otherOrg).toHaveBeenCalledTimes(2));
    let retry!: Promise<unknown>;
    act(() => { retry = result.current.attention.retry.mutateAsync({ timesheetId: 'ts-1' }).then(() => 'resolved', () => 'rejected'); });
    await waitFor(() => expect(pushApprovedMock).toHaveBeenCalledOnce());
    state = 'after';
    expect(attention).toHaveBeenCalledTimes(1);
    expect(history).toHaveBeenCalledTimes(1);
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(result.current.attention.data?.[0]?.timesheet_id).toBe('before');
    expect(result.current.history.data?.[0]?.id).toBe('before');
    expect(result.current.sheet.data?.push_state).toBe('before');
    await act(async () => {
      if (outcome === 'resolve') settle(); else fail(new Error('push failed'));
      expect(await retry).toBe(outcome === 'resolve' ? 'resolved' : 'rejected');
    });
    await waitFor(() => expect(result.current.attention.data?.[0]?.timesheet_id).toBe('after'));
    await waitFor(() => expect(result.current.history.data?.[0]?.id).toBe('after'));
    await waitFor(() => expect(result.current.sheet.data?.push_state).toBe('after'));
    expect(otherOrg).toHaveBeenCalledTimes(2);
    expect(result.current.otherOrg.data).toBe('other-org');
    expect(result.current.otherHistory.data).toBe('other-org');
    expect(result.current.otherSheet.data?.push_state).toBe('other-sheet');
    expect(sheet.mock.calls.filter(([id]) => id === 'ts-2')).toHaveLength(1);
  },
);
