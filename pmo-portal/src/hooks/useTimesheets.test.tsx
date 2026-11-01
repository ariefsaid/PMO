import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/timesheets', () => ({
  TimesheetWriteError: class TimesheetWriteError extends Error {
    constructor(message: string, public code?: string) { super(message); this.name = 'TimesheetWriteError'; }
  },
}));
vi.mock('@/src/lib/repositories', () => ({ repositories: { timesheet: {
  list: vi.fn().mockResolvedValue([{ id: 'ts1', user_id: 'u1', week_start_date: '2026-06-01', status: 'Draft', entries: [] }]),
  saveWeek: vi.fn(), createDraft: vi.fn(), upsertEntries: vi.fn(), deleteEntry: vi.fn(),
} } }));
const auth = vi.hoisted(() => ({ currentUser: { id: 'u1', org_id: 'org-1' } }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: auth.currentUser, role: 'Engineer' }),
}));

import { useTimesheets } from './useTimesheets';
import { useTimesheetEntryMutations } from './useTimesheetEntries';
import { repositories } from '@/src/lib/repositories';
import { TimesheetWriteError } from '@/src/lib/db/timesheets';
import type { EntryDiff } from '@/src/lib/timesheet-edit';

const { list: listTimesheets, saveWeek: saveTimesheetWeek, createDraft: createDraftTimesheet, upsertEntries: upsertTimesheetEntries, deleteEntry: deleteTimesheetEntry } = repositories.timesheet;

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

/** Wrapper that exposes the QueryClient so tests can spy on invalidateQueries. */
function makeWrapper() {
  const client = new QueryClient();
  const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidateSpy };
}

beforeEach(() => {
  auth.currentUser = { id: 'u1', org_id: 'org-1' };
  vi.mocked(createDraftTimesheet).mockReset();
  vi.mocked(upsertTimesheetEntries).mockReset();
  vi.mocked(deleteTimesheetEntry).mockReset();
  vi.mocked(saveTimesheetWeek).mockReset();
  onlineManager.setOnline(true);
  vi.mocked(listTimesheets).mockReset().mockResolvedValue([{ id: 'ts-existing', user_id: 'u1', week_start_date: '2026-06-01', status: 'Draft', entries: [] }] as never);
});

describe('useTimesheets', () => {
  it("keys by ['timesheets', orgId, userId], calls listTimesheets(userId) (AC-601, FR-QRY-TS-001)", async () => {
    const { result } = renderHook(() => useTimesheets(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0].week_start_date).toBe('2026-06-01');
    expect(listTimesheets).toHaveBeenCalledWith('u1');
  });
});

// ---------------------------------------------------------------------------
// useTimesheetEntryMutations — Task 9 (AC-TSE-016/018, FR-TSE-011/012/016/017)
// ---------------------------------------------------------------------------

const DIFF: EntryDiff = {
  upserts: [
    { timesheet_id: 'NEW', project_id: 'p1', entry_date: '2026-06-08', hours: 8, notes: null },
  ],
  deletes: [],
};

it('keeps timesheet caches scoped when the signed-in identity changes', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  vi.mocked(listTimesheets).mockImplementation(async (id) => [{ id, user_id: id, week_start_date: '2026-06-01', status: 'Draft', entries: [] }] as never);
  const { result, rerender } = renderHook(() => useTimesheets(), { wrapper });
  await waitFor(() => expect(result.current.data?.[0].id).toBe('u1'));
  auth.currentUser = { id: 'u2', org_id: 'org-2' };
  rerender();
  await waitFor(() => expect(result.current.data?.[0].id).toBe('u2'));
  expect(client.getQueryData<{ id: string }[]>(['timesheets', 'org-1', 'u1'])?.[0].id).toBe('u1');
  expect(client.getQueryData<{ id: string }[]>(['timesheets', 'org-2', 'u2'])?.[0].id).toBe('u2');
});

describe('useTimesheetEntryMutations.saveWeek', () => {
  // harden #1: the Save is now ONE atomic RPC (create-draft + upsert + delete in one transaction).
  // The goal-oracle is unchanged — the week's edits persist and the own-timesheets key is
  // invalidated — but the journey no longer issues three separate DAL writes.
  it("AC-TSE-016: saveWeek commits the week atomically then invalidates ['timesheets',orgId,userId] when currentTimesheetId is null", async () => {
    vi.mocked(saveTimesheetWeek).mockResolvedValue('ts-new');
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });

    let resolved: string | undefined;
    await act(async () => {
      resolved = await result.current.saveWeek.mutateAsync({
        currentTimesheetId: null,
        weekStartDate: '2026-06-08',
        diff: DIFF,
      });
    });

    // One atomic RPC carries the null (create) id, the week, the upserts and the deletes.
    expect(saveTimesheetWeek).toHaveBeenCalledTimes(1);
    expect(saveTimesheetWeek).toHaveBeenCalledWith(null, '2026-06-08', DIFF.upserts, DIFF.deletes);
    // Returns the RPC's resolved sheet id (for chained submit).
    expect(resolved).toBe('ts-new');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timesheets', 'org-1', 'u1'] });
  });

  it('AC-TSE-016: saveWeek passes the existing timesheet id + deletes through the atomic RPC', async () => {
    vi.mocked(saveTimesheetWeek).mockResolvedValue('ts-existing');
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });

    const diff = {
      upserts: [{ timesheet_id: 'ts-existing', project_id: 'p1', entry_date: '2026-06-08', hours: 4, notes: null }],
      deletes: ['del-1'],
    };
    await act(async () => {
      await result.current.saveWeek.mutateAsync({
        currentTimesheetId: 'ts-existing',
        weekStartDate: '2026-06-08',
        diff,
      });
    });

    expect(saveTimesheetWeek).toHaveBeenCalledWith('ts-existing', '2026-06-08', diff.upserts, diff.deletes);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timesheets', 'org-1', 'u1'] });
  });

  it('AC-TSE-018: saveWeek failure rejects with TimesheetWriteError (code preserved) and does NOT invalidate', async () => {
    vi.mocked(saveTimesheetWeek).mockRejectedValue(new TimesheetWriteError('rls denied', '42501'));
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });

    await act(async () => {
      await expect(
        result.current.saveWeek.mutateAsync({ currentTimesheetId: null, weekStartDate: '2026-06-08', diff: DIFF }),
      ).rejects.toMatchObject({ name: 'TimesheetWriteError', code: '42501' });
    });

    await waitFor(() => expect(result.current.saveWeek.isError).toBe(true));
    expect(result.current.saveWeek.error?.code).toBe('42501');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useTimesheetEntryMutations.deleteRow', () => {
  it('holds reconciliation until the originating sheet is read after a lost response', async () => {
    const sheet = { id: 'ts-existing', user_id: 'u1', week_start_date: '2026-06-08', status: 'Draft', entries: [] };
    vi.mocked(listTimesheets).mockResolvedValueOnce([sheet] as never).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue([sheet] as never);
    vi.mocked(saveTimesheetWeek).mockImplementationOnce(async () => { onlineManager.setOnline(false); throw new TimesheetWriteError('Response lost'); });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => ({ query: useTimesheets(), mutations: useTimesheetEntryMutations() }), { wrapper });
    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    await act(async () => { await expect(result.current.mutations.deleteRow.mutateAsync({ timesheetId: 'ts-existing', weekStartDate: '2026-06-08', entryIds: ['e1'] })).rejects.toThrow('Response lost'); });
    expect(result.current.mutations.isReconciling).toBe(true);
    onlineManager.setOnline(true);
    await act(async () => { await result.current.mutations.retryDeleteRefresh(); });
    expect(result.current.mutations.isReconciling).toBe(false);
    expect(vi.mocked(listTimesheets).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(result.current.query.data?.[0].week_start_date).toBe('2026-06-08');
  });

  it('runs only one reconciliation read when retry is clicked repeatedly', async () => {
    vi.mocked(saveTimesheetWeek).mockRejectedValue(new TimesheetWriteError('Unavailable'));
    vi.mocked(listTimesheets).mockRejectedValueOnce(new Error('Offline'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });
    await act(async () => { await expect(result.current.deleteRow.mutateAsync({ timesheetId: 'ts-existing', weekStartDate: '2026-06-08', entryIds: ['e1'] })).rejects.toThrow(); });
    let resolveRead!: (value: never) => void;
    vi.mocked(listTimesheets).mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }));
    let first!: Promise<void>; let second!: Promise<void>;
    await act(async () => { first = result.current.retryDeleteRefresh(); second = result.current.retryDeleteRefresh(); });
    expect(listTimesheets).toHaveBeenCalledTimes(2);
    await act(async () => { resolveRead([{ id: 'ts-existing', week_start_date: '2026-06-08', entries: [] }] as never); await Promise.all([first, second]); });
    expect(result.current.isReconciling).toBe(false);
  });

  it('refreshes server state after a failed row operation', async () => {
    vi.mocked(saveTimesheetWeek).mockRejectedValue(new TimesheetWriteError('Unavailable'));
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });
    await act(async () => {
      await expect(result.current.deleteRow.mutateAsync({ timesheetId: 'ts-existing', weekStartDate: '2026-06-08', entryIds: ['e1', 'e2'] })).rejects.toThrow('Unavailable');
    });
    expect(listTimesheets).toHaveBeenCalledWith('u1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timesheets', 'org-1', 'u1'], refetchType: 'none' });
  });

  it('AC-TSE-016: deleteRow commits the row in one transaction and refreshes the timesheets key', async () => {
    vi.mocked(saveTimesheetWeek).mockResolvedValue('ts-existing');
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });

    await act(async () => {
      await result.current.deleteRow.mutateAsync({ timesheetId: 'ts-existing', weekStartDate: '2026-06-08', entryIds: ['e1', 'e2'] });
    });

    expect(saveTimesheetWeek).toHaveBeenCalledWith('ts-existing', '2026-06-08', [], ['e1', 'e2']);
    expect(deleteTimesheetEntry).not.toHaveBeenCalled();
    expect(listTimesheets).toHaveBeenCalledWith('u1');
  });
});
