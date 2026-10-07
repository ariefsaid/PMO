// AC-EXP-126 [Deno] — the expense kinds are lifecycle-only inbound (FR-EXP-113): a native ERP document is never
// adopted (no mirror row, no external_refs claim); a cancel of a posted approval raises a notice unless PMO's own
// approval-cancel did it. Lookups key on the side mirror's posting_identity, never its own uuid.
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared/erpnextFeedDeps.expenses.test.ts --config deno.json --allow-env --allow-net --allow-read
import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { terminalApplyReason } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts';

/** Local deep-equality assert: the erpnext-sweep import map (which runs `_shared` tests) carries no @std/assert. */
function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

const CLAIM = '0b7a8c2e-1111-4222-8333-444455556666';

interface Call {
  table: string;
  op: string;
  payload?: unknown;
  filters: Array<[string, unknown]>;
}

function fakeClient(rows: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const builder = (table: string, op: string, payload?: unknown) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const m of ['is', 'in', 'contains', 'limit', 'order', 'select']) chain[m] = () => chain;
    chain.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    };
    chain.maybeSingle = async () => ({ data: (rows[table] ?? [])[0] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: op === 'select' ? (rows[table] ?? []) : null, error: null }).then(resolve);
    return chain;
  };
  const client = {
    from: (table: string) => ({
      select: () => builder(table, 'select'),
      insert: (p: unknown) => builder(table, 'insert', p),
      update: (p: unknown) => builder(table, 'update', p),
      upsert: (p: unknown) => builder(table, 'upsert', p),
    }),
    rpc: async () => ({ data: null, error: null }),
  };
  return { client, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => c.op === 'insert' || c.op === 'upsert');

for (const kind of ['expense-journal', 'expense-payment', 'expense-receipt'] as const) {
  Deno.test(`AC-EXP-126 a native ${kind} document is not adopted: no claim strategy, a terminal code, no writes`, async () => {
    const f = fakeClient({});
    const deps = createErpFeedDeps(f.client as never, 'org-1', kind);
    assertEquals('adoptAtomically' in deps, false);
    let code: string | undefined;
    try {
      await deps.mintMirror({ id: 'ACC-JV-2026-00099' } as never, Date.now());
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    assertEquals(code, 'native-expense-posting-not-adopted');
    assertEquals(terminalApplyReason({ code }), 'native-expense-posting-not-adopted');
    assertEquals(writes(f.calls).length, 0);
  });
}

Deno.test('AC-EXP-126 through the feed engine, an unmapped Journal Entry claims no external ref and mints nothing', async () => {
  const f = fakeClient({});
  let code: string | undefined;
  try {
    await applyErpFeedEvent({ tier: 'erpnext', domain: 'expenses' }, 'ACC-JV-2026-00099',
      { id: 'ACC-JV-2026-00099', erp_docstatus: 1, user_remark: 'payroll accrual' }, Date.now(),
      createErpFeedDeps(f.client as never, 'org-1', 'expense-journal'));
  } catch (err) {
    code = (err as { code?: string }).code;
  }
  assertEquals(code, 'native-expense-posting-not-adopted');
  assertEquals(writes(f.calls).length, 0, JSON.stringify(writes(f.calls)));
  assertEquals(f.calls.some((c) => c.table === 'notifications'), false);
});

Deno.test('AC-EXP-126 a mapped posting is updated through posting_identity, never the mirror id', async () => {
  const f = fakeClient({});
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-journal')
    .updateMirror(`${CLAIM}:approval`, { id: 'ACC-JV-2026-00002', erp_docstatus: 1 } as never, Date.parse('2026-10-08T10:00:00Z'));
  const update = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'update');
  assertEquals(update?.filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
  assertEquals((update?.payload as Record<string, unknown>).erp_docstatus, 1);
  // A live docstatus never clears a tombstone on a PMO-SoT side mirror (the never-re-drive exclusion).
  assertEquals('erp_cancelled_at' in (update?.payload as Record<string, unknown>), false);
});

Deno.test('AC-EXP-126 PMO\'s own cancel of an approval raises no notice', async () => {
  const f = fakeClient({ expense_posting_erp_mirror: [{ id: 'cancel-intent' }], profiles: [{ id: 'admin-1' }] });
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-journal').tombstoneMirror(`${CLAIM}:approval`, '2026-10-08 10:00:00');
  const tombstone = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'update');
  assertEquals(tombstone?.filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval`]]);
  const probe = f.calls.find((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'select');
  assertEquals(probe?.filters, [['org_id', 'org-1'], ['posting_identity', `${CLAIM}:approval-cancel`]]);
  assertEquals(f.calls.some((c) => c.table === 'notifications' && c.op === 'insert'), false);
});

Deno.test('AC-EXP-126 a desk cancel of a posted approval raises expense-posting-desk-cancelled', async () => {
  const f = fakeClient({ profiles: [{ id: 'admin-1' }] });
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-journal').tombstoneMirror(`${CLAIM}:approval`, '2026-10-08 10:00:00');
  const insert = f.calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assertEquals(JSON.stringify(insert?.payload ?? '').includes('expense-posting-desk-cancelled'), true);
});

Deno.test('AC-EXP-126 a desk cancel of a posted payment is always surfaced (PMO never cancels a payment)', async () => {
  // Even with a row present for the probe, a non-approval posting is never PMO's own cancel.
  const f = fakeClient({ expense_posting_erp_mirror: [{ id: 'anything' }], profiles: [{ id: 'admin-1' }] });
  await createErpFeedDeps(f.client as never, 'org-1', 'expense-payment').tombstoneMirror(`${CLAIM}:claim-payment`, '2026-10-08 10:00:00');
  assertEquals(f.calls.some((c) => c.table === 'expense_posting_erp_mirror' && c.op === 'select'), false);
  const insert = f.calls.find((c) => c.table === 'notifications' && c.op === 'insert');
  assertEquals(JSON.stringify(insert?.payload ?? '').includes('expense-posting-desk-cancelled'), true);
});
