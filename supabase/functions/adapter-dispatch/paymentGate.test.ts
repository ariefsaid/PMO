// #910 (FR-VPAY-005, DD-VPAY-5, AC-VPAY-003) — the vendor-payment money gate, unit-provable here so
// index.ts stays integration-only (the sodGuard.ts/approvalGuard.ts module shape).
//
// On a flipped org the dispatched Payment Entry IS the money release: `transition_procurement`'s
// SoD-b (approver ≠ payer, 0006_procurement_lifecycle.sql:222-225) never runs on that path, and the
// served gate is role-only (authGuard.ts). So a procurement `payment` create re-reads the CASE from
// the DB — the payload is never trusted — and refuses:
//   • 403 (0006's exact SoD-b wording) when the caller IS the case's approver;
//   • 422 when the case is not at `Vendor Invoiced` (only that stage owes a bill payment);
//   • fail closed when the case row cannot be read (the approvalGuard posture — a gate that cannot
//     evaluate refuses, money-path primer bucket "fail closed").
// Non-payment kinds and other domains pass WITHOUT any DB read (the gate is keyed on the command).
//
// Mutation contract (the money-path binding rule): breaking the approver compare in the guard (e.g.
// an always-allow) turns `SoD-b` tests below RED. Verified 2026-10-08 — see the build report.
//
// Verify: cd supabase/functions/adapter-dispatch && deno test paymentGate.test.ts --config deno.json --allow-env --allow-net --allow-read

import { assertEquals, assert } from 'jsr:@std/assert';
import { enforcePaymentGate, isProcurementPaymentCreate, type PaymentGateClient } from './paymentGate.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** Fake seam: the `procurements` re-read the guard decides on. Rows carry their real org_id so a
 *  cross-org id is distinguishable from a same-org one by the id alone (the Luna B2 fixture rule). */
function fakeClient(opts: {
  cases?: Record<string, { org_id: string; status: string; approved_by_id: string | null }>;
  readError?: { code: string; message: string };
  onRead?: (table: string, filters: Record<string, string>) => void;
}): PaymentGateClient {
  return {
    from: (table: string) => ({
      select: (_columns: string) => {
        const filters: Record<string, string> = {};
        const builder = {
          eq(column: string, value: string) {
            filters[column] = value;
            return builder;
          },
          async maybeSingle() {
            opts.onRead?.(table, filters);
            if (opts.readError) return { data: null, error: opts.readError };
            if (table !== 'procurements') return { data: null, error: null };
            const row = (opts.cases ?? {})[filters.id];
            // The real read is org-scoped: a row from another org is NOT returned (RLS posture).
            if (!row || row.org_id !== filters.org_id) return { data: null, error: null };
            return { data: row, error: null };
          },
        };
        return builder;
      },
    }),
  } as unknown as PaymentGateClient;
}

const paymentCreate = (procurementId = 'proc-1') => ({
  domain: 'procurement',
  operation: 'create',
  record: { id: 'pmo-pay-1', erp_doc_kind: 'payment', procurementId, invoiceId: 'inv-1', paid_amount: 1090000, date: '2026-10-08' },
}) as unknown as AdapterCommand;

const VENDOR_INVOICED_CASE = { org_id: 'org-1', status: 'Vendor Invoiced', approved_by_id: 'user-a' };

Deno.test('AC-VPAY-003 SoD-b: the case APPROVER dispatching the payment create is refused 403 with 0006\'s wording', async () => {
  const res = await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE } }), 'org-1', 'user-a', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assertEquals(res.message, 'separation of duties: approver cannot pay own procurement');
});

Deno.test('AC-VPAY-003 SoD-b: the compare keys on the VERIFIED caller id, never a payload field', async () => {
  // Same case, but the verified caller is B (≠ approver A): the gate passes. A payload claiming
  // anything else is irrelevant — the guard never reads one.
  const res = await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE } }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, true);
});

Deno.test('AC-VPAY-003 state: a case NOT at Vendor Invoiced is refused 422 (anyone, approver included)', async () => {
  for (const status of ['Draft', 'Ordered', 'Received', 'Paid']) {
    const res = await enforcePaymentGate(
      fakeClient({ cases: { 'proc-1': { org_id: 'org-1', status, approved_by_id: 'user-a' } } }),
      'org-1',
      status === 'Draft' ? 'user-a' : 'user-b',
      'proc-1',
    );
    assertEquals(res.ok, false, `status ${status} must refuse`);
    assertEquals(res.status, 422);
  }
});

Deno.test('AC-VPAY-003 happy path: a Vendor Invoiced case + caller ≠ approver passes (one case re-read)', async () => {
  const tables: string[] = [];
  const res = await enforcePaymentGate(
    fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE }, onRead: (table) => tables.push(table) }),
    'org-1',
    'user-b',
    'proc-1',
  );
  assertEquals(res.ok, true);
  assertEquals(tables, ['procurements'], 'the gate is exactly one case re-read (NFR-VPAY-001)');
});

Deno.test('AC-VPAY-003 fail closed: a MISSING case row refuses (never a silent pass)', async () => {
  const res = await enforcePaymentGate(fakeClient({ cases: {} }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assert(res.status === 422 || res.status === 404);
});

Deno.test('AC-VPAY-003 fail closed: an unreadable case (DB error) refuses', async () => {
  const res = await enforcePaymentGate(fakeClient({ readError: { code: 'P0001', message: 'boom' } }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assert(res.status !== 200);
});

Deno.test('AC-VPAY-003 fail closed: a cross-org case id is a missing row to this org (org filter in the read)', async () => {
  const reads: Array<Record<string, string>> = [];
  const res = await enforcePaymentGate(
    fakeClient({
      cases: { 'proc-org2': { org_id: 'org-2', status: 'Vendor Invoiced', approved_by_id: 'user-a' } },
      onRead: (_table, filters) => reads.push(filters),
    }),
    'org-1',
    'user-b',
    'proc-org2',
  );
  assertEquals(res.ok, false, 'another org\'s case must be a refusal here, not a pass');
  assertEquals(reads[0]?.org_id, 'org-1', 'the read carries the caller org filter');
});

Deno.test('the gate is keyed on the command: non-payment kinds and other domains pass WITHOUT any DB read', () => {
  const notPayment = { domain: 'procurement', operation: 'create', record: { id: 'x', erp_doc_kind: 'purchase-order' } } as unknown as AdapterCommand;
  const notCreate = { domain: 'procurement', operation: 'transition', record: { id: 'x', erp_doc_kind: 'payment', verb: 'cancel' } } as unknown as AdapterCommand;
  const otherDomain = { domain: 'revenue', operation: 'create', record: { id: 'x', erp_doc_kind: 'payment' } } as unknown as AdapterCommand;
  assertEquals(isProcurementPaymentCreate(notPayment), false);
  assertEquals(isProcurementPaymentCreate(notCreate), false);
  assertEquals(isProcurementPaymentCreate(otherDomain), false);
  assertEquals(isProcurementPaymentCreate(paymentCreate()), true);
});
