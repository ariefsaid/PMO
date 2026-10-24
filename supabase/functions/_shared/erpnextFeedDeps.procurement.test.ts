// [Deno] — a native ERPNext purchase document (Purchase Invoice, Payment Entry, Purchase Order, Purchase Receipt) the
// sweep cannot adopt (the PMO purchase link is dispatch-owned) leaves NO external_refs claim behind. Before 0378 the
// claim-first adopt wrote a procurement reference for a fresh id, then the mint refused: the reference pointed at
// nothing and made the document look recorded by PMO (it vanished from the unlinked list; link/set-aside refused).
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared/erpnextFeedDeps.procurement.test.ts --config deno.json --allow-env --allow-net --allow-read
import { createErpFeedDeps } from './erpnextFeedDeps.ts';
import { applyErpFeedEvent } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/applyFeed.ts';
import { terminalApplyReason } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/feedErrorPolicy.ts';

/** Local deep-equality assert: the erpnext-sweep import map (which runs `_shared` tests) carries no @std/assert. */
function assertEquals(actual: unknown, expected: unknown, msg = ''): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\nexpected ${e}\n     got ${a}`);
}

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
    chain.maybeSingle = () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
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
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { client, calls };
}

const writes = (calls: Call[]) => calls.filter((c) => c.op === 'insert' || c.op === 'upsert');

for (const [kind, name] of [
  ['purchase-invoice', 'ACC-PINV-2026-00055'],
  ['payment', 'ACC-PAY-2026-00042'],
  ['purchase-order', 'PUR-ORD-2026-00001'],
  ['goods-receipt', 'MAT-PRE-2026-00001'],
] as const) {
  Deno.test(`a native ${kind} the sweep cannot adopt writes no external ref and no mirror row`, async () => {
    const f = fakeClient({});
    const deps = createErpFeedDeps(f.client as never, 'org-1', kind);
    let code: string | undefined;
    try {
      await applyErpFeedEvent({ tier: 'erpnext', domain: 'procurement' }, name, { id: name, erp_docstatus: 1 }, Date.now(), deps);
    } catch (err) {
      code = (err as { code?: string }).code;
    }
    assertEquals(code, 'procurement-inbound-adopt-no-case-link');
    assertEquals(terminalApplyReason({ code }), 'procurement-inbound-adopt-no-case-link');
    assertEquals(writes(f.calls).length, 0, JSON.stringify(writes(f.calls)));
    assertEquals('adoptAtomically' in deps, false, 'no claim-first strategy for a kind whose adopt always refuses');
  });
}
