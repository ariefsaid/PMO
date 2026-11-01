/**
 * THEME-BACK-06 at the live boundary: the shipped budget / timesheet queue adapters ask the database for
 * the fair order (never attempted first, then longest-waiting, then oldest) and stamp the rows they
 * selected — including rows that will be skipped or refused — leaving synthetic `absent` rows alone.
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { budgetBackstopDepsLive, timesheetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
const ORG = '00000000-0000-4000-8000-0000000000aa';
const BINDING = { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'r', company: 'Co', config: {}, ownedDomains: ['budget', 'timesheets'], versionMajor: 15 };

interface Query { table: string; orders: Array<[string, { ascending?: boolean; nullsFirst?: boolean } | undefined]>; limit: number | null; rows: Array<Record<string, unknown>> }
interface Stamp { table: string; values: Record<string, unknown>; eq: Array<[string, unknown]>; in?: [string, unknown[]] }

function fakeClient(rowsByTable: Record<string, Array<Record<string, unknown>>>) {
  const queries: Query[] = [];
  const stamps: Stamp[] = [];
  const client = {
    from(table: string) {
      const q: Query = { table, orders: [], limit: null, rows: rowsByTable[table] ?? [] };
      const stamp: Stamp = { table, values: {}, eq: [] };
      let mode: 'select' | 'update' = 'select';
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        update: (v: Record<string, unknown>) => { mode = 'update'; stamp.values = v; return b; },
        eq: (c: string, v: unknown) => { stamp.eq.push([c, v]); return b; },
        in: (c: string, vs: unknown[]) => { stamp.in = [c, vs]; return b; },
        is: () => b,
        not: () => b,
        order: (c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) => { q.orders.push([c, o]); return b; },
        limit: (n: number) => { q.limit = n; queries.push(q); return Promise.resolve({ data: q.rows, error: null }); },
        then: (resolve: (v: unknown) => void) => {
          if (mode === 'update') stamps.push(stamp);
          resolve({ data: [], error: null });
        },
      };
      return b;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
  return { client: client as unknown as SupabaseClient, queries, stamps };
}

Deno.test('the budget queue reads least-recently-attempted first and stamps the mirror rows it selected', async () => {
  const fake = fakeClient({
    budget_version_erp_mirror: [{ id: 'm1', budget_version_id: 'v1', push_state: 'pending', fiscal_year: '2026', created_at: '2026-01-01T00:00:00Z', last_attempt_at: '2026-02-01T00:00:00Z' }],
    budget_version_account_erp_mirror: [{ id: 'a1', budget_version_id: 'v2', push_state: 'failed', fiscal_year: '2026', erp_account: 'Labor', budget_intent: 'ensure', created_at: '2026-01-02T00:00:00Z', last_attempt_at: null }],
  });
  const deps = budgetBackstopDepsLive(fake.client, BINDING, [], new Set());
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(fake.queries.length === 2, 'both budget mirror queues are read');
  for (const q of fake.queries) {
    assert(q.orders[0]?.[0] === 'last_attempt_at' && q.orders[0][1]?.nullsFirst === true && q.orders[0][1].ascending === true, `ordered never-attempted first: ${JSON.stringify(q.orders)}`);
    assert(q.orders[1]?.[0] === 'created_at' && q.orders[2]?.[0] === 'id', 'then oldest, then id');
  }
  assert(rows[0]?.id === 'a1' && rows[1]?.id === 'm1', `the never-attempted row is served before the recently attempted one: ${rows.map((r) => r.id)}`);
  await deps.markAttempted!(ORG, [...rows, { id: 'o1', budget_version_id: 'v3', push_state: 'absent', erp_account: null }]);
  const byTable = Object.fromEntries(fake.stamps.map((s) => [s.table, s]));
  assert(JSON.stringify(byTable.budget_version_erp_mirror?.in) === JSON.stringify(['id', ['m1']]), 'the legacy mirror row is stamped by id');
  assert(JSON.stringify(byTable.budget_version_account_erp_mirror?.in) === JSON.stringify(['id', ['a1']]), 'the account mirror row is stamped by id');
  assert(fake.stamps.length === 2, 'an absent outbox orphan has no mirror row and is not stamped');
  for (const s of fake.stamps) {
    assert(typeof s.values.last_attempt_at === 'string', 'the stamp is a timestamp');
    assert(s.eq.some(([c, v]) => c === 'org_id' && v === ORG), 'the stamp is scoped to the org');
  }
});

Deno.test('the timesheet queue reads least-recently-attempted first and stamps mirror rows but never an absent sheet', async () => {
  const fake = fakeClient({
    timesheet_erp_mirror: [
      { id: 'x1', timesheet_id: 't1', push_state: 'failed', erp_cancelled_at: null, last_attempt_at: null },
      { id: 'x2', timesheet_id: 't2', push_state: 'pending', erp_cancelled_at: null, last_attempt_at: '2026-02-01T00:00:00Z' },
    ],
  });
  const deps = timesheetBackstopDepsLive(fake.client, BINDING, new Set(), new Set());
  const rows = await deps.listPendingTimesheetPushes(ORG, 200);
  const q = fake.queries.find((x) => x.table === 'timesheet_erp_mirror')!;
  assert(q.orders[0]?.[0] === 'last_attempt_at' && q.orders[0][1]?.nullsFirst === true, `ordered never-attempted first: ${JSON.stringify(q.orders)}`);
  await deps.markAttempted!(ORG, [...rows, { timesheet_id: 't9', push_state: 'absent' }]);
  assert(fake.stamps.length === 1 && JSON.stringify(fake.stamps[0].in) === JSON.stringify(['timesheet_id', ['t1', 't2']]), `only mirror rows are stamped: ${JSON.stringify(fake.stamps)}`);
});
