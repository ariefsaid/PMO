(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { budgetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { budgetAccountIdentity, budgetAccountPushKey } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { reconcileOrgBudgetPushes } from './budgetBackstop.ts';

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const ORG = '00000000-0000-4000-8000-000000000017';
const VERSION = '00000000-0000-4000-8000-000000000016';
const BINDING = { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'bv16-backstop', company: 'Test Co', config: {}, ownedDomains: ['budget'], versionMajor: 16 };

function db(fixtures: Record<string, Record<string, unknown>[]>) {
  const requested: string[] = [];
  const writes: Array<{ table: string; op: string; payload: Record<string, unknown>; eq: Array<[string, unknown]>; in: Array<[string, unknown[]]>; is: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      requested.push(table);
      const eq: Array<[string, unknown]> = [];
      const inFilters: Array<[string, unknown[]]> = [];
      const isFilters: Array<[string, unknown]> = [];
      let limit = Number.MAX_SAFE_INTEGER;
      let op = 'select';
      let payload: Record<string, unknown> = {};
      const q = {
        select: () => q,
        insert: (value: Record<string, unknown>) => { op = 'insert'; payload = value; return q; },
        update: (value: Record<string, unknown>) => { op = 'update'; payload = value; return q; },
        eq: (key: string, value: unknown) => { eq.push([key, value]); return q; },
        in: (key: string, value: unknown[]) => { inFilters.push([key, value]); return q; },
        is: (key: string, value: unknown) => { isFilters.push([key, value]); return q; },
        order: () => q, contains: () => q,
        limit: (value: number) => { limit = value; return q; },
        maybeSingle: async () => ({ data: fixtures[table]?.[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => void) => {
          const rows = (fixtures[table] ?? [])
            .filter((row) => eq.every(([key, value]) => key === 'org_id' || row[key] === value))
            .filter((row) => inFilters.every(([key, values]) => values.includes(row[key])))
            .filter((row) => isFilters.every(([key, value]) => row[key] === value))
            .slice(0, limit);
          if (op !== 'select') writes.push({ table, op, payload, eq: [...eq], in: inFilters.map(([k, v]) => [k, v] as [string, unknown[]]), is: [...isFilters] });
          resolve({ data: rows, error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, requested, writes };
}

Deno.test('AC-BV16-004 Salary mirror does not suppress COGS orphan; account and year remain distinct', async () => {
  const salary = { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', push_state: 'failed', erp_cancelled_at: null, created_at: '2026-10-15T10:00:00Z', id: 'salary-row' };
  const cogsIdentity = budgetAccountIdentity(VERSION, '2026', 'COGS');
  const { client, requested } = db({ budget_version_account_erp_mirror: [salary] });
  const deps = budgetBackstopDepsLive(client, BINDING, [{ id: 'outbox-cogs', pmo_record_id: cogsIdentity, fiscal_year: '2026' }]);
  const rows = await deps.listPendingBudgetPushes(ORG, 200);
  assert(requested.includes('budget_version_account_erp_mirror'), 'v16 candidates must read the companion table');
  assert(rows.length === 2, `Salary history and distinct COGS orphan must coexist: ${JSON.stringify(rows)}`);
  assert(rows.some((row) => row.erp_account === 'COGS' && row.fiscal_year === '2026'), `COGS must survive dedup: ${JSON.stringify(rows)}`);
  assert(rows.some((row) => row.erp_account === 'Salary'), 'Salary mirror row must retain its account grain');
});

Deno.test('an exhausted v16 account is held only in its exact account mirror row', async () => {
  const { client, writes } = db({});
  const deps = budgetBackstopDepsLive(client, BINDING, []);
  await deps.driveBudgetPush({ budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', budget_intent: 'ensure', push_state: 'absent' },
    { id: VERSION, status: 'Active', activated_at: '2026-10-15T10:00:00Z' });
  const held = writes.find((write) => write.op === 'insert' || write.op === 'update');
  if (!held || held.table !== 'budget_version_account_erp_mirror') throw new Error(`v16 hold must write companion mirror: ${JSON.stringify(writes)}`);
  assert(held.payload.erp_account === 'Salary' && held.payload.fiscal_year === '2026', `hold must preserve account/year: ${JSON.stringify(held)}`);
});

Deno.test('AC-BV16-004 identical accounts in two fiscal years never collide in the combined queue', async () => {
  const salary2026 = { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', push_state: 'failed', erp_cancelled_at: null, created_at: '2026-10-15T10:00:00Z', id: 'row-2026' };
  const identity2027 = budgetAccountIdentity(VERSION, '2027', 'Salary');
  const { client } = db({ budget_version_account_erp_mirror: [salary2026] });
  const rows = await budgetBackstopDepsLive(client, BINDING, [{ id: 'outbox-2027', pmo_record_id: identity2027, fiscal_year: '2027' }])
    .listPendingBudgetPushes(ORG, 200);
  assert(rows.some((row) => row.fiscal_year === '2026' && row.erp_account === 'Salary'), `the 2026 mirror row must stay queued: ${JSON.stringify(rows)}`);
  assert(rows.some((row) => row.fiscal_year === '2027' && row.erp_account === 'Salary'),
    'the 2027 orphan must not be suppressed by the 2026 mirror (dedup is year- and account-grained)');
});

Deno.test('AC-BV16-004 an attempts-exhausted hold is a CAS on its own grain that cannot overwrite a foreground success', async () => {
  const identity = budgetAccountIdentity(VERSION, '2026', 'Salary');
  const exhausted = { id: 'outbox-salary', domain: 'budget', pmo_record_id: identity, idempotency_key: budgetAccountPushKey(identity, '2026-10-15T10:00:00Z'), state: 'failed', external_record_id: null, canonical: null, claim_generation: 0, payload_digest: null };
  const salary = { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', push_state: 'failed', erp_cancelled_at: null, created_at: '2026-10-15T10:00:00Z', id: 'salary-row' };
  const { client, writes } = db({ external_command_outbox: [exhausted], budget_version_account_erp_mirror: [salary] });
  await budgetBackstopDepsLive(client, BINDING, []).driveBudgetPush(
    { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', budget_intent: 'ensure', push_state: 'failed' },
    { id: VERSION, status: 'Active', activated_at: '2026-10-15T10:00:00Z' });
  const hold = writes.find((write) => write.op === 'update' && write.table === 'budget_version_account_erp_mirror');
  assert(!!hold, `an existing exhausted account must be held by UPDATE, never re-inserted: ${JSON.stringify(writes)}`);
  assert(hold!.payload.push_state === 'held' && hold!.payload.push_error === 'budget-push-attempts-exhausted',
    `the hold records the exhaustion reason: ${JSON.stringify(hold)}`);
  assert(hold!.eq.some(([key, value]) => key === 'erp_account' && value === 'Salary') && hold!.eq.some(([key, value]) => key === 'fiscal_year' && value === '2026'),
    'the hold CAS keys its exact account/year grain');
  assert(hold!.in.some(([key, values]) => key === 'push_state' && JSON.stringify(values) === JSON.stringify(['pending', 'failed'])),
    'the hold CAS repeats the queue eligibility, so a foreground `pushed` row can never be overwritten');
  assert(hold!.is.some(([key, value]) => key === 'erp_cancelled_at' && value === null),
    'the hold CAS never relabels a Desk tombstone');
});

Deno.test('AC-BV16-004 a Desk-tombstoned account row is never queued for the backstop', async () => {
  const tombstoned = { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', push_state: 'pushed', erp_cancelled_at: '2026-10-16T00:00:00Z', created_at: '2026-10-15T10:00:00Z', id: 'salary-row' };
  const { client } = db({ budget_version_account_erp_mirror: [tombstoned] });
  const rows = await budgetBackstopDepsLive(client, BINDING, []).listPendingBudgetPushes(ORG, 200);
  assert(!rows.some((row) => row.erp_account === 'Salary'), `a Desk-cancelled account must never be re-driven: ${JSON.stringify(rows)}`);
});

Deno.test('the bounded combined queue is stable and one account failure does not starve a later account', async () => {
  const legacy = Array.from({ length: 205 }, (_, index) => ({
    id: `l${String(index).padStart(3, '0')}`, budget_version_id: VERSION, fiscal_year: '2026',
    push_state: 'failed', erp_cancelled_at: null, created_at: new Date(index * 1000).toISOString(),
  }));
  const accounts = Array.from({ length: 205 }, (_, index) => ({
    id: `a${String(index).padStart(3, '0')}`, budget_version_id: VERSION, fiscal_year: '2026',
    erp_account: `Account-${index}`, budget_intent: 'ensure', push_state: 'pending', erp_cancelled_at: null,
    created_at: new Date(index * 1000 + 500).toISOString(),
  }));
  const { client } = db({ budget_version_erp_mirror: legacy, budget_version_account_erp_mirror: accounts });
  const candidates = await budgetBackstopDepsLive(client, BINDING, []).listPendingBudgetPushes(ORG, 200);
  assert(candidates.length === 200, `combined queue must honor its shared 200-row cap: ${candidates.length}`);
  const timestamps = candidates.map((row) => row.created_at ?? '');
  assert(timestamps.every((value, index) => index === 0 || timestamps[index - 1] <= value), 'combined queue order must be stable by creation time/id');

  const driven: string[] = [];
  const outcome = await reconcileOrgBudgetPushes({
    listPendingBudgetPushes: async () => [
      { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'Salary', push_state: 'failed' },
      { budget_version_id: VERSION, fiscal_year: '2026', erp_account: 'COGS', push_state: 'failed' },
    ],
    readBudgetVersion: async () => ({ id: VERSION, status: 'Active', activated_at: '2026-10-15T10:00:00Z' }),
    driveBudgetPush: async (row) => { if (row.erp_account === 'Salary') throw new Error('synthetic failure'); driven.push(String(row.erp_account)); },
  }, { orgId: ORG });
  assert(outcome.errors.length === 1 && driven.join() === 'COGS', 'later account must run after one account throws');
});
