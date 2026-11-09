/**
 * D14 / FR-OLH-002 (#1510 L2) — the ERPNext timesheet backstop must not run for an org whose `timesheets` domain belongs to
 * another tier. Both queue halves ask the SAME predicate first: `listPendingTimesheetPushes` (mirror rows) and the `absent`
 * half inside it (`listApprovedSheetsWithoutMirror`, approved sheets with no mirror row at all).
 *
 * The defect this closes: the two queries filter by org and status only, so an org that employs `timesheets` under Odoo
 * while keeping an ERPNext binding for other domains would have every approved week pushed to BOTH ERPs — the same hours
 * counted twice, in two ledgers. The ownership answer is TIER-SCOPED, and an unreadable answer is treated as "not ours"
 * (fail closed: nothing is driven; the tier that owns the domain is the one that posts).
 *
 * The predicate is exported and unit-tested here; the queue halves are driven through the shipped
 * `timesheetBackstopDepsLive` so the call sites are proven wired, not just the helper.
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { timesheetBackstopDepsLive, erpnextOwnsTimesheets } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
const ORG = '00000000-0000-4000-8000-0000000000aa';
const APPROVED_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const BINDING = {
  orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'r', company: 'Co', config: {},
  ownedDomains: ['budget', 'timesheets'], versionMajor: 15, activatedAt: '2026-01-01T00:00:00Z',
};

/** A fake DB that records every table read and answers the ownership RPC with `owned`. */
function fakeDb(owned: { data: unknown; error: unknown } | 'throw') {
  const reads: string[] = [];
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const rows: Record<string, Array<Record<string, unknown>>> = {
    timesheet_erp_mirror: [
      { id: 'm1', timesheet_id: '11111111-0000-0000-0000-000000000001', push_state: 'pending', erp_cancelled_at: null, last_attempt_at: null },
    ],
    timesheets: [{ id: '22222222-0000-0000-0000-000000000002', approved_at: APPROVED_AT }],
  };
  const client = {
    from(table: string) {
      const data = rows[table] ?? [];
      // deno-lint-ignore no-explicit-any
      const b: any = {};
      for (const m of ['select', 'eq', 'in', 'is', 'gte', 'order', 'limit']) b[m] = () => b;
      b.limit = (_n: number) => { reads.push(table); return Promise.resolve({ data, error: null }); };
      b.then = (resolve: (v: unknown) => unknown) => { reads.push(table); return Promise.resolve({ data, error: null }).then(resolve); };
      return b;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'domain_owned_by_tier') {
        if (owned === 'throw') throw new TypeError('store unreachable');
        return Promise.resolve(owned);
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client: client as unknown as SupabaseClient, reads, rpcCalls };
}

Deno.test('FR-OLH-002 the predicate asks the TIER-SCOPED ownership question for this org', async () => {
  const f = fakeDb({ data: true, error: null });
  assert((await erpnextOwnsTimesheets(f.client, ORG)) === true, 'a literal true is the only yes');
  const call = f.rpcCalls.find((c) => c.fn === 'domain_owned_by_tier');
  assert(call !== undefined, 'the predicate must ask the database, never assume');
  assert(
    JSON.stringify(call!.args) === JSON.stringify({ p_org_id: ORG, p_domain: 'timesheets', p_tier: 'erpnext' }),
    `the question must be tier-scoped and org-scoped: ${JSON.stringify(call!.args)}`,
  );
});

Deno.test('FR-OLH-002 an unreadable ownership answer is NOT ownership (fail closed)', async () => {
  for (const answer of [{ data: false, error: null }, { data: null, error: null }, { data: [], error: null }, { data: 'true', error: null }, { data: true, error: { code: 'XX000', message: 'x' } }, 'throw'] as const) {
    const f = fakeDb(answer as { data: unknown; error: unknown });
    assert((await erpnextOwnsTimesheets(f.client, ORG)) === false, `only a literal true admits the backstop: ${JSON.stringify(answer)}`);
  }
});

Deno.test('FR-OLH-002 an org that employs timesheets on odoo lists NO sheet in either queue half', async () => {
  const f = fakeDb({ data: false, error: null });
  const deps = timesheetBackstopDepsLive(f.client, BINDING, new Set(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  assert(rows.length === 0, `nothing may be driven for a sheet another tier owns: ${JSON.stringify(rows)}`);
  assert(
    !f.reads.includes('timesheets') && !f.reads.includes('timesheet_erp_mirror'),
    `neither queue half may even read when the domain is not ours: ${JSON.stringify(f.reads)}`,
  );
});

Deno.test('FR-OLH-002 an org owning timesheets on erpnext is unchanged (both halves still serve their rows)', async () => {
  const f = fakeDb({ data: true, error: null });
  const deps = timesheetBackstopDepsLive(f.client, BINDING, new Set(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  assert(rows.length === 2, `the shipped fixture is served unchanged: ${JSON.stringify(rows)}`);
  assert(
    rows[0].timesheet_id === '11111111-0000-0000-0000-000000000001' && rows[0].push_state === 'pending',
    'the mirror half is byte-for-byte the shipped row',
  );
  assert(
    rows[1].timesheet_id === '22222222-0000-0000-0000-000000000002' && rows[1].push_state === 'absent',
    'the absent half is byte-for-byte the shipped row',
  );
  assert(f.reads.includes('timesheets'), 'the absent half still reads approved sheets for its owner');
});
