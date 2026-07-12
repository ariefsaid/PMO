// Slice 6, task 6.5 — the `procurement` read-model writer's purchase-invoice/payment kinds, and the
// `companies`-domain-adjacent... no: this file owns ONLY procurement_invoices/payments (money). Deno-
// native test (no vitest import), matches readModelWriters.poGr.test.ts's idiom. Additive: leaves
// every other kind's switch case untouched.
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.money.test.ts

import { getReadModelWriter } from './readModelWriters.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Same fake-client shape as readModelWriters.poGr.test.ts. */
function makeFakeClient() {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
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
      };
    },
  };
  return { client, calls };
}

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice) inserts a procurement_invoices row on create, deriving status from erp_outstanding_amount",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      {
        id: 'pmo-pi-1',
        vi_number: 'ACC-PINV-2026-00001',
        invoice_date: '2026-07-12',
        reference_number: 'BILL-001',
        amount: '150000.00',
        erp_outstanding_amount: '150000.00',
        erp_docstatus: 1,
        erp_modified: '2026-07-12 10:00:00.000000',
        erp_amended_from: null,
      },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'procurement_invoices');
    assert(insertCall !== undefined, 'expected an insert into procurement_invoices');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.procurement_id, 'proc-1');
    assertEquals(row.vi_number, 'ACC-PINV-2026-00001');
    assertEquals(row.invoice_date, '2026-07-12');
    assertEquals(row.reference_number, 'BILL-001');
    assertEquals(row.amount, '150000.00');
    assertEquals(row.erp_outstanding_amount, '150000.00');
    assertEquals(row.status, 'Received', 'outstanding > 0 -> Received (not yet Paid)');
    assertEquals(row.erp_docstatus, 1);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice) derives status Paid when erp_outstanding_amount is exactly 0",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      {
        id: 'pmo-pi-1',
        vi_number: 'ACC-PINV-2026-00001',
        amount: '150000.00',
        erp_outstanding_amount: '0.00',
        erp_docstatus: 1,
        erp_modified: '2026-07-12 11:00:00.000000',
      },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'procurement_invoices');
    assert(updateCall !== undefined, 'expected an update on procurement_invoices');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(patch.status, 'Paid', 'erp_outstanding_amount 0.00 -> Paid (R9 paid-detection)');
    const eqCalls = calls.filter((c) => c.method === 'update.eq' && c.table === 'procurement_invoices');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice) throws when a create carries no procurementId",
  fn: async () => {
    const { client } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00001' },
        { domain: 'procurement', operation: 'create', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice' } },
      );
    } catch {
      threw = true;
    }
    assert(threw, 'expected a create with no procurementId to throw (never a silent partial insert)');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind payment) inserts a payments row on create, linking invoice_id from the command's invoiceId (PMO id, no resolution needed)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      {
        id: 'pmo-pe-1',
        pay_number: 'ACC-PAY-2026-00001',
        amount: '150000.00',
        reference_number: null,
        erp_docstatus: 1,
        erp_modified: '2026-07-12 12:00:00.000000',
      },
      {
        domain: 'procurement',
        operation: 'create',
        record: { id: 'pmo-pe-1', procurementId: 'proc-1', invoiceId: 'pmo-pi-1', paid_amount: 150000, erp_doc_kind: 'payment' },
      },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'payments');
    assert(insertCall !== undefined, 'expected an insert into payments');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.procurement_id, 'proc-1');
    assertEquals(row.invoice_id, 'pmo-pi-1', 'invoice_id is the PMO id already known at command time — no external_refs round-trip needed');
    assertEquals(row.pay_number, 'ACC-PAY-2026-00001');
    assertEquals(row.amount, '150000.00');
    assertEquals(row.status, 'Paid', 'a submitted (docstatus 1) Payment Entry is Paid');
    assertEquals(row.erp_docstatus, 1);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind payment) leaves invoice_id null for an unreferenced (on-account) payment",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pe-2', pay_number: 'ACC-PAY-2026-00002', amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 13:00:00.000000' },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pe-2', procurementId: 'proc-1', erp_doc_kind: 'payment' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'payments');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.invoice_id, null);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind payment) updates the mirror row on a non-create operation",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pe-1', pay_number: 'ACC-PAY-2026-00001', amount: '150000.00', erp_docstatus: 2, erp_modified: '2026-07-13 09:00:00.000000' },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pe-1', erp_doc_kind: 'payment' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'payments');
    assert(updateCall !== undefined, 'expected an update on payments');
    const eqCalls = calls.filter((c) => c.method === 'update.eq' && c.table === 'payments');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});
