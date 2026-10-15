(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { budgetBackstopDepsLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import { reconcileOrgBudgetPushes } from './budgetBackstop.ts';

function assert(condition: boolean, message: string): void { if (!condition) throw new Error(message); }
const ORG = '00000000-0000-4000-8000-000000000017';
const VERSION = '00000000-0000-4000-8000-000000000016';
const BINDING = { orgId: ORG, siteUrl: 'https://erp.example.test', secretRef: 'bv16-backstop', company: 'Test Co', config: {}, ownedDomains: ['budget'], versionMajor: 16 };

function db(fixtures: Record<string, Record<string, unknown>[]>) {
  const requested: string[] = [];
  const writes: Array<{ table: string; op: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const client = {
    from(table: string) {
      requested.push(table);
      const filters: Array<[string, unknown]> = [];
      let limit = Number.MAX_SAFE_INTEGER;
      let op = 'select';
      let payload: Record<string, unknown> = {};
      const q = {
        select: () => q,
        insert: (value: Record<string, unknown>) => { op = 'insert'; payload = value; return q; },
        update: (value: Record<string, unknown>) => { op = 'update'; payload = value; return q; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
        in: () => q, is: () => q, order: () => q, contains: () => q,
        limit: (value: number) => { limit = value; return q; },
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (value: unknown) => void) => {
          const rows = (fixtures[table] ?? []).filter((row) => filters.every(([key, value]) => key === 'org_id' || row[key] === value)).slice(0, limit);
          if (op !== 'select') writes.push({ table, op, payload, filters: [...filters] });
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
