import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — a chainable Supabase query builder (mirrors
// procurementLifecycle.test.ts). Each terminal (.order / .single / awaiting
// the builder for upsert/delete) resolves to the configured { data, error }.
// ---------------------------------------------------------------------------

const { mockFrom, mockSelect, mockEq, mockOrder, mockRange, mockInsert, mockSingle, mockUpsert, mockDelete } =
  vi.hoisted(() => ({
    mockFrom: vi.fn(),
    mockSelect: vi.fn(),
    mockEq: vi.fn(),
    mockOrder: vi.fn(),
    mockRange: vi.fn(),
    mockInsert: vi.fn(),
    mockSingle: vi.fn(),
    mockUpsert: vi.fn(),
    mockDelete: vi.fn(),
  }));

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: mockFrom } }));

import {
  listTimesheets,
  createDraftTimesheet,
  upsertTimesheetEntries,
  deleteTimesheetEntry,
  TimesheetWriteError,
} from './timesheets';
import type { EntryUpsert } from '@/src/lib/timesheet-edit';

/** Build a chainable builder whose terminal await/.single()/.range() resolves to `resolved`. */
function builderResolving(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  mockSelect.mockReturnValue(builder);
  mockEq.mockReturnValue(builder);
  mockOrder.mockReturnValue(builder);
  mockRange.mockResolvedValue(resolved);
  mockInsert.mockReturnValue(builder);
  mockSingle.mockResolvedValue(resolved);
  mockUpsert.mockResolvedValue(resolved);
  mockDelete.mockReturnValue(builder);
  builder.select = mockSelect;
  builder.eq = mockEq;
  builder.order = mockOrder;
  builder.range = mockRange;
  builder.insert = mockInsert;
  builder.single = mockSingle;
  builder.upsert = mockUpsert;
  builder.delete = mockDelete;
  // .delete().eq(...) is itself awaited (no terminal): make the builder thenable.
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockOrder.mockReset();
  mockRange.mockReset();
  mockInsert.mockReset();
  mockSingle.mockReset();
  mockUpsert.mockReset();
  mockDelete.mockReset();
  builderResolving({ data: [], error: null });
});

// ---------------------------------------------------------------------------
// listTimesheets — read path (unchanged contract)
// ---------------------------------------------------------------------------

describe('listTimesheets', () => {
  it('selects timesheets with nested entries+project, filtered by user_id, ordered by week desc (AC-608, FR-DAL-TS-001)', async () => {
    const rows = [{
      id: '70000000-0000-0000-0000-000000000002',
      user_id: '00000000-0000-0000-0000-0000000000a2',
      week_start_date: '2026-06-01', status: 'Draft',
      submitted_at: null, approved_by: null, approved_at: null,
      org_id: '00000000-0000-0000-0000-000000000001',
      entries: [
        { id: 'e1', timesheet_id: '70000000-0000-0000-0000-000000000002',
          project_id: '40000000-0000-0000-0000-000000000001', entry_date: '2026-06-01',
          hours: 6, notes: 'Client workshop',
          project: { name: 'Innovate Corp HQ Fit-Out', code: 'P001' } },
      ],
    }];
    builderResolving({ data: rows, error: null });
    const result = await listTimesheets('00000000-0000-0000-0000-0000000000a2');
    expect(mockFrom).toHaveBeenCalledWith('timesheets');
    expect(mockSelect).toHaveBeenCalledWith('*, entries:timesheet_entries(*, project:projects(name,code))');
    expect(mockEq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-0000000000a2');
    expect(mockOrder).toHaveBeenCalledWith('week_start_date', { ascending: false });
    expect(result[0].entries[0].project?.name).toBe('Innovate Corp HQ Fit-Out');
    expect(result[0].entries[0].entry_date).toBe('2026-06-01');
  });

  it('sends no org_id (RLS scopes it) (FR-DAL-TS-001)', async () => {
    builderResolving({ data: [], error: null });
    await listTimesheets('u1');
    expect(JSON.stringify(mockSelect.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });

  it('throws on PostgREST error (AC-608)', async () => {
    builderResolving({ data: null, error: { message: 'boom' } });
    await expect(listTimesheets('u1')).rejects.toThrow('boom');
  });

  it('data-layer perf hardening #4: does NOT range-bound the query when called with no page params (opt-in pagination)', async () => {
    builderResolving({ data: [], error: null });
    await listTimesheets('u1');
    expect(mockRange).not.toHaveBeenCalled();
  });

  it('data-layer perf hardening #4: applies an explicit page/pageSize range', async () => {
    builderResolving({ data: [], error: null });
    await listTimesheets('u1', { page: 1, pageSize: 12 });
    expect(mockRange).toHaveBeenCalledWith(12, 23);
  });
});

// ---------------------------------------------------------------------------
// createDraftTimesheet — Task 5 (AC-TSE-019 part, FR-TSE-017)
// ---------------------------------------------------------------------------

describe('createDraftTimesheet', () => {
  it('AC-TSE-019: createDraftTimesheet inserts (user_id, week_start_date, status=Draft), sends NO org_id, throws TimesheetWriteError preserving error.code', async () => {
    const newRow = {
      id: 'ts-new', org_id: 'org-1', user_id: 'u1',
      week_start_date: '2026-06-08', status: 'Draft',
    };
    builderResolving({ data: newRow, error: null });

    const result = await createDraftTimesheet('2026-06-08', 'u1');

    expect(mockFrom).toHaveBeenCalledWith('timesheets');
    const payload = mockInsert.mock.calls[0][0];
    expect(payload).toMatchObject({ user_id: 'u1', week_start_date: '2026-06-08', status: 'Draft' });
    expect(payload).not.toHaveProperty('org_id');
    expect(mockSelect).toHaveBeenCalled();
    expect(mockSingle).toHaveBeenCalled();
    expect(result.id).toBe('ts-new');
  });

  it('AC-TSE-019: createDraftTimesheet throws TimesheetWriteError carrying error.code on PostgREST error', async () => {
    builderResolving({ data: null, error: { message: 'duplicate key', code: '23505' } });
    await expect(createDraftTimesheet('2026-06-08', 'u1')).rejects.toMatchObject({
      name: 'TimesheetWriteError', code: '23505',
    });
    await expect(createDraftTimesheet('2026-06-08', 'u1')).rejects.toBeInstanceOf(TimesheetWriteError);
  });
});

// ---------------------------------------------------------------------------
// upsertTimesheetEntries — Task 6 (AC-TSE-019 part, FR-TSE-017)
// ---------------------------------------------------------------------------

describe('upsertTimesheetEntries', () => {
  const entries: EntryUpsert[] = [
    { timesheet_id: 'ts1', project_id: 'p1', entry_date: '2026-06-08', hours: 6, notes: 'work' },
    { timesheet_id: 'ts1', project_id: 'p1', entry_date: '2026-06-09', hours: 4, notes: 'work' },
  ];

  it('AC-TSE-019: upsertTimesheetEntries upserts on (timesheet_id,project_id,entry_date), sends NO org_id, throws TimesheetWriteError preserving code', async () => {
    builderResolving({ data: null, error: null });

    await upsertTimesheetEntries(entries);

    expect(mockFrom).toHaveBeenCalledWith('timesheet_entries');
    expect(mockUpsert).toHaveBeenCalledWith(entries, { onConflict: 'timesheet_id,project_id,entry_date' });
    // No org_id smuggled into any row of the payload.
    expect(JSON.stringify(mockUpsert.mock.calls)).not.toContain('org_id');
  });

  it('AC-TSE-019: upsertTimesheetEntries is a no-op (no DB call) for an empty list', async () => {
    builderResolving({ data: null, error: null });
    await upsertTimesheetEntries([]);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('AC-TSE-019: upsertTimesheetEntries throws TimesheetWriteError carrying code on error', async () => {
    builderResolving({ data: null, error: { message: 'rls', code: '42501' } });
    await expect(upsertTimesheetEntries(entries)).rejects.toMatchObject({
      name: 'TimesheetWriteError', code: '42501',
    });
  });
});

// ---------------------------------------------------------------------------
// deleteTimesheetEntry — Task 7 (AC-TSE-019 part, FR-TSE-017)
// ---------------------------------------------------------------------------

describe('deleteTimesheetEntry', () => {
  it('AC-TSE-019: deleteTimesheetEntry deletes by id, sends NO org_id, throws TimesheetWriteError preserving code', async () => {
    builderResolving({ data: null, error: null });

    await deleteTimesheetEntry('entry-1');

    expect(mockFrom).toHaveBeenCalledWith('timesheet_entries');
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'entry-1');
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
  });

  it('AC-TSE-019: deleteTimesheetEntry throws TimesheetWriteError carrying code on error', async () => {
    builderResolving({ data: null, error: { message: 'rls', code: '42501' } });
    await expect(deleteTimesheetEntry('entry-1')).rejects.toMatchObject({
      name: 'TimesheetWriteError', code: '42501',
    });
  });
});
