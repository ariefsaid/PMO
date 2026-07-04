import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

vi.mock('@/src/lib/db/timesheets', () => ({
  listTimesheets: vi.fn().mockResolvedValue([
    { id: 'ts1', user_id: 'u1', week_start_date: '2026-06-01', status: 'Draft', entries: [] },
  ]),
  createDraftTimesheet: vi.fn(),
  upsertTimesheetEntries: vi.fn(),
  deleteTimesheetEntry: vi.fn(),
  saveTimesheetWeek: vi.fn(),
  TimesheetWriteError: class TimesheetWriteError extends Error {
    code?: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'TimesheetWriteError';
      this.code = code;
    }
  },
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' }, role: 'Engineer' }),
}));

import { useTimesheets } from './useTimesheets';
import { useTimesheetEntryMutations } from './useTimesheetEntries';
import {
  listTimesheets,
  createDraftTimesheet,
  upsertTimesheetEntries,
  deleteTimesheetEntry,
  saveTimesheetWeek,
  TimesheetWriteError,
} from '@/src/lib/db/timesheets';
import type { EntryDiff } from '@/src/lib/timesheet-edit';

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
  vi.mocked(createDraftTimesheet).mockReset();
  vi.mocked(upsertTimesheetEntries).mockReset();
  vi.mocked(deleteTimesheetEntry).mockReset();
  vi.mocked(saveTimesheetWeek).mockReset();
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
  it('AC-TSE-016: deleteRow deletes each persisted entry then invalidates the timesheets key', async () => {
    vi.mocked(deleteTimesheetEntry).mockResolvedValue(undefined);
    const { wrapper, invalidateSpy } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper });

    await act(async () => {
      await result.current.deleteRow.mutateAsync({ entryIds: ['e1', 'e2'] });
    });

    expect(deleteTimesheetEntry).toHaveBeenCalledWith('e1');
    expect(deleteTimesheetEntry).toHaveBeenCalledWith('e2');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['timesheets', 'org-1', 'u1'] });
  });
});
