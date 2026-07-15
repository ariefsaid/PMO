// Slice 6, task 6.5 — the `procurement` read-model writer's purchase-invoice/payment kinds, and the
// `companies`-domain-adjacent... no: this file owns ONLY procurement_invoices/payments (money). Deno-
// native test (no vitest import), matches readModelWriters.poGr.test.ts's idiom. Additive: leaves
// every other kind's switch case untouched.
//
// Slice 5.5/6 (P3a, FR-SAR-050/052/053): the same money-doc lineage contract (cancel/amend writes an
// `external_ref_lineage` row) is ALSO asserted here for the `revenue` domain's sales-invoice /
// incoming-payment kinds — the outbound counterpart to the inbound apply path's lineage.ts
// applyCancel/applyAmend, mirroring the procurement proofs below.
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

/** Same fake-client shape as readModelWriters.poGr.test.ts, extended with a `select().eq().maybeSingle()`
 *  chain (SF7 cross-org FK guard's lookup shape) keyed per table — `rows[table]` is the row a
 *  `maybeSingle()` returns (e.g. `{ org_id: 'org-1' }`). Backward compatible: defaults to {} so existing
 *  callers that pass nothing still work. */
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

// ── Slice-6 task 6.10/6.11 (FR-ENA-052/053, NFR-ENA-DOC-001): the cancel/amend lineage write. The
// invoice/payment mirror writers set erp_cancelled_at on a cancel (docstatus 2) AND write an
// external_ref_lineage row for both cancel and amend — the audit record of the supersession (the
// outbound counterpart to the inbound apply path's lineage.ts applyCancel/applyAmend, which slice 8
// wires for webhook/sweep events). A regular create/update writes NO lineage row.

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice, verb cancel) sets erp_cancelled_at and writes an external_ref_lineage row (reason='cancelled')",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00001', amount: '150000.00', erp_outstanding_amount: '0.00', erp_docstatus: 2, erp_modified: '2026-07-13 09:00:00.000000', erp_amended_from: null },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'cancel' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'procurement_invoices');
    assert(updateCall !== undefined, 'expected an update on procurement_invoices');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(patch.erp_cancelled_at != null, 'erp_cancelled_at must be set when erp_docstatus=2 (cancel tombstone)');
    assertEquals(patch.erp_docstatus, 2);
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for a cancel');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.org_id, 'org-1');
    assertEquals(lineage.domain, 'procurement');
    assertEquals(lineage.pmo_record_id, 'pmo-pi-1');
    assertEquals(lineage.superseded_external_record_id, 'ACC-PINV-2026-00001');
    assertEquals(lineage.successor_external_record_id, null);
    assertEquals(lineage.reason, 'cancelled');
    assertEquals(lineage.erp_docstatus, 2);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice, amend) writes an external_ref_lineage row (reason=' amended', successor=new name) and does NOT set erp_cancelled_at",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00002', amount: '160000.00', erp_outstanding_amount: '160000.00', erp_docstatus: 1, erp_modified: '2026-07-13 10:00:00.000000', erp_amended_from: 'ACC-PINV-2026-00001' },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pi-1', erp_doc_kind: 'purchase-invoice', externalRecordId: 'ACC-PINV-2026-00001', verb: 'amend' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'procurement_invoices');
    assert(updateCall !== undefined, 'expected an update on procurement_invoices');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(patch.erp_amended_from, 'ACC-PINV-2026-00001');
    assertEquals(patch.erp_cancelled_at, null, 'the NEW amended doc is docstatus 1 (submitted), not cancelled');
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for an amend');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.superseded_external_record_id, 'ACC-PINV-2026-00001', 'the old (amended-from) name');
    assertEquals(lineage.successor_external_record_id, 'ACC-PINV-2026-00002', 'the new amended name');
    assertEquals(lineage.reason, 'amended');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind payment, verb cancel) sets erp_cancelled_at and writes an external_ref_lineage row (reason='cancelled')",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pe-1', pay_number: 'ACC-PAY-2026-00001', amount: '150000.00', erp_docstatus: 2, erp_modified: '2026-07-13 11:00:00.000000', erp_amended_from: null },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pe-1', erp_doc_kind: 'payment', externalRecordId: 'ACC-PAY-2026-00001', verb: 'cancel' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'payments');
    assert(updateCall !== undefined, 'expected an update on payments');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(patch.erp_cancelled_at != null, 'erp_cancelled_at must be set when erp_docstatus=2 (cancel tombstone)');
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for a PE cancel');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.superseded_external_record_id, 'ACC-PAY-2026-00001');
    assertEquals(lineage.successor_external_record_id, null);
    assertEquals(lineage.reason, 'cancelled');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert (kind purchase-invoice, create) writes NO external_ref_lineage row (a fresh create supersedes nothing)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pi-1', vi_number: 'ACC-PINV-2026-00001', amount: '150000.00', erp_outstanding_amount: '150000.00', erp_docstatus: 1, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pi-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-invoice' } },
    );
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall === undefined, 'a create must NOT write a lineage row (nothing superseded)');
  },
});

// ── Slice 5.5/6 (P3a, FR-SAR-050/052/053): the `revenue` read-model writer's sales-invoice /
// incoming-payment kinds carry the SAME cancel/amend lineage contract the procurement money docs do
// (the audit record of the supersession — the outbound counterpart to the inbound apply path's
// lineage.ts applyCancel/applyAmend). A PMO-initiated cancel writes a reason='cancelled' lineage row
// (domain='revenue', no successor); an amend writes a reason='amended' row (superseded=old name,
// successor=new name). A regular create writes NO lineage row.

Deno.test({
  name: "READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, verb cancel) sets erp_cancelled_at and writes an external_ref_lineage row (reason='cancelled', domain='revenue')",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-si-1', si_number: 'ACC-SINV-2026-00001', amount: '50000.00', erp_outstanding_amount: '0.00', erp_docstatus: 2, erp_modified: '2026-07-13 09:00:00.000000', erp_amended_from: null },
      { domain: 'revenue', operation: 'transition', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001', verb: 'cancel' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'sales_invoices');
    assert(updateCall !== undefined, 'expected an update on sales_invoices');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(patch.erp_cancelled_at != null, 'erp_cancelled_at must be set when erp_docstatus=2 (cancel tombstone)');
    assertEquals(patch.erp_docstatus, 2);
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for a revenue SI cancel');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.org_id, 'org-1');
    assertEquals(lineage.domain, 'revenue');
    assertEquals(lineage.pmo_record_id, 'pmo-si-1');
    assertEquals(lineage.superseded_external_record_id, 'ACC-SINV-2026-00001');
    assertEquals(lineage.successor_external_record_id, null);
    assertEquals(lineage.reason, 'cancelled');
    assertEquals(lineage.erp_docstatus, 2);
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, amend) writes an external_ref_lineage row (reason='amended', domain='revenue', successor=new name) and does NOT set erp_cancelled_at",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-si-1', si_number: 'ACC-SINV-2026-00002', amount: '100000.00', erp_outstanding_amount: '100000.00', erp_docstatus: 1, erp_modified: '2026-07-13 10:00:00.000000', erp_amended_from: 'ACC-SINV-2026-00001' },
      { domain: 'revenue', operation: 'transition', record: { id: 'pmo-si-1', erp_doc_kind: 'sales-invoice', externalRecordId: 'ACC-SINV-2026-00001', verb: 'amend' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'sales_invoices');
    assert(updateCall !== undefined, 'expected an update on sales_invoices');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(patch.erp_amended_from, 'ACC-SINV-2026-00001');
    assertEquals(patch.erp_cancelled_at, null, 'the NEW amended doc is docstatus 1 (submitted), not cancelled');
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for a revenue SI amend');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.domain, 'revenue');
    assertEquals(lineage.superseded_external_record_id, 'ACC-SINV-2026-00001', 'the old (amended-from) name');
    assertEquals(lineage.successor_external_record_id, 'ACC-SINV-2026-00002', 'the new amended name');
    assertEquals(lineage.reason, 'amended');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, verb cancel) sets erp_cancelled_at and writes an external_ref_lineage row (reason='cancelled', domain='revenue')",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-ip-1', ip_number: 'ACC-PAY-2026-00001', amount: '50000.00', erp_docstatus: 2, erp_modified: '2026-07-13 11:00:00.000000', erp_amended_from: null },
      { domain: 'revenue', operation: 'transition', record: { id: 'pmo-ip-1', erp_doc_kind: 'incoming-payment', externalRecordId: 'ACC-PAY-2026-00001', verb: 'cancel' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'incoming_payments');
    assert(updateCall !== undefined, 'expected an update on incoming_payments');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(patch.erp_cancelled_at != null, 'erp_cancelled_at must be set when erp_docstatus=2 (cancel tombstone)');
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall !== undefined, 'expected an insert into external_ref_lineage for a revenue PE cancel');
    const lineage = lineageCall!.args[0] as Record<string, unknown>;
    assertEquals(lineage.domain, 'revenue');
    assertEquals(lineage.superseded_external_record_id, 'ACC-PAY-2026-00001');
    assertEquals(lineage.successor_external_record_id, null);
    assertEquals(lineage.reason, 'cancelled');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, create) writes NO external_ref_lineage row (a fresh create supersedes nothing)",
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-si-1', si_number: 'ACC-SINV-2026-00001', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-1', projectId: 'proj-1', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
    );
    const lineageCall = calls.find((c) => c.method === 'insert' && c.table === 'external_ref_lineage');
    assert(lineageCall === undefined, 'a create must NOT write a lineage row (nothing superseded)');
  },
});

// ============================================================================
// Luna money audit — BLOCK 4: a PMO-created SI must stamp author_user_id = the caller (creator) so
// the submit_sales_invoice SoD (approver≠author) is NOT a no-op (the RPC skips the check when the
// author is null). An inbound-adopted SI (no PMO caller) keeps author_user_id null — SoD-exempt.
// ============================================================================

Deno.test({
  name: "Luna BLOCK 4 — READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, create) stamps author_user_id = the caller's user id (creator) so the submit SoD is not a no-op",
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1', callerUserId: 'user-author-1' },
      { id: 'pmo-si-block4-1', si_number: 'ACC-SINV-2026-00001', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-block4-1', projectId: 'proj-1', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'sales_invoices');
    assert(insertCall !== undefined, 'expected an insert into sales_invoices');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.author_user_id, 'user-author-1', 'a PMO-created SI must stamp author_user_id = the caller (creator) so submit SoD is not a no-op');
  },
});

Deno.test({
  name: "Luna BLOCK 4 — an inbound-adopted SI (no PMO caller) keeps author_user_id null (SoD-exempt)",
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' }, // no callerUserId — the inbound-adopted path
      { id: 'pmo-si-block4-2', si_number: 'ACC-SINV-2026-00002', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-block4-2', projectId: 'proj-1', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'sales_invoices');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.author_user_id, null, 'an inbound-adopted SI (no PMO caller) keeps author_user_id null — SoD-exempt');
  },
});

// ============================================================================
// Luna money audit — SF6: incoming_payments.date is clobbered to null on CREATE because the base
// `patch` includes `date` (canonical.date, null from peReceiveFromDoc) and the create branch spreads
// `...patch` AFTER `date: record.date`, overwriting it. FIX: `date` is a create-only command field
// (like the SI customer_id/project_id links) — removed from the base patch; the create branch keeps
// `date: record.date`. An UPDATE must NOT touch date (a status-sync mirror must never null it).
// ============================================================================

Deno.test({
  name: "Luna SF6 — READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, create) retains the command's date (NOT clobbered to null by the base patch)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      {
        id: 'pmo-ip-sf6-1',
        ip_number: 'ACC-PAY-2026-00001',
        // NOTE: canonical carries NO date (peReceiveFromDoc does not populate it) — the bug
        // clobbered the command's record.date with this null via the base `...patch` spread.
        amount: '50000.00',
        erp_docstatus: 1,
        erp_modified: '2026-07-12 12:00:00.000000',
      },
      {
        domain: 'revenue',
        operation: 'create',
        record: { id: 'pmo-ip-sf6-1', date: '2026-07-12', erp_doc_kind: 'incoming-payment' },
      },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'incoming_payments');
    assert(insertCall !== undefined, 'expected an insert into incoming_payments');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(
      row.date,
      '2026-07-12',
      'a created incoming_payment must retain the command record.date (the base patch must not clobber it to null)',
    );
  },
});

Deno.test({
  name: "Luna SF6 — an UPDATE (transition) does NOT include date in the patch (a status-sync mirror must never null a stable date)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-ip-sf6-2', ip_number: 'ACC-PAY-2026-00001', amount: '50000.00', erp_docstatus: 2, erp_modified: '2026-07-13 11:00:00.000000', erp_amended_from: null },
      { domain: 'revenue', operation: 'transition', record: { id: 'pmo-ip-sf6-2', erp_doc_kind: 'incoming-payment', externalRecordId: 'ACC-PAY-2026-00001', verb: 'cancel' } },
    );
    const updateCall = calls.find((c) => c.method === 'update' && c.table === 'incoming_payments');
    assert(updateCall !== undefined, 'expected an update on incoming_payments');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(
      !('date' in patch),
      'the update patch must NOT include date (a later mirror must never null a create-time date)',
    );
  },
});

// ============================================================================
// Luna money audit — SF7: the service-role writer bypasses RLS, so before copying a PMO-side link
// (customer_id/project_id/sales_invoice_id) from the command into a created row, it must SELECT the
// referenced row and assert org_id === ctx.orgId. A cross-org link is rejected with a classified
// AppError 'cross-org-link-rejected' (never silently linked). Applies to the SI create
// (companies.customer_id + projects.project_id) and the incoming-payment create
// (companies.customer_id + sales_invoices.sales_invoice_id). Null links skip the lookup.
// ============================================================================

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, create) rejects a cross-org customer_id with code 'cross-org-link-rejected'",
  fn: async () => {
    // companies lookup returns a DIFFERENT org's row → the service-role writer must reject the link.
    const { client } = makeFakeClient({ companies: { org_id: 'org-OTHER' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    let err: unknown = null;
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-si-sf7-1', si_number: 'ACC-SINV-2026-00001', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
        { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-sf7-1', projectId: 'proj-1', customerId: 'cust-OTHER-ORG', erp_doc_kind: 'sales-invoice' } },
      );
    } catch (e) {
      threw = true;
      err = e;
    }
    assert(threw, 'a cross-org customer_id must be rejected (never silently linked by the service-role writer)');
    assertEquals((err as { code?: string }).code, 'cross-org-link-rejected', 'classified cross-org-link-rejected error code');
  },
});

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, create) rejects a cross-org project_id with code 'cross-org-link-rejected'",
  fn: async () => {
    // companies is same-org but projects belongs to a different org → still rejected.
    const { client } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-OTHER' } });
    const writer = getReadModelWriter('revenue');
    let err: unknown = null;
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-si-sf7-2', si_number: 'ACC-SINV-2026-00002', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
        { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-sf7-2', projectId: 'proj-OTHER-ORG', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
      );
    } catch (e) {
      threw = true;
      err = e;
    }
    assert(threw, 'a cross-org project_id must be rejected');
    assertEquals((err as { code?: string }).code, 'cross-org-link-rejected', 'classified cross-org-link-rejected error code');
  },
});

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind sales-invoice, create) passes when customer_id and project_id both belong to ctx.orgId",
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, projects: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-si-sf7-3', si_number: 'ACC-SINV-2026-00003', amount: '50000.00', erp_outstanding_amount: '50000.00', erp_docstatus: 0, erp_modified: '2026-07-12 10:00:00.000000' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-si-sf7-3', projectId: 'proj-1', customerId: 'cust-1', erp_doc_kind: 'sales-invoice' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'sales_invoices');
    assert(insertCall !== undefined, 'a same-org SI create must proceed to insert');
  },
});

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, create) rejects a cross-org sales_invoice_id with code 'cross-org-link-rejected'",
  fn: async () => {
    const { client } = makeFakeClient({ companies: { org_id: 'org-1' }, sales_invoices: { org_id: 'org-OTHER' } });
    const writer = getReadModelWriter('revenue');
    let err: unknown = null;
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-ip-sf7-1', ip_number: 'ACC-PAY-2026-00001', amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 12:00:00.000000' },
        { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-sf7-1', customerId: 'cust-1', salesInvoiceId: 'si-OTHER-ORG', date: '2026-07-12', erp_doc_kind: 'incoming-payment' } },
      );
    } catch (e) {
      threw = true;
      err = e;
    }
    assert(threw, 'a cross-org sales_invoice_id must be rejected');
    assertEquals((err as { code?: string }).code, 'cross-org-link-rejected', 'classified cross-org-link-rejected error code');
  },
});

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, create) rejects a cross-org customer_id with code 'cross-org-link-rejected'",
  fn: async () => {
    const { client } = makeFakeClient({ companies: { org_id: 'org-OTHER' }, sales_invoices: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    let err: unknown = null;
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-ip-sf7-2', ip_number: 'ACC-PAY-2026-00002', amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 12:00:00.000000' },
        { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-sf7-2', customerId: 'cust-OTHER-ORG', salesInvoiceId: 'si-1', date: '2026-07-12', erp_doc_kind: 'incoming-payment' } },
      );
    } catch (e) {
      threw = true;
      err = e;
    }
    assert(threw, 'a cross-org customer_id must be rejected');
    assertEquals((err as { code?: string }).code, 'cross-org-link-rejected', 'classified cross-org-link-rejected error code');
  },
});

Deno.test({
  name: "Luna SF7 — READ_MODEL_WRITERS['revenue'].upsert (kind incoming-payment, create) passes when customer_id and sales_invoice_id both belong to ctx.orgId",
  fn: async () => {
    const { client, calls } = makeFakeClient({ companies: { org_id: 'org-1' }, sales_invoices: { org_id: 'org-1' } });
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-ip-sf7-3', ip_number: 'ACC-PAY-2026-00003', amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 12:00:00.000000' },
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-sf7-3', customerId: 'cust-1', salesInvoiceId: 'si-1', date: '2026-07-12', erp_doc_kind: 'incoming-payment' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'incoming_payments');
    assert(insertCall !== undefined, 'a same-org incoming-payment create must proceed to insert');
  },
});

Deno.test({
  name: "Luna SF7 — null/omitted links skip the cross-org lookup entirely (an on-account PE with no customer/sales_invoice is allowed, no select fired)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('revenue');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-ip-sf7-4', ip_number: 'ACC-PAY-2026-00004', amount: '50000.00', erp_docstatus: 1, erp_modified: '2026-07-12 12:00:00.000000' },
      // no customerId, no salesInvoiceId — an on-account / unlinked receive
      { domain: 'revenue', operation: 'create', record: { id: 'pmo-ip-sf7-4', date: '2026-07-12', erp_doc_kind: 'incoming-payment' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert' && c.table === 'incoming_payments');
    assert(insertCall !== undefined, 'an unlinked incoming-payment create must proceed (no links to validate)');
    const selectCalls = calls.filter((c) => c.method === 'select');
    assertEquals(selectCalls.length, 0, 'no link lookups when all links are null');
  },
});
