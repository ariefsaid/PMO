import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * P3b (FR-TSP-085, FR-TSP-173, OQ-TSP-10(C)) — the operator-surface reads:
 *   - `getPushState`: the ERP push state of a single sheet (`timesheet_erp_mirror`, migration 0136).
 *     Absent row (no mirror at all) is a NORMAL state (a not-yet-flipped org, or a sheet that hasn't
 *     reached the push path yet) — never an error. FR-TSP-173: the page must render fully with the
 *     badge simply absent, never a blocked/error render.
 *   - `listPushesNeedingAttention`: the failed/held pushes visible to the caller (RLS scopes it to
 *     own/managed/privileged, same as `timesheet_erp_mirror_select`) — the Approvals operator surface.
 *   - `listProposedEmployeeLinks`: the Admin-visible queue of `erp_employees` rows awaiting a human
 *     confirm (`link_state = 'proposed'`) — NEVER `'confirmed'` automatically (OQ-TSP-10(C) ruling).
 *   - `confirmEmployeeLink`: the Admin confirm action. The RPC itself (`confirm_erp_employee_link`)
 *     ships in a companion migration this slice does not own (Slice 3 / OQ-TSP-10) — this wrapper is
 *     written against the frozen contract (an Admin-only, audited, propose-never-self-confirm RPC) so
 *     the FE lights up the moment that migration lands. Until then the call surfaces a normal
 *     classifiable AppError (never a silent success) — the same "additive, inert until wired" posture
 *     as every other P3b seam in this plan.
 */

const h = vi.hoisted(() => {
  const state = {
    mirrorRow: null as unknown,
    mirrorError: null as { message: string; code?: string } | null,
    mirrorAttentionRows: [] as unknown[],
    mirrorAttentionError: null as { message: string; code?: string } | null,
    sheetsRows: [] as unknown[],
    sheetsError: null as { message: string; code?: string } | null,
    linksRows: [] as unknown[],
    linksError: null as { message: string; code?: string } | null,
    rpcError: null as { message: string; code?: string } | null,
  };
  const calls = {
    from: [] as string[],
    select: [] as unknown[][],
    eq: [] as unknown[][],
    in: [] as unknown[][],
    order: [] as unknown[][],
    maybeSingle: 0,
    rpc: [] as unknown[][],
  };

  // A single `timesheet_erp_mirror` table serves TWO shapes: the single-sheet `getPushState` read
  // (terminates on `.maybeSingle()`) and the org-wide `listPushesNeedingAttention` read (terminates
  // on `.in()`, thenable). Route by which terminal method is called.
  function makeBuilder(table: string) {
    const builder: Record<string, unknown> = {};
    builder.select = (...args: unknown[]) => {
      calls.select.push(args);
      return builder;
    };
    builder.eq = (...args: unknown[]) => {
      calls.eq.push(args);
      return builder;
    };
    builder.in = (...args: unknown[]) => {
      calls.in.push(args);
      return builder;
    };
    builder.order = (...args: unknown[]) => {
      calls.order.push(args);
      return builder;
    };
    builder.maybeSingle = () => {
      calls.maybeSingle++;
      return Promise.resolve({ data: state.mirrorRow, error: state.mirrorError });
    };
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'timesheet_erp_mirror') {
        return resolve({ data: state.mirrorAttentionRows, error: state.mirrorAttentionError });
      }
      if (table === 'timesheets') {
        return resolve({ data: state.sheetsRows, error: state.sheetsError });
      }
      return resolve({ data: state.linksRows, error: state.linksError });
    };
    return builder;
  }

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    return makeBuilder(table);
  });
  const rpc = vi.fn((...args: unknown[]) => {
    calls.rpc.push(args);
    return Promise.resolve({ data: null, error: state.rpcError });
  });

  return { state, calls, from, rpc };
});

vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  getPushState,
  listPushesNeedingAttention,
  listProposedEmployeeLinks,
  confirmEmployeeLink,
} from './timesheetPush';

beforeEach(() => {
  vi.clearAllMocks();
  h.state.mirrorRow = null;
  h.state.mirrorError = null;
  h.state.mirrorAttentionRows = [];
  h.state.mirrorAttentionError = null;
  h.state.sheetsRows = [];
  h.state.sheetsError = null;
  h.state.linksRows = [];
  h.state.linksError = null;
  h.state.rpcError = null;
  h.calls.from.length = 0;
  h.calls.select.length = 0;
  h.calls.eq.length = 0;
  h.calls.in.length = 0;
  h.calls.order.length = 0;
  h.calls.maybeSingle = 0;
  h.calls.rpc.length = 0;
});

describe('getPushState — FR-TSP-085/173', () => {
  it('returns the mirror row (push_state/push_error/ts_number) for a pushed sheet', async () => {
    h.state.mirrorRow = { push_state: 'failed', push_error: 'employee-unlinked', ts_number: null };
    const state = await getPushState('ts-1');
    expect(state).toEqual({ push_state: 'failed', push_error: 'employee-unlinked', ts_number: null });
    expect(h.calls.from).toContain('timesheet_erp_mirror');
    expect(h.calls.eq).toContainEqual(['timesheet_id', 'ts-1']);
  });

  it('FR-TSP-173: an ABSENT mirror row (no push ever attempted) resolves to null, never throws', async () => {
    h.state.mirrorRow = null;
    await expect(getPushState('ts-2')).resolves.toBeNull();
  });

  it('classifies a query error as an AppError (never a silent swallow)', async () => {
    h.state.mirrorError = { message: 'boom', code: '42501' };
    await expect(getPushState('ts-3')).rejects.toMatchObject({ message: 'boom', code: '42501' });
  });
});

describe('listPushesNeedingAttention — the Approvals operator surface (FR-TSP-085)', () => {
  it('joins failed/held mirror rows to their sheet + owner (RLS scopes visibility, same as the read policy)', async () => {
    h.state.mirrorAttentionRows = [
      { timesheet_id: 'ts-1', push_state: 'failed', push_error: 'employee-unlinked', ts_number: null },
    ];
    h.state.sheetsRows = [
      {
        id: 'ts-1',
        week_start_date: '2026-01-05',
        approved_by: 'mgr-1',
        owner: { full_name: 'Dave Engineer' },
      },
    ];
    const rows = await listPushesNeedingAttention();
    expect(rows).toEqual([
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
    expect(h.calls.in).toContainEqual(['push_state', ['failed', 'held']]);
  });

  it('an empty attention set never queries the sheets table (short-circuits, zero added cost)', async () => {
    h.state.mirrorAttentionRows = [];
    const rows = await listPushesNeedingAttention();
    expect(rows).toEqual([]);
    expect(h.calls.from).not.toContain('timesheets');
  });

  it('classifies a mirror-query error as an AppError', async () => {
    h.state.mirrorAttentionError = { message: 'denied', code: '42501' };
    await expect(listPushesNeedingAttention()).rejects.toMatchObject({ message: 'denied', code: '42501' });
  });
});

describe('listProposedEmployeeLinks — OQ-TSP-10(C): NEVER auto-confirmed, only "proposed" surfaces', () => {
  it('queries erp_employees filtered to link_state = proposed', async () => {
    h.state.linksRows = [
      { id: 'emp-1', employee_name: 'Jane Doe', work_email: 'jane@co.test', link_proposed_reason: 'unique work_email match', profile_id: 'profile-1' },
    ];
    const rows = await listProposedEmployeeLinks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'emp-1', employee_name: 'Jane Doe' });
    expect(h.calls.from).toContain('erp_employees');
    expect(h.calls.eq).toContainEqual(['link_state', 'proposed']);
  });

  it('an empty result is an empty array, never null/undefined', async () => {
    h.state.linksRows = [];
    await expect(listProposedEmployeeLinks()).resolves.toEqual([]);
  });

  it('classifies a query error as an AppError', async () => {
    h.state.linksError = { message: 'denied', code: '42501' };
    await expect(listProposedEmployeeLinks()).rejects.toMatchObject({ message: 'denied', code: '42501' });
  });
});

describe('confirmEmployeeLink — Admin-only, propose-never-self-confirm (OQ-TSP-10(C))', () => {
  it('calls the confirm_erp_employee_link RPC with the erp employee id + the confirming profile id', async () => {
    await confirmEmployeeLink('emp-1', 'profile-1');
    expect(h.calls.rpc[0][0]).toBe('confirm_erp_employee_link');
    expect(h.calls.rpc[0][1]).toMatchObject({ p_erp_employee_id: 'emp-1', p_profile_id: 'profile-1' });
  });

  it('classifies an RPC error as an AppError (e.g. a non-Admin caller, 42501)', async () => {
    h.state.rpcError = { message: 'not authorized', code: '42501' };
    await expect(confirmEmployeeLink('emp-1', 'profile-1')).rejects.toMatchObject({
      message: 'not authorized',
      code: '42501',
    });
  });
});
