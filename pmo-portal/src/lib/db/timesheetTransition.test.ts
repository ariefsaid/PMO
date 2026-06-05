import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mock setup — mirrors procurementLifecycle.test.ts builder pattern
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockSelect, mockEq, mockNeq, mockOrder } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockEq = vi.fn();
  const mockNeq = vi.fn();
  const mockOrder = vi.fn();
  return { mockRpc, mockFrom, mockSelect, mockEq, mockNeq, mockOrder };
});

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import {
  isLegalTimesheetTransition,
  timesheetActions,
  submitTimesheet,
  approveTimesheet,
  rejectTimesheet,
  listTimesheetsAwaitingApproval,
} from './timesheetTransition';

// ---------------------------------------------------------------------------
// Builder helpers (mirrors procurementLifecycle.test.ts)
// ---------------------------------------------------------------------------

function makeRpcBuilder(resolved: { data: unknown; error: unknown }) {
  const builder = {
    then: (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject),
  };
  mockRpc.mockReturnValue(builder);
  return builder;
}

function makeFromBuilder(resolved: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  builder.select = mockSelect.mockReturnValue(builder);
  builder.eq = mockEq.mockReturnValue(builder);
  builder.neq = mockNeq.mockReturnValue(builder);
  builder.order = mockOrder.mockReturnValue(builder);
  builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockSelect.mockReset();
  mockEq.mockReset();
  mockNeq.mockReset();
  mockOrder.mockReset();
});

// ---------------------------------------------------------------------------
// B1/B2 — Transition map (AC-900)
// ---------------------------------------------------------------------------

describe('isLegalTimesheetTransition', () => {
  it('AC-900: timesheet transition map accepts legal pairs, rejects illegal jumps and terminal exits (FR-TS-001)', () => {
    // Legal transitions
    expect(isLegalTimesheetTransition('Draft', 'Submitted')).toBe(true);
    expect(isLegalTimesheetTransition('Submitted', 'Approved')).toBe(true);
    expect(isLegalTimesheetTransition('Submitted', 'Rejected')).toBe(true);
    expect(isLegalTimesheetTransition('Rejected', 'Draft')).toBe(true);

    // Illegal jumps
    expect(isLegalTimesheetTransition('Draft', 'Approved')).toBe(false);
    expect(isLegalTimesheetTransition('Approved', 'Draft')).toBe(false);
    expect(isLegalTimesheetTransition('Submitted', 'Draft')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B3 — Action-gate helper (AC-901)
// ---------------------------------------------------------------------------

describe('timesheetActions', () => {
  it("AC-901: timesheetActions offers Submit to the owner of a Draft sheet, nothing on the owner's Submitted sheet (SoD), Approve/Reject to an approver of a Submitted sheet (FR-TS-004/005)", () => {
    // Owner sees Draft → Submit enabled
    expect(timesheetActions('Draft', true, false)).toEqual({
      submit: true,
      approve: false,
      reject: false,
    });

    // Owner viewing own Submitted sheet → SoD: no actions
    expect(timesheetActions('Submitted', true, false)).toEqual({
      submit: false,
      approve: false,
      reject: false,
    });

    // Approver (non-owner) viewing Submitted sheet → Approve + Reject enabled
    expect(timesheetActions('Submitted', false, true)).toEqual({
      submit: false,
      approve: true,
      reject: true,
    });
  });
});

// ---------------------------------------------------------------------------
// B4 — DAL RPC error surfacing + param/no-org-id (AC-902)
// ---------------------------------------------------------------------------

describe('submitTimesheet / approveTimesheet / rejectTimesheet', () => {
  it('AC-902: submitTimesheet/approveTimesheet/rejectTimesheet surface the RPC 42501/P0001 error and send {p_timesheet_id,p_to,p_notes} with no org_id (FR-TS-002/010)', async () => {
    // Error path: should throw
    makeRpcBuilder({ data: null, error: { message: 'not authorized', code: '42501' } });
    await expect(approveTimesheet('ts-id')).rejects.toThrow('not authorized');

    // Submit: success + correct args
    makeRpcBuilder({ data: null, error: null });
    await submitTimesheet('ts-id');
    expect(mockRpc).toHaveBeenCalledWith('transition_timesheet', {
      p_timesheet_id: 'ts-id',
      p_to: 'Submitted',
      p_notes: null,
    });
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');

    // Approve: with notes
    makeRpcBuilder({ data: null, error: null });
    await approveTimesheet('ts-id', 'looks good');
    expect(mockRpc).toHaveBeenCalledWith('transition_timesheet', {
      p_timesheet_id: 'ts-id',
      p_to: 'Approved',
      p_notes: 'looks good',
    });

    // Reject: no notes → null
    makeRpcBuilder({ data: null, error: null });
    await rejectTimesheet('ts-id');
    expect(mockRpc).toHaveBeenCalledWith('transition_timesheet', {
      p_timesheet_id: 'ts-id',
      p_to: 'Rejected',
      p_notes: null,
    });
  });

  it('does not send org_id to the RPC (FR-TS-009/010)', async () => {
    makeRpcBuilder({ data: null, error: null });
    await submitTimesheet('ts-id');
    expect(JSON.stringify(mockRpc.mock.calls)).not.toContain('org_id');
  });
});

// ---------------------------------------------------------------------------
// B5 — listTimesheetsAwaitingApproval shape + SoD filter (AC-903)
// ---------------------------------------------------------------------------

describe('listTimesheetsAwaitingApproval', () => {
  it("AC-903: listTimesheetsAwaitingApproval selects Submitted sheets, neq user_id (SoD), joins owner + entries, orders by week_start_date, sends no org_id (FR-TS-011)", async () => {
    const rows = [
      {
        id: 'ts-1',
        user_id: 'other-user',
        week_start_date: '2026-06-01',
        status: 'Submitted',
        entries: [
          {
            id: 'e1',
            hours: '8.00',
            project: { name: 'Project A', code: 'PA' },
          },
        ],
        owner: { full_name: 'Dave Engineer' },
      },
    ];

    makeFromBuilder({ data: rows, error: null });

    const result = await listTimesheetsAwaitingApproval('self-id');

    expect(mockFrom).toHaveBeenCalledWith('timesheets');
    expect(mockSelect).toHaveBeenCalledWith(
      '*, owner:profiles!timesheets_user_id_fkey(full_name), entries:timesheet_entries(*, project:projects(name,code))',
    );
    expect(mockEq).toHaveBeenCalledWith('status', 'Submitted');
    expect(mockNeq).toHaveBeenCalledWith('user_id', 'self-id');
    expect(mockOrder).toHaveBeenCalledWith('week_start_date', { ascending: false });

    // No org_id sent
    expect(JSON.stringify(mockEq.mock.calls)).not.toContain('org_id');
    expect(JSON.stringify(mockNeq.mock.calls)).not.toContain('org_id');

    // hours normalised to number
    expect(result[0].entries[0].hours).toBe(8);
  });

  it('throws on PostgREST error (FR-TS-011)', async () => {
    makeFromBuilder({ data: null, error: { message: 'select failed' } });
    await expect(listTimesheetsAwaitingApproval('self-id')).rejects.toThrow('select failed');
  });
});
