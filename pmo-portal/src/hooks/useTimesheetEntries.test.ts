import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { EntryDiff } from '@/src/lib/timesheet-edit';

// DAL mock — the hook must route the whole week Save through the ONE atomic RPC
// wrapper (saveTimesheetWeek), NOT the three separate legacy writes.
const dal = vi.hoisted(() => ({
  saveTimesheetWeek:
    vi.fn<
      (id: string | null, week: string, upserts: unknown[], deletes: string[]) => Promise<string>
    >(),
  createDraftTimesheet: vi.fn(),
  upsertTimesheetEntries: vi.fn(),
  deleteTimesheetEntry: vi.fn(),
  TimesheetWriteError: class extends Error {},
}));
vi.mock('@/src/lib/db/timesheets', () => dal);
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'user-1', org_id: 'org-1' } }),
}));

import { useTimesheetEntryMutations } from './useTimesheetEntries';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  return { Wrapper };
}

const diff: EntryDiff = {
  upserts: [
    { timesheet_id: 'placeholder', project_id: 'proj-1', entry_date: '2026-06-08', hours: 8, notes: null },
  ],
  deletes: ['entry-old-1'],
};

beforeEach(() => {
  vi.clearAllMocks();
  dal.saveTimesheetWeek.mockResolvedValue('sheet-resolved');
});

describe('useTimesheetEntryMutations.saveWeek (harden #1 — atomic single-RPC save)', () => {
  it('routes the whole week save through ONE atomic saveTimesheetWeek call', async () => {
    const { Wrapper } = makeWrapper();
    const { result } = renderHook(() => useTimesheetEntryMutations(), { wrapper: Wrapper });

    let resolved: string | undefined;
    await act(async () => {
      resolved = await result.current.saveWeek.mutateAsync({
        currentTimesheetId: null,
        weekStartDate: '2026-06-08',
        diff,
      });
    });

    // One atomic call carrying the resolve-or-create id, the week, the upserts, and the deletes.
    expect(dal.saveTimesheetWeek).toHaveBeenCalledTimes(1);
    expect(dal.saveTimesheetWeek).toHaveBeenCalledWith(null, '2026-06-08', diff.upserts, diff.deletes);
    // The three legacy non-atomic writes MUST NOT be used anymore.
    expect(dal.createDraftTimesheet).not.toHaveBeenCalled();
    expect(dal.upsertTimesheetEntries).not.toHaveBeenCalled();
    expect(dal.deleteTimesheetEntry).not.toHaveBeenCalled();
    // Returns the RPC's resolved sheet id (for chained submit).
    expect(resolved).toBe('sheet-resolved');
  });
});
