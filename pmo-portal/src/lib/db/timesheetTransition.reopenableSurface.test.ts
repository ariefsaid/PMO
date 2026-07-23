/**
 * SHOULD-FIX 4 (Luna code review) — THE RE-OPENABLE SURFACE MUST NOT LIE.
 *
 * `listReopenableApprovedTimesheets` read only `timesheet_erp_mirror`. But the mirror row is written by
 * `adapter-dispatch` AFTER the ERP call settles, so every genuinely in-flight push — the `pending`
 * outbox row a queued push will claim, the `committing` row a worker is inside RIGHT NOW, the
 * `committed` row whose mirror finalize has not run — comes back as `mirror: null`, i.e. as
 * "re-openable". The operator is shown an active button for a week the server will refuse, and learns
 * why only by clicking it. (Worse, the mirror states the old surface classified on — `pending` /
 * `pushing` — are produced by NO shipped writer: the writers only ever write `pushed`, `failed` or
 * `held`. It classified on states that cannot occur and missed the ones that do.)
 *
 * The honest source is the SAME evidence `transition_timesheet`'s precondition uses: a non-terminal
 * `external_command_outbox` row for the sheet. `external_command_outbox_select` (migration 0096)
 * ALREADY grants an active org member that read — no RLS is widened here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));

vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}));

import { listReopenableApprovedTimesheets, NON_TERMINAL_PUSH_COMMAND_STATES } from './timesheetTransition';

interface Call { table: string; filters: Array<{ op: string; args: unknown[] }> }

/** A recording fake of the two queries this DAL fn issues, keyed by table name. */
function fakeSupabase(byTable: Record<string, { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  mockFrom.mockImplementation((table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const resolved = byTable[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'neq', 'in', 'order', 'is']) {
      builder[op] = (...args: unknown[]) => {
        call.filters.push({ op, args });
        return builder;
      };
    }
    builder.then = (resolve: (v: typeof resolved) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(resolved).then(resolve, reject);
    return builder;
  });
  return calls;
}

const approvedSheet = (id: string) => ({
  id,
  user_id: 'other-user',
  week_start_date: '2026-07-13',
  status: 'Approved',
  entries: [{ id: `${id}-e`, hours: '8.00', project: { name: 'A', code: 'A1' } }],
  owner: { full_name: 'Owner O' },
  mirror: null,
});

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('SHOULD-FIX 4: listReopenableApprovedTimesheets classifies the real push-command state', () => {
  it('SHOULD-FIX 4: a sheet with a `pending` outbox row (mirror still null) is reported as having a push command in flight — never as re-openable', async () => {
    fakeSupabase({
      timesheets: { data: [approvedSheet('ts-queued')], error: null },
      external_command_outbox: { data: [{ pmo_record_id: 'ts-queued', state: 'pending' }], error: null },
    });

    const [row] = await listReopenableApprovedTimesheets('self-id');

    expect(row.mirror).toBeNull();
    expect(row.pushCommandState).toBe('pending');
  });

  it('SHOULD-FIX 4: `committing` and `committed` (a POST in flight / an ERP doc whose mirror has not landed) are reported too — these are the states the mirror cannot show', async () => {
    fakeSupabase({
      timesheets: { data: [approvedSheet('ts-a'), approvedSheet('ts-b'), approvedSheet('ts-c')], error: null },
      external_command_outbox: {
        data: [
          { pmo_record_id: 'ts-a', state: 'committing' },
          { pmo_record_id: 'ts-b', state: 'committed' },
        ],
        error: null,
      },
    });

    const rows = await listReopenableApprovedTimesheets('self-id');

    expect(rows.map((r) => r.pushCommandState)).toEqual(['committing', 'committed', null]);
  });

  it('SHOULD-FIX 4: the outbox read is scoped to the timesheets domain, this page\'s sheets, and the NON-TERMINAL states — the same evidence the RPC\'s precondition uses (no org_id sent, no RLS widened)', async () => {
    const calls = fakeSupabase({
      timesheets: { data: [approvedSheet('ts-1')], error: null },
      external_command_outbox: { data: [], error: null },
    });

    await listReopenableApprovedTimesheets('self-id');

    const outbox = calls.find((c) => c.table === 'external_command_outbox');
    expect(outbox).toBeDefined();
    expect(outbox!.filters).toContainEqual({ op: 'eq', args: ['domain', 'timesheets'] });
    expect(outbox!.filters).toContainEqual({ op: 'in', args: ['pmo_record_id', ['ts-1']] });
    expect(outbox!.filters).toContainEqual({ op: 'in', args: ['state', NON_TERMINAL_PUSH_COMMAND_STATES] });
    // `failed` is TERMINAL for the precondition (a rejected push minted no document) — Slice A admits
    // a re-open over it, so it must never be treated as in-flight by the surface either.
    expect(NON_TERMINAL_PUSH_COMMAND_STATES).not.toContain('failed');
    expect(JSON.stringify(calls)).not.toContain('org_id');
  });

  it('SHOULD-FIX 4: with no Approved sheets at all the outbox is never queried (no `in ()` round trip)', async () => {
    const calls = fakeSupabase({ timesheets: { data: [], error: null } });
    expect(await listReopenableApprovedTimesheets('self-id')).toEqual([]);
    expect(calls.some((c) => c.table === 'external_command_outbox')).toBe(false);
  });

  it('SHOULD-FIX 4: an outbox read error FAILS the query — a surface that cannot see push state must not claim everything is re-openable', async () => {
    fakeSupabase({
      timesheets: { data: [approvedSheet('ts-1')], error: null },
      external_command_outbox: { data: null, error: { message: 'permission denied' } },
    });
    await expect(listReopenableApprovedTimesheets('self-id')).rejects.toThrow('permission denied');
  });
});
