// #910 (FR-VPAY-005, DD-VPAY-5, AC-VPAY-003) — the vendor-payment money gate, unit-provable here so
// index.ts stays integration-only (the sodGuard.ts/approvalGuard.ts module shape).
//
// On a flipped org the dispatched Payment Entry IS the money release: `transition_procurement`'s
// SoD-b (approver ≠ payer, 0006_procurement_lifecycle.sql:222-225) never runs on that path, and the
// served gate is role-only (authGuard.ts). So a procurement `payment` create re-reads the CASE from
// the DB — the payload is never trusted — and refuses:
//   • 403 (0006's exact SoD-b wording) when the caller IS the case's approver;
//   • 422 `purchase_closed` when the case is Cancelled or Rejected. Any other step may be paid (#1319, owner AC-1:
//     a purchase can start at any step, payment included); the org's purchase gates (approval_before_payment)
//     are asked upstream by procurementGateGuard.ts through procurement_gate_violation;
//   • the approved-amount ceiling only when an approval exists (owner AC-3: no approval = nothing to compare);
//   • fail closed when the case row cannot be read (the approvalGuard posture — a gate that cannot
//     evaluate refuses, money-path primer bucket "fail closed").
// Non-payment kinds and other domains pass WITHOUT any DB read (the gate is keyed on the command).
//
// Mutation contract (the money-path binding rule): breaking the approver compare in the guard (e.g.
// an always-allow) turns `SoD-b` tests below RED. Verified 2026-10-08 — see the build report.
//
// Verify: cd supabase/functions/adapter-dispatch && deno test paymentGate.test.ts --config deno.json --allow-env --allow-net --allow-read

import { assert, assertEquals } from '@std/assert';
import { enforcePaymentGate, isProcurementPaymentCreate, type PaymentGateClient } from './paymentGate.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';

/** Fake seam: the `procurements` re-read the guard decides on. Rows carry their real org_id so a
 *  cross-org id is distinguishable from a same-org one by the id alone (the Luna B2 fixture rule). */
function fakeClient(opts: {
  cases?: Record<string, { org_id: string; status: string; approved_by_id: string | null; amount_approved_by_id?: string | null; approved_total_value?: number | null }>;
  readError?: { code: string; message: string };
  ceiling?: { ok: boolean; reason: string | null; billed_net: number | null; approved_amount: number | null };
  /** The ceiling rows as returned (an empty array = the helper returned no row). */
  ceilingRows?: Array<{ ok: boolean; reason: string | null; billed_net: number | null; approved_amount: number | null }>;
  ceilingError?: { message: string };
  onRpc?: (fn: string, args: Record<string, unknown>) => void;
  onRead?: (table: string, filters: Record<string, string>) => void;
}): PaymentGateClient {
  return {
    rpc: (fn: string, args: Record<string, unknown>) => {
      opts.onRpc?.(fn, args);
      if (opts.ceilingError) return Promise.resolve({ data: null, error: opts.ceilingError });
      return Promise.resolve({ data: opts.ceilingRows ?? [opts.ceiling ?? { ok: true, reason: null, billed_net: 1000, approved_amount: 1000 }], error: null });
    },
    from: (table: string) => ({
      select: (columns: string) => {
        const filters: Record<string, string> = {};
        const builder = {
          eq(column: string, value: string) {
            filters[column] = value;
            return builder;
          },
          maybeSingle() {
            return Promise.resolve(this.read());
          },
          read() {
            opts.onRead?.(table, filters);
            if (opts.readError) return { data: null, error: opts.readError };
            if (table !== 'procurements') return { data: null, error: null };
            const row = (opts.cases ?? {})[filters.id];
            // The real read is org-scoped: a row from another org is NOT returned (RLS posture).
            if (!row || row.org_id !== filters.org_id) return { data: null, error: null };
            // PostgREST returns only the selected columns — a column the guard forgets to select reads as absent.
            const picked = Object.fromEntries(columns.split(',').map((c) => c.trim()).filter((c) => c in row).map((c) => [c, (row as Record<string, unknown>)[c]]));
            return { data: picked, error: null };
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

const VENDOR_INVOICED_CASE = { org_id: 'org-1', status: 'Vendor Invoiced', approved_by_id: 'user-a', approved_total_value: 1000 };

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

Deno.test('AC-PFE-001 (owner AC-1): a payment may be recorded at any step — no Vendor Invoiced requirement', async () => {
  for (const status of ['Draft', 'Requested', 'Approved', 'Quote Selected', 'Ordered', 'Received', 'Vendor Invoiced', 'Paid']) {
    const res = await enforcePaymentGate(
      fakeClient({ cases: { 'proc-1': { ...VENDOR_INVOICED_CASE, status } } }), 'org-1', 'user-b', 'proc-1');
    assertEquals(res, { ok: true, status: 200, message: '' }, `status ${status} must allow a payment`);
  }
});

Deno.test('AC-PFE-001: a closed purchase (Cancelled / Rejected) is refused 422 purchase_closed', async () => {
  for (const status of ['Cancelled', 'Rejected']) {
    const res = await enforcePaymentGate(
      fakeClient({ cases: { 'proc-1': { ...VENDOR_INVOICED_CASE, status } } }), 'org-1', 'user-b', 'proc-1');
    assertEquals(res, { ok: false, status: 422, message: 'purchase_closed' }, `status ${status} must refuse`);
  }
});

Deno.test('AC-PFE-003 (owner AC-3): no recorded approval — the payment passes and the ceiling is not asked', async () => {
  const calls: string[] = [];
  const res = await enforcePaymentGate(
    fakeClient({
      cases: { 'proc-1': { org_id: 'org-1', status: 'Draft', approved_by_id: null, approved_total_value: null } },
      ceiling: { ok: false, reason: 'approved amount is missing', billed_net: 1000, approved_amount: null },
      onRpc: (fn) => calls.push(fn),
    }),
    'org-1', 'user-b', 'proc-1');
  assertEquals(res, { ok: true, status: 200, message: '' });
  assertEquals(calls, [], 'nothing to compare against — the ceiling helper is not called');
});

Deno.test('FR-PFE-017: an approver recorded without an approved amount still asks the ceiling (and its refusal stands)', async () => {
  const calls: string[] = [];
  const res = await enforcePaymentGate(
    fakeClient({
      cases: { 'proc-1': { org_id: 'org-1', status: 'Ordered', approved_by_id: 'user-a', approved_total_value: null } },
      ceiling: { ok: false, reason: 'approved amount is missing', billed_net: 1000, approved_amount: null },
      onRpc: (fn) => calls.push(fn),
    }),
    'org-1', 'user-b', 'proc-1');
  assertEquals(res, { ok: false, status: 422, message: 'vendor payment: approved amount is missing' });
  assertEquals(calls, ['procurement_payment_within_ceiling']);
});

Deno.test('FR-PFE-016: approver ≠ payer applies at any step, not only at Vendor Invoiced', async () => {
  const res = await enforcePaymentGate(
    fakeClient({ cases: { 'proc-1': { ...VENDOR_INVOICED_CASE, status: 'Ordered' } } }), 'org-1', 'user-a', 'proc-1');
  assertEquals(res, { ok: false, status: 403, message: 'separation of duties: approver cannot pay own procurement' });
});

Deno.test('FR-PFE-016: SoD-b holds whenever ANY approval is recorded — an amount approver alone still cannot pay', async () => {
  const res = await enforcePaymentGate(
    fakeClient({ cases: { 'proc-1': { org_id: 'org-1', status: 'Draft', approved_by_id: null, approved_total_value: null, amount_approved_by_id: 'user-c' } } }),
    'org-1', 'user-c', 'proc-1');
  assertEquals(res, { ok: false, status: 403, message: 'separation of duties: approver cannot pay own procurement' });
});

Deno.test('AC-SEC-206: an approved amount with no approver id still asks the ceiling', async () => {
  const calls: string[] = [];
  const res = await enforcePaymentGate(
    fakeClient({
      cases: { 'proc-1': { org_id: 'org-1', status: 'Ordered', approved_by_id: null, approved_total_value: 1000 } },
      ceiling: { ok: false, reason: 'vendor bill exceeds approved amount', billed_net: 1200, approved_amount: 1000 },
      onRpc: (fn) => calls.push(fn),
    }),
    'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(calls, ['procurement_payment_within_ceiling']);
});

Deno.test('AC-SEC-206: over-ceiling ERP payment is refused before dispatch can enqueue it', async () => {
  const res = await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE }, ceiling: { ok: false, reason: 'vendor bill exceeds approved amount', billed_net: 1200, approved_amount: 1000 } }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
  assert(res.message.includes('vendor bill exceeds approved amount'));
});

Deno.test('AC-SEC-206: the ceiling is read through the shared SQL helper for the gated procurement', async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE }, onRpc: (fn, args) => calls.push([fn, args]) }), 'org-1', 'user-b', 'proc-1');
  assertEquals(calls, [['procurement_payment_within_ceiling', { p_procurement_id: 'proc-1' }]]);
});

Deno.test('AC-SEC-206 fail closed: a ceiling that returns no row refuses', async () => {
  const res = await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE }, ceilingRows: [] }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('AC-SEC-206 fail closed: a ceiling read error refuses', async () => {
  const res = await enforcePaymentGate(fakeClient({ cases: { 'proc-1': VENDOR_INVOICED_CASE }, ceilingError: { message: 'boom' } }), 'org-1', 'user-b', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 422);
});

Deno.test('AC-SEC-211: the approver of a raised amount cannot dispatch its payment', async () => {
  const res = await enforcePaymentGate(
    fakeClient({ cases: { 'proc-1': { ...VENDOR_INVOICED_CASE, amount_approved_by_id: 'user-c' } } }),
    'org-1', 'user-c', 'proc-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
  assertEquals(res.message, 'separation of duties: approver cannot pay own procurement');
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
  assertEquals(res, { ok: false, status: 422, message: 'purchase_not_found' }, 'the database reason code (procurement_gate_violation)');
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
