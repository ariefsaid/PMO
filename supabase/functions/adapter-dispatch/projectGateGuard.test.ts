// Round-7 cross-family audit, B8 — `require_project_on_si` must gate SUBMIT, not only the
// body-building operations.
//
// The signed spec (docs/specs/erpnext-adapter-p3a-sales-ar.spec.md, FR-SAR-191) says: "When ON, an SI
// create/SUBMIT must carry a non-null project_id and the dispatch rejects a null-project SI at the
// boundary (`commit-rejected` / `project-required`)". The shipped gate covered create/update/amend and
// deliberately excluded submit, so an SI created while the gate was OFF — or an inbound, unassigned SI
// adopted by the sweep — could still be SUBMITTED after the gate was turned on: revenue posts to the
// ERP GL with NO project dimension while PMO reports project-attributed revenue.
//
// A submit builds no body, so the project cannot be read off the command — the PMO record is the
// authority (`sales_invoices.project_id`), which is exactly what an inbound-adopted SI leaves NULL.
//
// Verify: deno test supabase/functions/adapter-dispatch/ --config supabase/functions/adapter-dispatch/deno.json

import { assertEquals, assert } from 'jsr:@std/assert';
import { checkSiProjectGate, type ProjectGateClient } from './projectGateGuard.ts';

/** Fake seam: `get_process_gates` + the `sales_invoices.project_id` read. */
function fakeClient(opts: {
  gates?: Record<string, boolean>;
  gatesError?: { code: string; message: string };
  /** The PMO invoice rows this fake knows, by id. `undefined` ⇒ no row. */
  invoices?: Record<string, { project_id: string | null }>;
  invoiceError?: { code: string; message: string };
  onRead?: (filters: Record<string, string>) => void;
}): ProjectGateClient {
  const gates = { require_so_before_si: false, require_bast_before_si: false, require_project_on_si: true, ...(opts.gates ?? {}) };
  return {
    rpc: async (fn: string) => {
      if (fn === 'get_process_gates') {
        return opts.gatesError ? { data: null, error: opts.gatesError } : { data: gates, error: null };
      }
      return { data: null, error: { code: 'P0001', message: `unknown rpc: ${fn}` } };
    },
    from: (table: string) => ({
      select: (_columns: string) => {
        const filters: Record<string, string> = {};
        const builder = {
          eq(column: string, value: string) {
            filters[column] = value;
            return builder;
          },
          async maybeSingle() {
            opts.onRead?.(filters);
            if (opts.invoiceError) return { data: null, error: opts.invoiceError };
            if (table !== 'sales_invoices') return { data: null, error: null };
            const row = (opts.invoices ?? {})[filters.id];
            return { data: row ?? null, error: null };
          },
        };
        return builder;
      },
    }),
  };
}

const submit = (id = 'si-1') => ({
  domain: 'revenue',
  operation: 'transition',
  record: { id, erp_doc_kind: 'sales-invoice', verb: 'submit' },
});

Deno.test('B8: a SUBMIT of an SI with no project is REFUSED 422 project-required when the gate is on', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ invoices: { 'si-1': { project_id: null } } }),
    'org-1',
    submit(),
  );
  assertEquals(res.ok, false, 'project-less revenue must not post to the ERP GL under an on gate');
  assertEquals(res.status, 422);
  assertEquals(res.message, 'project-required');
});

Deno.test('B8: a SUBMIT of an SI that HAS a project passes', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ invoices: { 'si-1': { project_id: 'proj-1' } } }),
    'org-1',
    submit(),
  );
  assertEquals(res.ok, true, res.message);
});

Deno.test('B8: the submit gate reads the PMO record scoped to the org (never a bare id read)', async () => {
  const seen: Array<Record<string, string>> = [];
  await checkSiProjectGate(
    fakeClient({ invoices: { 'si-1': { project_id: 'proj-1' } }, onRead: (f) => seen.push({ ...f }) }),
    'org-1',
    submit(),
  );
  assertEquals(seen.length, 1);
  assertEquals(seen[0].id, 'si-1');
  assertEquals(seen[0].org_id, 'org-1');
});

Deno.test('B8: a SUBMIT whose PMO record cannot be found fails CLOSED', async () => {
  const res = await checkSiProjectGate(fakeClient({ invoices: {} }), 'org-1', submit('ghost'));
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('B8: a read error on the PMO record fails CLOSED (never "no project rule applied")', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ invoiceError: { code: '08006', message: 'connection failure' } }),
    'org-1',
    submit(),
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assertEquals(res.message, 'gate-check-failed');
});

Deno.test('B8: with the gate OFF a project-less SUBMIT is allowed (the gate is relaxable, FR-SAR-191)', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ gates: { require_project_on_si: false }, invoices: { 'si-1': { project_id: null } } }),
    'org-1',
    submit(),
  );
  assertEquals(res.ok, true, res.message);
});

Deno.test('B8: the gate OFF does not even read the PMO record (no needless round trip)', async () => {
  let reads = 0;
  await checkSiProjectGate(
    fakeClient({ gates: { require_project_on_si: false }, onRead: () => { reads += 1; } }),
    'org-1',
    submit(),
  );
  assertEquals(reads, 0);
});

// ── The create/update/amend half is preserved byte-for-byte in behavior: the command's own projectId
//    is the authority there (the body is built from it), and a missing one is the same 422. ──

Deno.test('B8: a CREATE with no projectId is still refused 422 project-required (regression guard)', async () => {
  const res = await checkSiProjectGate(fakeClient({}), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-2', erp_doc_kind: 'sales-invoice' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assertEquals(res.message, 'project-required');
});

Deno.test('B8: a CREATE carrying a projectId passes without reading the (not yet existing) PMO row', async () => {
  let reads = 0;
  const res = await checkSiProjectGate(fakeClient({ onRead: () => { reads += 1; } }), 'org-1', {
    domain: 'revenue',
    operation: 'create',
    record: { id: 'si-2', erp_doc_kind: 'sales-invoice', projectId: 'proj-1' },
  });
  assertEquals(res.ok, true, res.message);
  assertEquals(reads, 0, 'a create has no mirror row yet — the command is the authority');
});

Deno.test('B8: an AMEND transition with no projectId is still refused (the body-building half)', async () => {
  const res = await checkSiProjectGate(fakeClient({}), 'org-1', {
    domain: 'revenue',
    operation: 'transition',
    record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'amend' },
  });
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('B8: a CANCEL is untouched by the project gate (it removes revenue, it does not post it)', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ invoices: { 'si-1': { project_id: null } } }),
    'org-1',
    { domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'cancel' } },
  );
  assertEquals(res.ok, true, res.message);
});

Deno.test('B8: non-SI commands are untouched (incoming payment, procurement, companies)', async () => {
  for (const command of [
    { domain: 'revenue', operation: 'create', record: { id: 'ip-1', erp_doc_kind: 'incoming-payment' } },
    { domain: 'procurement', operation: 'create', record: { id: 'pi-1', erp_doc_kind: 'purchase-invoice' } },
    { domain: 'companies', operation: 'create', record: { id: 'c-1', erp_doc_kind: 'customer' } },
  ]) {
    const res = await checkSiProjectGate(fakeClient({}), 'org-1', command);
    assertEquals(res.ok, true, `${command.record.erp_doc_kind} must not be project-gated: ${res.message}`);
  }
});

Deno.test('B8: a get_process_gates failure fails CLOSED with gate-check-failed', async () => {
  const res = await checkSiProjectGate(
    fakeClient({ gatesError: { code: '42501', message: 'not authorized' } }),
    'org-1',
    submit(),
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assertEquals(res.message, 'gate-check-failed');
  assert(!res.ok);
});
