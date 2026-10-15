import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';
import type { SupabaseClient } from '@supabase/supabase-js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const VERSION = '00000000-0000-4000-8000-000000000016';
const ORG = '00000000-0000-4000-8000-000000000017';

type Call = { table: string; op: string; filters: Array<[string, unknown]>; payload?: Record<string, unknown> };
function fakeClient(rowsByTable: Record<string, Record<string, unknown>[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      let op = 'select';
      let payload: Record<string, unknown> | undefined;
      const filters: Array<[string, unknown]> = [];
      const q = {
        select: () => q,
        update: (value: Record<string, unknown>) => { op = 'update'; payload = value; return q; },
        insert: (value: Record<string, unknown>) => { op = 'insert'; payload = value; return q; },
        eq: (column: string, value: unknown) => { filters.push([column, value]); return q; },
        is: (column: string, value: unknown) => { filters.push([column, value]); return q; },
        in: () => q,
        contains: () => q,
        limit: async () => { calls.push({ table, op, filters: [...filters], payload }); return { data: [], error: null }; },
        maybeSingle: async () => {
          calls.push({ table, op, filters: [...filters], payload });
          return { data: rowsByTable[table]?.[0] ?? null, error: null };
        },
        then: (resolve: (value: unknown) => void) => {
          calls.push({ table, op, filters: [...filters], payload });
          resolve({ data: [], error: null });
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

Deno.test('Desk cancellation of one account scopes tombstone to its v16 mirror grain', async () => {
  const { client, calls } = fakeClient({});
  const deps = createErpFeedDeps(client, ORG, 'budget');
  await deps.tombstoneMirror(budgetAccountIdentity(VERSION, '2026', 'Salary'), '2026-10-15T10:00:00Z');
  const update = calls.find((call) => call.op === 'update' && call.table === 'budget_version_account_erp_mirror');
  assert(!!update, 'v16 identity must update the companion mirror');
  assert(update!.filters.some(([key, val]) => key === 'fiscal_year' && val === '2026'), 'must scope fiscal year');
  assert(update!.filters.some(([key, val]) => key === 'erp_account' && val === 'Salary'), 'must scope account');
  assert(typeof update!.payload!.erp_cancelled_at === 'string' && update!.payload!.erp_cancelled_at !== '' &&
    update!.payload!.erp_docstatus === 2, 'the Desk cancel must tombstone its own row');
  assert(update!.payload!.push_state === 'failed', 'the Desk cancel must reopen only its own row to failed');
  assert(!calls.some((call) => call.op === 'update' && call.filters.some(([key, val]) => key === 'erp_account' && val !== 'Salary')),
    'a sibling account (COGS) on the same version/year is never touched by the cancel');
  assert(!calls.some((call) => call.op === 'update' && call.table === 'budget_version_erp_mirror'), 'must not touch legacy mirror');
});

Deno.test('a Desk amend repoints only the amended account and retains its tombstone column', async () => {
  const { client, calls } = fakeClient({});
  const deps = createErpFeedDeps(client, ORG, 'budget');
  const identity = budgetAccountIdentity(VERSION, '2026', 'Salary');
  await deps.repointExternalRef('budget', identity, 'ERP-BUDGET-NEW');
  await deps.stampAmended(identity, 'ERP-BUDGET-OLD', '2026-10-16T09:00:00Z');
  const refUpdate = calls.find((call) => call.table === 'external_refs' && call.op === 'update');
  assert(!!refUpdate, 'the Desk amend must repoint the external ref');
  assert(refUpdate!.filters.some(([key, val]) => key === 'pmo_record_id' && val === identity),
    'the ref repoint keys the FULL account identity, never a sibling account');
  const mirrorUpdate = calls.find((call) => call.table === 'budget_version_account_erp_mirror' && call.op === 'update');
  assert(!!mirrorUpdate, 'the amend stamp must reach the companion mirror');
  assert(mirrorUpdate!.filters.some(([key, val]) => key === 'erp_account' && val === 'Salary') &&
    mirrorUpdate!.filters.some(([key, val]) => key === 'fiscal_year' && val === '2026'),
    'the amend stamp is scoped to its account grain');
  assert(!('erp_cancelled_at' in (mirrorUpdate!.payload ?? {})), 'the amend must never write (clear) the tombstone column');
  assert(!calls.some((call) => call.op === 'update' && call.table === 'budget_version_erp_mirror'),
    'the v16 amend must not fall through to the legacy mirror');
});

Deno.test('an inbound cancellation preserves an already-pushed intentional remove tombstone', async () => {
  const { client, calls } = fakeClient({
    budget_version_account_erp_mirror: [{ budget_intent: 'remove', push_state: 'pushed', erp_docstatus: 2 }],
  });
  const deps = createErpFeedDeps(client, ORG, 'budget');
  await deps.tombstoneMirror(budgetAccountIdentity(VERSION, '2026', 'Salary'), '2026-10-15T10:00:00Z');
  assert(!calls.some((call) => call.op === 'update'), 'the feed must not reclassify intentional removal as Desk cancel');
});
