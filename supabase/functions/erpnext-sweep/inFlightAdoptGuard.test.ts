// BLOCK 1 [Deno unit] — the doctype poll must NEVER pull-adopt a doc that a PMO-originated, still
// unresolved outbox command is responsible for.
//
// The hazard (deterministic, not a rare race): the quarantine window (300 s, migration 0096) is >= the
// sweep interval (300 s, migration 0102), so a poll ALWAYS lands inside the window of a lost-response
// commit. The doctype poll saw the committed doc, `findPmoRecordId` returned null (the outbox had not
// finalized its `external_refs` yet) and it PULL-ADOPTED: a SECOND PMO row for the ONE ERP document
// (revenue double-counted), while the outbox's own recovery later tried to map the same ERP name to the
// ORIGINAL pmo id — which the `unique (org_id, domain, external_record_id)` constraint (0093) then
// rejects with 23505, wedging that money row at `committed` forever.
//
// The fix proven here: before adopting, the poll refuses any doc whose ANCHOR field carries an
// idempotency key belonging to a NON-CONFIRMED outbox row of this org. Those docs are the outbox's to
// finalize (exactly one PMO row, ADR-0058 §4) — the poll re-surfaces them on a later tick if needed.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test inFlightAdoptGuard.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepFieldsForKind, inFlightAnchorFilter } = await import('./index.ts');
import { DOCTYPE_REGISTRY } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/doctypeRegistry.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const KEY = '5f7d2b1e-0c3a-4a9e-9f10-2b6c8d4e1a77';

Deno.test('BLOCK 1: the poll fetches the kind\'s recovery ANCHOR field (without it the guard is blind)', () => {
  // Sales Invoice anchors on `remarks`; the Payment Entry kinds on `reference_no`.
  assert(sweepFieldsForKind('sales-invoice').includes('remarks'), 'sales-invoice poll must fetch remarks');
  assert(sweepFieldsForKind('purchase-invoice').includes('remarks'), 'purchase-invoice poll must fetch remarks');
  assert(sweepFieldsForKind('incoming-payment').includes('reference_no'), 'incoming-payment poll must fetch reference_no');
  assert(sweepFieldsForKind('payment').includes('reference_no'), 'payment poll must fetch reference_no');
  // An anchor-less kind adds nothing (no phantom field in the list query — Frappe rejects unknown fields).
  assert(DOCTYPE_REGISTRY.rfq.anchorField === null, 'precondition: rfq has no anchor');
  assert(sweepFieldsForKind('rfq').length === new Set(sweepFieldsForKind('rfq')).size, 'no duplicate fields');
});

Deno.test('BLOCK 1: a doc stamped with an in-flight outbox key is NOT adopted by the poll', () => {
  const filter = inFlightAnchorFilter('sales-invoice', new Set([KEY]));
  assert(filter !== undefined, 'a kind with an anchor + in-flight keys must produce a filter');
  assert(
    filter!({ name: 'ACC-SINV-2026-00001', remarks: KEY }) === false,
    'a doc carrying an in-flight idempotency key must be skipped (the outbox owns it)',
  );
});

Deno.test('BLOCK 1: an unrelated / native ERP doc is still adopted', () => {
  const filter = inFlightAnchorFilter('sales-invoice', new Set([KEY]));
  assert(filter!({ name: 'ACC-SINV-2026-00002', remarks: 'Invoice for June services' }) === true, 'a native doc must still be adopted');
  assert(filter!({ name: 'ACC-SINV-2026-00003', remarks: null }) === true, 'an empty anchor must still be adopted');
  assert(
    filter!({ name: 'ACC-SINV-2026-00004', remarks: 'e2ff8b6c-0000-4000-8000-000000000000' }) === true,
    'a CONFIRMED (or foreign) key is not in the in-flight set — its doc is already mapped, adopt normally',
  );
});

Deno.test('BLOCK 1: the key is matched inside a longer anchor value (the stamp is appended, ADR-0058 §3)', () => {
  const filter = inFlightAnchorFilter('incoming-payment', new Set([KEY]));
  assert(filter!({ name: 'ACC-PE-2026-1', reference_no: `PMO ${KEY}` }) === false, 'a key embedded in the anchor value must still match');
});

Deno.test('BLOCK 1: no guard when there is nothing in flight, or the kind has no anchor', () => {
  assert(inFlightAnchorFilter('sales-invoice', new Set()) === undefined, 'an empty in-flight set needs no filter (byte-for-byte poll)');
  assert(inFlightAnchorFilter('rfq', new Set([KEY])) === undefined, 'an anchor-less kind cannot be guarded (nothing to read)');
});

Deno.test('BLOCK 1: the guard composes with the payment_type discriminator (BLOCK A1 must survive)', () => {
  const filter = inFlightAnchorFilter('incoming-payment', new Set([KEY]), (row) => row.payment_type === 'Receive');
  // Both conditions must hold for a row to be emitted.
  assert(filter!({ payment_type: 'Receive', reference_no: 'native-ref' }) === true, 'a native Receive PE is adopted');
  assert(filter!({ payment_type: 'Pay', reference_no: 'native-ref' }) === false, 'a Pay PE is still excluded from the Receive poll');
  assert(filter!({ payment_type: 'Receive', reference_no: KEY }) === false, 'an in-flight Receive PE is excluded');
});
