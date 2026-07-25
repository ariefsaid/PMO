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

import {
  listReopenableApprovedTimesheets,
  NON_TERMINAL_PUSH_COMMAND_STATES,
  REOPENABLE_WINDOW_DAYS,
  REOPENABLE_PAGE_LIMIT,
} from './timesheetTransition';

interface Call { table: string; filters: Array<{ op: string; args: unknown[] }> }

/** A recording fake of the two queries this DAL fn issues, keyed by table name. */
function fakeSupabase(byTable: Record<string, { data: unknown; error: unknown }>) {
  const calls: Call[] = [];
  mockFrom.mockImplementation((table: string) => {
    const call: Call = { table, filters: [] };
    calls.push(call);
    const resolved = byTable[table] ?? { data: [], error: null };
    const builder: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'neq', 'in', 'order', 'is', 'gte', 'limit']) {
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

/**
 * ⚑ S4 (Luna FU-1a round-8) — THE RE-OPEN SURFACE WAS AN UNBOUNDED, NEVER-SHRINKING QUERY ON A HOT PAGE.
 *
 * It selected EVERY Approved timesheet in the org that isn't the viewer's — entries + mirror joined, no
 * `limit`, no date bound — and then fed every id into `.in('pmo_record_id', ids)`. Approved sheets
 * accumulate forever and Admin/Exec/PM/Finance see all of them under `timesheets_select`, so at 200 staff
 * × 5 years this is ~50k rows per Approvals page view plus a PostgREST `in` list long enough to hit URL
 * limits. The index support is fine (`timesheets_org_status_week_idx` covers status + week_start_date
 * DESC); what was missing was a bound. A correction window is also the honest UX: nobody re-opens a
 * two-year-old approved week from this section.
 */
describe('S4: the re-openable query is bounded', () => {
  it('S4: the Approved read is bounded by a correction window AND a page limit — it cannot grow with the org\'s history', async () => {
    const calls = fakeSupabase({
      timesheets: { data: [approvedSheet('ts-1')], error: null },
      external_command_outbox: { data: [], error: null },
    });

    await listReopenableApprovedTimesheets('self-id');

    const sheets = calls.find((c) => c.table === 'timesheets')!;
    const gte = sheets.filters.find((f) => f.op === 'gte');
    expect(gte, 'the Approved read must carry a week_start_date lower bound').toBeDefined();
    expect(gte!.args[0]).toBe('week_start_date');
    // The bound is REOPENABLE_WINDOW_DAYS back from today, as a date string the DB column compares on.
    const expected = new Date(Date.now() - REOPENABLE_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(gte!.args[1]).toBe(expected);
    expect(sheets.filters).toContainEqual({ op: 'limit', args: [REOPENABLE_PAGE_LIMIT] });
  });

  it('S4: the `in` list the outbox read builds is therefore bounded by construction — it can never exceed one page of ids', async () => {
    const many = Array.from({ length: REOPENABLE_PAGE_LIMIT }, (_, i) => approvedSheet(`ts-${i}`));
    const calls = fakeSupabase({
      timesheets: { data: many, error: null },
      external_command_outbox: { data: [], error: null },
    });

    await listReopenableApprovedTimesheets('self-id');

    const inFilter = calls
      .find((c) => c.table === 'external_command_outbox')!
      .filters.find((f) => f.op === 'in' && f.args[0] === 'pmo_record_id')!;
    expect((inFilter.args[1] as string[]).length).toBeLessThanOrEqual(REOPENABLE_PAGE_LIMIT);
  });
});

describe('round-8 BLOCK: the surface reads the unknown-ERP-outcome witness', () => {
  it('round-8: the mirror slice carries `post_submit_unknown_at`, so the surface can say WHY a week cannot be re-opened instead of offering a button the server will refuse', async () => {
    const calls = fakeSupabase({
      timesheets: {
        data: [{ ...approvedSheet('ts-unknown'), mirror: { ts_number: null, push_state: 'failed', erp_cancelled_at: null, post_submit_unknown_at: '2026-07-01T00:00:00Z' } }],
        error: null,
      },
      external_command_outbox: { data: [], error: null },
    });

    const [row] = await listReopenableApprovedTimesheets('self-id');

    const select = calls.find((c) => c.table === 'timesheets')!.filters.find((f) => f.op === 'select')!;
    expect(String(select.args[0])).toContain('post_submit_unknown_at');
    expect(row.mirror?.post_submit_unknown_at).toBe('2026-07-01T00:00:00Z');
  });
});
