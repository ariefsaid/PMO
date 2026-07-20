// Task 1.6 — multi-domain read-model writer registry + resolver (replaces the dispatch if-chain).
// Deno-native test (no vitest import — plain assert helpers, matches agent-chat's
// actions.queryEntity.test.ts idiom).
// Verify: cd supabase/functions/adapter-dispatch && deno test readModelWriters.test.ts

import { READ_MODEL_WRITERS, getReadModelWriter, upsertProcurementItemMirror } from './readModelWriters.ts';
import { resolveExternalRef, findPmoRecordId } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';

function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** A minimal fake service-role client recording every call, structurally matching supabase-js'
 *  .from(table).{insert,update,upsert,select} chain shape used by the writers/resolvers below. */
/** B10 (round-7): the procurement mirror writers now verify each NOT-NULL link row belongs to the
 *  caller's org before the service-role insert, so every fixture needs those link rows to EXIST in
 *  org-1 (the ctx.orgId these tests use). A test that wants the cross-org/missing case overrides the
 *  entry — the dedicated proofs live in readModelWriters.crossOrg.test.ts. */
const OWN_ORG_LINK_ROWS: Record<string, unknown> = {
  procurements: { org_id: 'org-1' },
  companies: { org_id: 'org-1' },
  procurement_invoices: { org_id: 'org-1' },
};

function makeFakeClient(rows: Record<string, unknown> = {}) {
  rows = { ...OWN_ORG_LINK_ROWS, ...rows };
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const eqFilters: Record<string, string> = {};

  function selectChain(table: string) {
    const chain = {
      eq(column: string, value: string) {
        calls.push({ table, method: 'eq', args: [column, value] });
        eqFilters[column] = value;
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
        upsert: async (row: unknown, options: unknown) => {
          calls.push({ table, method: 'upsert', args: [row, options] });
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
  name: "READ_MODEL_WRITERS['tasks'].upsert writes a task row via insert on create (moved ClickUp writer)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('tasks');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-1', name: 'Task A', status: 'open', project_id: 'proj-1' },
      { domain: 'tasks', operation: 'create', record: { id: 'pmo-1', project_id: 'proj-1' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert call for a task create');
    assertEquals((insertCall!.args[0] as { org_id: string }).org_id, 'org-1');
    assertEquals((insertCall!.args[0] as { project_id: string }).project_id, 'proj-1');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['tasks'].upsert updates a task row on a non-create operation",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('tasks');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-1', name: 'Task A (renamed)', status: 'closed' },
      { domain: 'tasks', operation: 'update', record: { id: 'pmo-1' } },
    );
    const updateCall = calls.find((c) => c.method === 'update');
    assert(updateCall !== undefined, 'expected an update call for a task update');
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: 'an unknown domain throws (no silent skip)',
  fn: () => {
    let threw = false;
    try {
      getReadModelWriter('nonexistent-domain');
    } catch {
      threw = true;
    }
    assert(threw, 'expected getReadModelWriter to throw for an unregistered domain');
  },
});

Deno.test({
  name: "the 'procurement' domain is registered but not-yet-wired (slices 4-6) — loud throw, not a silent no-op",
  fn: async () => {
    const writer = READ_MODEL_WRITERS['procurement'];
    assert(writer !== undefined, "expected a registered (not-yet-wired) writer for 'procurement'");
    let threw = false;
    try {
      await writer.upsert({ serviceClient: makeFakeClient().client as never, orgId: 'org-1' }, { id: 'pmo-1' }, {
        domain: 'procurement', operation: 'create', record: { id: 'pmo-1' },
      });
    } catch {
      threw = true;
    }
    assert(threw, "expected the not-yet-wired 'procurement' writer to throw rather than silently no-op");
  },
});

// task 3.6 — the 'companies' domain is now REALLY wired (parties flip, FR-ENA-090).
Deno.test({
  name: "READ_MODEL_WRITERS['companies'].upsert inserts the mirror row (name/type/erp_* cols) on create",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('companies');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-co-1', name: 'Acme Co', type: 'Vendor', erp_party_type: 'Vendor', erp_supplier_name: 'Acme Co', erp_tax_id: 'TAX-1' },
      { domain: 'companies', operation: 'create', record: { id: 'pmo-co-1', erp_doc_kind: 'supplier' } },
    );
    const insertCall = calls.find((c) => c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert call for a companies create');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.id, 'pmo-co-1');
    assertEquals(row.name, 'Acme Co');
    assertEquals(row.type, 'Vendor');
    assertEquals(row.erp_supplier_name, 'Acme Co');
    assertEquals(row.erp_tax_id, 'TAX-1');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['companies'].upsert updates the mirror row on a non-create operation, NEVER touching archived_at (enhancement)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('companies');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-co-1', name: 'Acme Co Renamed', type: 'Vendor', erp_party_type: 'Vendor', erp_supplier_name: 'Acme Co Renamed', erp_tax_id: null },
      { domain: 'companies', operation: 'update', record: { id: 'pmo-co-1', erp_doc_kind: 'supplier' } },
    );
    const updateCall = calls.find((c) => c.method === 'update');
    assert(updateCall !== undefined, 'expected an update call for a companies update');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assert(!('archived_at' in patch), 'the companies mirror writer must never set archived_at (PMO-owned enhancement)');
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: 'resolveExternalRef returns the external_refs external id, and null when absent',
  fn: async () => {
    const { client: withRow } = makeFakeClient({ external_refs: { external_record_id: 'ext-123' } });
    const found = await resolveExternalRef(withRow as never, 'org-1', 'tasks', 'pmo-1');
    assertEquals(found, 'ext-123');

    const { client: withoutRow } = makeFakeClient({ external_refs: null });
    const missing = await resolveExternalRef(withoutRow as never, 'org-1', 'tasks', 'pmo-missing');
    assertEquals(missing, null);
  },
});

Deno.test({
  name: 'findPmoRecordId is the exact reverse of resolveExternalRef',
  fn: async () => {
    const { client: withRow } = makeFakeClient({ external_refs: { pmo_record_id: 'pmo-1' } });
    const found = await findPmoRecordId(withRow as never, 'org-1', 'tasks', 'ext-123');
    assertEquals(found, 'pmo-1');

    const { client: withoutRow } = makeFakeClient({ external_refs: null });
    const missing = await findPmoRecordId(withoutRow as never, 'org-1', 'tasks', 'ext-missing');
    assertEquals(missing, null);
  },
});

// ── Task 4.5 — the 'procurement' writer's first 3 kinds (purchase-request/rfq/quotation). Additive
// block: the pre-4.5 tests above (incl. "not-yet-wired" for a payload with no erp_doc_kind) stay green
// unmodified — a missing/unrecognized kind still falls to the writer's own loud default throw. ──

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert inserts a purchase_requests mirror row on create (task 4.5)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pr-1', pr_number: 'MAT-REQ-2026-00001', amount: '150000.00', erp_docstatus: 1, erp_modified: '2026-07-11 10:00:00' },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-pr-1', procurementId: 'proc-1', erp_doc_kind: 'purchase-request' } },
    );
    const insertCall = calls.find((c) => c.table === 'purchase_requests' && c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert into purchase_requests');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.org_id, 'org-1');
    assertEquals(row.procurement_id, 'proc-1');
    assertEquals(row.pr_number, 'MAT-REQ-2026-00001');
    assertEquals(row.amount, '150000.00');
    assertEquals(row.erp_docstatus, 1);
    assertEquals(row.status, 'Submitted');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert updates a purchase_requests mirror row on transition",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-pr-1', pr_number: 'MAT-REQ-2026-00001', erp_docstatus: 2 },
      { domain: 'procurement', operation: 'transition', record: { id: 'pmo-pr-1', erp_doc_kind: 'purchase-request' } },
    );
    const updateCall = calls.find((c) => c.table === 'purchase_requests' && c.method === 'update');
    assert(updateCall !== undefined, 'expected an update to purchase_requests');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(patch.erp_docstatus, 2);
    assertEquals(patch.status, 'Closed');
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert inserts an rfqs mirror row, mapping docstatus 1 -> 'Issued' (rfqs has no 'Submitted' value)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-rfq-1', rfq_number: 'PUR-RFQ-2026-00001', erp_docstatus: 1 },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-rfq-1', procurementId: 'proc-1', erp_doc_kind: 'rfq' } },
    );
    const insertCall = calls.find((c) => c.table === 'rfqs' && c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert into rfqs');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.rfq_number, 'PUR-RFQ-2026-00001');
    assertEquals(row.status, 'Issued');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert inserts a procurement_quotations mirror row on create (is_selected untouched)",
  fn: async () => {
    const { client, calls } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    await writer.upsert(
      { serviceClient: client as never, orgId: 'org-1' },
      { id: 'pmo-quo-1', vq_number: 'PUR-SQTN-2026-00001', total_amount: '42000.00', valid_until: '2026-08-01', erp_docstatus: 1 },
      { domain: 'procurement', operation: 'create', record: { id: 'pmo-quo-1', procurementId: 'proc-1', vendorId: 'company-1', erp_doc_kind: 'quotation' } },
    );
    const insertCall = calls.find((c) => c.table === 'procurement_quotations' && c.method === 'insert');
    assert(insertCall !== undefined, 'expected an insert into procurement_quotations');
    const row = insertCall!.args[0] as Record<string, unknown>;
    assertEquals(row.vendor_id, 'company-1');
    assertEquals(row.total_amount, '42000.00');
    assertEquals(row.vq_number, 'PUR-SQTN-2026-00001');
    assert(!('is_selected' in row), 'is_selected must never be set by the machine mirror writer (PMO-only enhancement)');
  },
});

Deno.test({
  name: 'upsertProcurementItemMirror mirrors quantity/rate/erp_line_amount onto a procurement_items row (NEVER amount, the GENERATED column)',
  fn: async () => {
    const { client, calls } = makeFakeClient();
    await upsertProcurementItemMirror(
      { serviceClient: client as never, orgId: 'org-1' },
      'item-1',
      { quantity: '3.00', rate: '111.00', erpLineAmount: '333.00', erpDocstatus: 1, erpModified: '2026-07-11 10:00:00' },
    );
    const updateCall = calls.find((c) => c.table === 'procurement_items' && c.method === 'update');
    assert(updateCall !== undefined, 'expected an update to procurement_items');
    const patch = updateCall!.args[0] as Record<string, unknown>;
    assertEquals(patch.quantity, '3.00');
    assertEquals(patch.rate, '111.00');
    assertEquals(patch.erp_line_amount, '333.00');
    assert(!('amount' in patch), 'amount is GENERATED — the mirror must never attempt to write it (FR-ENA-071)');
    const eqCalls = calls.filter((c) => c.method === 'update.eq');
    assertEquals(eqCalls.length, 2, 'expected two scoping .eq() calls (org_id, id)');
  },
});

Deno.test({
  name: "READ_MODEL_WRITERS['procurement'].upsert throws for a kind not yet wired (purchase-order — slice 5)",
  fn: async () => {
    const { client } = makeFakeClient();
    const writer = getReadModelWriter('procurement');
    let threw = false;
    try {
      await writer.upsert(
        { serviceClient: client as never, orgId: 'org-1' },
        { id: 'pmo-po-1' },
        { domain: 'procurement', operation: 'create', record: { id: 'pmo-po-1', erp_doc_kind: 'purchase-order' } },
      );
    } catch {
      threw = true;
    }
    assert(threw, 'expected the not-yet-wired purchase-order kind to throw rather than silently no-op');
  },
});
