// Luna BLOCK A1 [Deno unit] — erpnext-sweep's PAYMENT_TYPE_BY_KIND discriminator map. `payment`
// (Pay/supplier) and `incoming-payment` (Receive/customer) share the ONE `Payment Entry` doctype
// (doctypeRegistry.ts) — the sweep's per-doctype poll (sweepOrgDoctypesLive) MUST discriminate them by
// `payment_type` or a Pay doc can be adopted into `incoming_payments` (a wrong-domain money mirror).
// Proves the map assigns the correct discriminator to exactly the two Payment-Entry-sharing kinds and
// leaves every other kind unfiltered (each already polls its own dedicated doctype).
//
// Verify: cd supabase/functions/erpnext-sweep && deno test paymentTypeByKind.test.ts

// Stub Deno.serve so importing index.ts (top-level Deno.serve) does not bind a port under deno test.
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { PAYMENT_TYPE_BY_KIND } = await import('./index.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test('Luna BLOCK A1: payment (Pay/supplier) discriminates on payment_type=Pay', () => {
  assert(PAYMENT_TYPE_BY_KIND.payment === 'Pay', `expected 'payment' -> 'Pay', got ${String(PAYMENT_TYPE_BY_KIND.payment)}`);
});

Deno.test('Luna BLOCK A1: incoming-payment (Receive/customer) discriminates on payment_type=Receive', () => {
  assert(
    PAYMENT_TYPE_BY_KIND['incoming-payment'] === 'Receive',
    `expected 'incoming-payment' -> 'Receive', got ${String(PAYMENT_TYPE_BY_KIND['incoming-payment'])}`,
  );
});

Deno.test('Luna BLOCK A1: every other kind has NO discriminator (each polls its own dedicated doctype, no shared-doctype ambiguity)', () => {
  const otherKinds = ['purchase-request', 'rfq', 'quotation', 'purchase-order', 'goods-receipt', 'purchase-invoice', 'supplier', 'customer', 'sales-invoice'] as const;
  for (const kind of otherKinds) {
    assert(PAYMENT_TYPE_BY_KIND[kind] === undefined, `expected '${kind}' to have no payment_type discriminator, got ${String(PAYMENT_TYPE_BY_KIND[kind])}`);
  }
});
