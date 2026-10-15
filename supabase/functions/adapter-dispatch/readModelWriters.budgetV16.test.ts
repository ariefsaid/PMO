import { assertEquals } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';
import { budgetAccountIdentity } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/budgetAccountIdentity.ts';

const VERSION = '44444444-4444-4444-8444-444444444444';
const account = 'COGS';
const identity = budgetAccountIdentity(VERSION, '2026', account);

function fixture(existing: unknown = null) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const client = {
    from(table: string) {
      return {
        upsert: async (...args: unknown[]) => { calls.push({ table, method: 'upsert', args }); return { error: null }; },
        select: (columns: string) => {
          calls.push({ table, method: 'select', args: [columns] });
          const chain = {
            eq(column: string, value: string) { calls.push({ table, method: 'eq', args: [column, value] }); return chain; },
            maybeSingle: async () => ({ data: existing, error: null }),
          };
          return chain;
        },
      };
    },
  };
  return { client, calls };
}

function command(intent: 'ensure' | 'remove' = 'ensure') {
  return { domain: 'budget', operation: 'create' as const, record: {
    id: VERSION, erp_doc_kind: 'budget', outbox_identity: identity,
    erp_account: account, budget_intent: intent,
    project_start_date: '2026-01-01', project_end_date: '2026-12-31',
    activated_at: '2026-01-01T00:00:00Z',
  } };
}

Deno.test('v16 budget writer scopes successful account rows and preserves replay tombstones', async () => {
  const writer = getReadModelWriter('budget');
  const fresh = fixture();
  await writer.upsert({ serviceClient: fresh.client as never, orgId: 'org-1' }, {
    id: VERSION, fiscal_year: '2026', erp_account: account, erp_budget_name: 'ERP-BUDGET', erp_docstatus: 1,
  }, command());
  const upsert = fresh.calls.find((call) => call.method === 'upsert')!;
  assertEquals(upsert.table, 'budget_version_account_erp_mirror');
  assertEquals((upsert.args[0] as Record<string, unknown>).erp_account, account);
  assertEquals((upsert.args[0] as Record<string, unknown>).budget_intent, 'ensure');
  assertEquals((upsert.args[1] as { onConflict: string }).onConflict, 'org_id,budget_version_id,fiscal_year,erp_account');

  const replay = fixture({ erp_cancelled_at: '2026-02-01T00:00:00Z' });
  await writer.upsert({ serviceClient: replay.client as never, orgId: 'org-1', isReplay: true }, {
    id: VERSION, fiscal_year: '2026', erp_account: account,
  }, command());
  assertEquals(replay.calls.filter((call) => call.method === 'upsert').length, 0);
});

Deno.test('v16 budget writer records a successful removal as a pushed account tombstone', async () => {
  const { client, calls } = fixture();
  await getReadModelWriter('budget').upsert({ serviceClient: client as never, orgId: 'org-1' }, {
    id: VERSION, fiscal_year: '2026', erp_account: account, erp_budget_name: 'ERP-BUDGET', erp_docstatus: 2,
  }, command('remove'));
  const row = calls.find((call) => call.method === 'upsert')!.args[0] as Record<string, unknown>;
  assertEquals(row.push_state, 'pushed');
  assertEquals(row.erp_docstatus, 2);
  assertEquals(row.budget_intent, 'remove');
  assertEquals(typeof row.erp_cancelled_at, 'string');
});
