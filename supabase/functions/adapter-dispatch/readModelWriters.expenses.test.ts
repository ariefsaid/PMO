// AC-EXP-124 [Deno] — a landed expense posting marks its intent pushed; a landed cancel also tombstones the approval.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.expenses.test.ts --config deno.json --allow-env --allow-net --allow-read
import { assertEquals, assertRejects } from '@std/assert';
import { getReadModelWriter } from './readModelWriters.ts';

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

function fake(error: { message: string; code?: string } | null = null) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; filters: Array<[string, string]> }> = [];
  const client = {
    from(table: string) {
      return {
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
        update(patch: Record<string, unknown>) {
          const entry = { table, patch, filters: [] as Array<[string, string]> };
          updates.push(entry);
          const chain = {
            eq(column: string, value: string) {
              entry.filters.push([column, value]);
              return chain;
            },
            then(resolve: (v: unknown) => unknown) {
              return Promise.resolve({ error }).then(resolve);
            },
          };
          return chain;
        },
      };
    },
    rpc: async () => ({ error: null }),
  };
  return { client, updates };
}

Deno.test('AC-EXP-124 a landed posting marks its intent pushed with the ERP name', async () => {
  const f = fake();
  await getReadModelWriter('expenses').upsert(
    { serviceClient: f.client as never, orgId: 'org-1' },
    { id: CLAIM, erp_name: 'ACC-JV-2026-00002', erp_docstatus: 1, erp_modified: 'm1' },
    {
      domain: 'expenses', operation: 'create',
      record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval` },
    },
  );
  assertEquals(f.updates.length, 1);
  assertEquals(f.updates[0].table, 'expense_posting_erp_mirror');
  assertEquals(
    [f.updates[0].patch.push_state, f.updates[0].patch.push_error, f.updates[0].patch.erp_name, f.updates[0].patch.erp_docstatus],
    ['pushed', null, 'ACC-JV-2026-00002', 1],
  );
  assertEquals(typeof f.updates[0].patch.pushed_at, 'string');
  assertEquals(f.updates[0].filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
});

Deno.test('AC-EXP-124 a landed cancel marks the cancel pushed and the approval cancelled', async () => {
  const f = fake();
  await getReadModelWriter('expenses').upsert(
    { serviceClient: f.client as never, orgId: 'org-1' },
    { id: CLAIM, erp_name: 'ACC-JV-2026-00002', erp_docstatus: 2, erp_modified: 'm2' },
    {
      domain: 'expenses', operation: 'transition',
      record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval-cancel', posting_identity: `${CLAIM}:approval-cancel` },
    },
  );
  assertEquals(f.updates.length, 2);
  assertEquals(f.updates[0].filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval-cancel`]]);
  assertEquals(f.updates[1].filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
  assertEquals(f.updates[1].patch.erp_docstatus, 2);
  assertEquals(f.updates[1].patch.erp_modified, 'm2');
  assertEquals(typeof f.updates[1].patch.erp_cancelled_at, 'string');
  // The approval keeps its own push state: only its ERP lifecycle moves.
  assertEquals('push_state' in f.updates[1].patch, false);
});

Deno.test('AC-EXP-124 a command without a posting identity throws', async () => {
  const f = fake();
  await assertRejects(() =>
    getReadModelWriter('expenses').upsert(
      { serviceClient: f.client as never, orgId: 'org-1' },
      { id: 'X' },
      { domain: 'expenses', operation: 'create', record: { id: CLAIM, erp_doc_kind: 'expense-journal' } },
    )
  );
  assertEquals(f.updates.length, 0);
});

Deno.test('AC-EXP-124 a mirror write error is raised, never swallowed', async () => {
  const f = fake({ message: 'permission denied', code: '42501' });
  await assertRejects(() =>
    getReadModelWriter('expenses').upsert(
      { serviceClient: f.client as never, orgId: 'org-1' },
      { id: CLAIM, erp_name: 'ACC-JV-2026-00002' },
      {
        domain: 'expenses', operation: 'create',
        record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval` },
      },
    ), Error, 'expense_posting_erp_mirror write failed');
});

// Found by AC-EXP-140: the adapter replaces `canonical.id` with the PMO record id (the subject uuid), so the ERP name
// travels in `erp_name`. Recording `id` stored the claim uuid as the "document" and every dependent posting then cited
// a Journal Entry that does not exist.
Deno.test('AC-EXP-124 the ERP name comes from erp_name, never from the PMO-record id; a canonical without it throws', async () => {
  const f = fake();
  await getReadModelWriter('expenses').upsert(
    { serviceClient: f.client as never, orgId: 'org-1' },
    { id: CLAIM, erp_name: 'ACC-PAY-2026-00239', erp_docstatus: 1 },
    { domain: 'expenses', operation: 'create',
      record: { id: CLAIM, erp_doc_kind: 'expense-payment', posting: 'claim-payment', posting_identity: `${CLAIM}:claim-payment` } },
  );
  assertEquals(f.updates[0].patch.erp_name, 'ACC-PAY-2026-00239');
  const g = fake();
  await assertRejects(() =>
    getReadModelWriter('expenses').upsert(
      { serviceClient: g.client as never, orgId: 'org-1' },
      { id: CLAIM, erp_docstatus: 1 },
      { domain: 'expenses', operation: 'create',
        record: { id: CLAIM, erp_doc_kind: 'expense-journal', posting: 'approval', posting_identity: `${CLAIM}:approval` } },
    ), Error, 'no ERP document name');
  assertEquals(g.updates.length, 0);
});
