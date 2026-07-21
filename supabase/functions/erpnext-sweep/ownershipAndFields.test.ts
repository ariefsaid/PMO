// Luna re-audit BLOCKs 9 + 6 [Deno unit] — the SWEEP's two inbound-adoption defects.
//
//  • BLOCK 9 — the sweep polled EVERY doctype for EVERY activated ERPNext binding, without ever asking
//              whether that org actually assigned the domain to the tier (`external_domain_ownership`).
//              A procurement-only org was therefore handed native Sales Invoice / Receive Payment Entry
//              mirrors and surfaced them in its revenue read model — data it never opted into.
//  • BLOCK 6 — the poll fetched ONLY the lifecycle fields (name/modified/docstatus/amended_from) while
//              `siFromDoc`/`peReceiveFromDoc` consume customer, date, amount, outstanding and the PE's
//              `references` child table. Every sweep-adopted invoice therefore entered the PMO revenue
//              rollup with amount = NULL / outstanding = NULL.
//
// Verify: cd supabase/functions/erpnext-sweep && deno test ownershipAndFields.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepKindsForOrg, sweepFieldsForKind, KINDS_NEEDING_FULL_DOC } = await import('./index.ts');
import { SI_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/salesInvoice.ts';
import { PE_RECEIVE_FROM_DOC_FIELDS } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/bodies/incomingPayment.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── BLOCK 9 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 9: a procurement-only org sweeps NO revenue doctype (no unowned Sales Invoice / Receive PE adoption)', () => {
  const kinds = sweepKindsForOrg(['procurement', 'companies']).map((k) => k.kind);
  assert(!kinds.includes('sales-invoice'), 'a procurement-only org must never poll Sales Invoice');
  assert(!kinds.includes('incoming-payment'), 'a procurement-only org must never poll Receive Payment Entry');
  assert(kinds.includes('purchase-invoice'), 'the procurement doctypes it DOES own must still be polled');
  assert(kinds.includes('supplier'), 'the companies doctypes it DOES own must still be polled');
});

Deno.test('BLOCK 9: an org owning revenue sweeps the revenue doctypes', () => {
  const kinds = sweepKindsForOrg(['revenue']).map((k) => k.kind);
  assert(kinds.includes('sales-invoice'), 'expected Sales Invoice to be polled for a revenue-owning org');
  assert(kinds.includes('incoming-payment'), 'expected Receive Payment Entry to be polled for a revenue-owning org');
  assert(!kinds.includes('purchase-invoice'), 'expected no procurement poll for a revenue-only org');
});

Deno.test('BLOCK 9: an org owning NO domain sweeps nothing (fail-closed)', () => {
  assert(sweepKindsForOrg([]).length === 0, 'expected an org with no domain ownership to poll nothing at all');
});

// ── BLOCK 6 ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('BLOCK 6: the Sales Invoice poll fetches every field siFromDoc consumes (no NULL money in the rollup)', () => {
  const fields = sweepFieldsForKind('sales-invoice');
  for (const required of ['customer', 'posting_date', 'grand_total', 'outstanding_amount', 'po_no']) {
    assert(fields.includes(required), `expected the SI poll to fetch '${required}', got ${JSON.stringify(fields)}`);
  }
  for (const required of SI_FROM_DOC_FIELDS) {
    assert(fields.includes(required), `the SI poll must fetch every field its mapper reads — missing '${required}'`);
  }
});

Deno.test('BLOCK 6: the Receive-PE poll fetches every field peReceiveFromDoc consumes, and keeps its payment_type discriminator', () => {
  const fields = sweepFieldsForKind('incoming-payment');
  for (const required of ['party', 'posting_date', 'paid_amount', 'reference_no', 'payment_type']) {
    assert(fields.includes(required), `expected the Receive-PE poll to fetch '${required}', got ${JSON.stringify(fields)}`);
  }
  for (const required of PE_RECEIVE_FROM_DOC_FIELDS) {
    assert(fields.includes(required), `the Receive-PE poll must fetch every field its mapper reads — missing '${required}'`);
  }
});

Deno.test('BLOCK 6: every kind still fetches the lifecycle routing fields the lineage apply needs', () => {
  for (const kind of ['sales-invoice', 'incoming-payment', 'purchase-invoice', 'supplier'] as const) {
    const fields = sweepFieldsForKind(kind);
    for (const required of ['name', 'modified', 'docstatus']) {
      assert(fields.includes(required), `kind ${kind} must still fetch '${required}'`);
    }
  }
});

Deno.test("BLOCK 6: the Receive PE is marked as needing a full-doc read (its `references` child table is not a list-endpoint field)", () => {
  assert(
    KINDS_NEEDING_FULL_DOC.includes('incoming-payment'),
    'the SI link lives in the PE `references` CHILD TABLE, which the list endpoint does not return — the poll must hydrate the full doc',
  );
  assert(!KINDS_NEEDING_FULL_DOC.includes('sales-invoice'), 'the SI needs no child table — a list read suffices (no needless N+1)');
});
