// Slice 5, task 5.4 — the `procurement` read-model writer's purchase-order/goods-receipt kinds.
// Deno-native test (no vitest import), matches readModelWriters.test.ts's idiom. Additive: leaves
// readModelWriters.test.ts (task 1.6, incl. its "procurement is not-yet-wired" assertion) untouched —
// that assertion still passes because a record with NO erp_doc_kind (or an un-owned one) still throws.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.poGr.test.ts

import { getReadModelWriter } from './readModelWriters.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Same fake-client shape as readModelWriters.test.ts, extended with a `select().eq().eq().eq()`
 *  chain (findPmoRecordId's 3-eq shape) keyed per table. */
function makeFakeClient(rows: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];

  function selectChain(table: string) {
    const chain = {
      eq(column: string, value: string) {
        calls.push({ table, method: 'eq', args: [column, value] });
        return chain;
      },
      async maybeSingle() {
        calls.push({ table, method: 'maybeSingle', args: [] });
        return { data: rows[table] ?? null, error: null };
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      return {
        insert: async (row: unknown) => {
          calls.push({ table, method: 'insert', args: [row] });
          return { error: null };
        },
        update: (patch: unknown) => {
          calls.push({ table, method: 'update', args: [patch] });
          const updateChain = {
            eq(column: string, value: string) {
              calls.push({ table, method: 'update.eq', args: [column, value] });
              return updateChain;
            },
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
          return updateChain;
        },
        select(columns: string) {
          calls.push({ table, method: 'select', args: [columns] });
          return selectChain(table);
        },
      };
    },
  };
  return { client, calls };
}

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-order) inserts a purchase_orders row on create, deriving status from erp_docstatus",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-po-1', po_number: 'PUR-ORD-2026-00001', amount: '200000.00', erp_docstatus: 1, erp_modified: '2026-07-11 10:00:00.000000', erp_amended_from: null },
      {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-po-1', procurementId: 'proc-1', referenceNumber: 'REF-1', date: '2026-07-11', erp_doc_kind: 'purchase-order' },
      },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'purchase_orders');
    assert(insertCall !== undefined, 'expected an insert into purchase_orders');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.procurement_id, 'proc-1');
    assertEquals(row.po_number, 'PUR-ORD-2026-00001');
    assertEquals(row.amount, '200000.00');
    assertEquals(row.status, 'Issued', 'docstatus 1 -> Issued (poGrStatus.ts)');
    assertEquals(row.reference_number, 'REF-1');
    assertEquals(row.date, '2026-07-11');
    assertEquals(row.erp_docstatus, 1);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-order) updates the mirror row on a non-create operation",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-po-1', po_number: 'PUR-ORD-2026-00001', amount: '250000.00', erp_docstatus: 1, erp_modified: '2026-07-12 09:00:00.000000', erp_amended_from: null },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-po-1', erp_doc_kind: 'purchase-order' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'purchase_orders');
    assert(updateCall !== undefined, 'expected an update on purchase_orders');
    const eqCalls = calls.filter((c) => c.method === 'update.eq' && c.table === 'purchase_orders');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind goods-receipt) resolves po_id from the ERP PO name via external_refs, never a raw PMO id",
  fn: async () => {
    const { client, calls } = makeFakeClient({ external_refs: { pmo_record_id: 'pmo-po-1' } });
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-gr-1', gr_number: 'MAT-PRE-2026-00001', po_id: 'PUR-ORD-2026-00001', reference_number: null, erp_docstatus: 1, erp_modified: '2026-07-12 10:00:00.000000' },
      {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-gr-1', procurementId: 'proc-1', receiptDate: '2026-07-12', erp_doc_kind: 'goods-receipt' },
      },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'procurement_receipts');
    assert(insertCall !== undefined, 'expected an insert into procurement_receipts');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.procurement_id, 'proc-1');
    assertEquals(row.gr_number, 'MAT-PRE-2026-00001');
    assertEquals(row.po_id, 'pmo-po-1', 'the RESOLVED pmo purchase_orders.id, never the raw ERP name');
    assertEquals(row.status, 'Complete', 'docstatus 1 -> Complete (poGrStatus.ts)');
    assertEquals(row.receipt_date, '2026-07-12');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind goods-receipt) leaves po_id null when the PO has no external_refs mapping yet",
  fn: async () => {
    const { client, calls } = makeFakeClient({ external_refs: null });
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-gr-2', gr_number: 'MAT-PRE-2026-00002', po_id: null, reference_number: null, erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-gr-2', procurementId: 'proc-1', erp_doc_kind: 'goods-receipt' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'procurement_receipts');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.po_id, null);
    assertEquals(row.status, 'Partial', 'docstatus 0 -> Partial (poGrStatus.ts)');
  },
});

Deno.test({
  name: 'a procurement command with an unowned/absent erp_doc_kind still throws (task 1.6 byte-for-byte, not superseded by 5.4)',
  fn: async () => {
    const { client } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    let threw = false;
    try {
      await writer.upsert({ serviceClient: client as never, orgId: 'org-1' }, { id: 'pmo-1' }, {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-1' },
      });
    } catch {
      threw = true;
    }
    assert(threw, 'expected a kind-less/un-owned procurement command to throw (never a silent no-op)');
  },
});
