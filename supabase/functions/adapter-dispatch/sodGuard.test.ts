// Luna money audit — BLOCK 2: the server-side SI-submit SoD gate, extracted as a pure/testable
// module so the dispatch-path enforcement is unit-provable (the bypass a direct
// dispatchDomainCommand('revenue','transition',{erp_doc_kind:'sales-invoice'}) caller could skip
// must be closed regardless of client). Deno-native test idiom (matches readModelWriters.*.test.ts).
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json sodGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import { isRevenueSiSubmitTransition, enforceSiSubmitSod, requiresSiAuthorClaim, claimSiAuthor, type SodRpcClient } from './sodGuard.ts';

Deno.test('isRevenueSiSubmitTransition: true only for revenue/sales-invoice/transition/submit', () => {
  const yes = (r: Record<string, unknown>) =>
    isRevenueSiSubmitTransition({ domain: 'revenue', operation: 'transition', record: { id: 'si-1', ...r } } as never);
  assert(yes({ erp_doc_kind: 'sales-invoice', verb: 'submit' }), 'revenue SI submit transition must be gated');
  // Not gated (the bypass must be closed ONLY on the submit, not over-gate cancel/amend/other kinds):
  assert(!yes({ erp_doc_kind: 'sales-invoice', verb: 'cancel' }), 'cancel is not the SoD money-commitment step');
  assert(!yes({ erp_doc_kind: 'sales-invoice', verb: 'amend' }), 'amend is not the SoD money-commitment step');
  assert(!yes({ erp_doc_kind: 'sales-invoice' }), 'a transition with no verb is not a submit (adapter rejects it anyway)');
  assert(!yes({ erp_doc_kind: 'incoming-payment', verb: 'submit' }), 'incoming-payment is not a sales-invoice submit');
  assert(!yes({ erp_doc_kind: 'purchase-invoice', verb: 'submit' }), 'procurement invoices are not gated here');
});

Deno.test('isRevenueSiSubmitTransition: false for non-revenue domains / non-transition operations', () => {
  assert(
    !isRevenueSiSubmitTransition({ domain: 'procurement', operation: 'transition', record: { id: 'pi-1', erp_doc_kind: 'purchase-invoice', verb: 'submit' } } as never),
    'procurement domain is not the revenue SI gate',
  );
  assert(
    !isRevenueSiSubmitTransition({ domain: 'revenue', operation: 'create', record: { id: 'si-1', erp_doc_kind: 'sales-invoice' } } as never),
    'a create is not a submit transition',
  );
});

/** A fake deputy client whose .rpc() resolves a scripted {data,error} for the submit_sales_invoice call. */
function fakeClient(result: { data: unknown; error: { code?: string; message: string } | null }): SodRpcClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assertEquals(fn, 'submit_sales_invoice', 'must invoke the SECURITY DEFINER SoD RPC by name');
      assertEquals(args, { p_si_id: 'si-1' }, 'must pass the SI id under the p_si_id arg');
      return result;
    },
  };
}

Deno.test('enforceSiSubmitSod: a 42501 self-approval error → NOT ok, 403 (the bypass is closed — dispatch must NOT submit to ERP)', async () => {
  const res = await enforceSiSubmitSod(
    fakeClient({ data: null, error: { code: '42501', message: 'approver must differ from author (SoD)' } }),
    'si-1',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
});

Deno.test('enforceSiSubmitSod: a non-42501 error → NOT ok, 409 (distinct from the SoD 403)', async () => {
  const res = await enforceSiSubmitSod(
    fakeClient({ data: null, error: { code: 'P0002', message: 'sales invoice not found' } }),
    'si-1',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 409);
});

Deno.test('enforceSiSubmitSod: success (a different approver) → ok, dispatch may proceed', async () => {
  const res = await enforceSiSubmitSod(
    fakeClient({ data: { id: 'si-1' }, error: null }),
    'si-1',
  );
  assertEquals(res.ok, true);
});

// ============================================================================
// SoD DEFECT 2 (TOCTOU) — the pre-ERP AUTHOR CLAIM.
//
// The submit SoD ran BEFORE the ERP body was built and the author was recorded only AFTER (in the
// read-model writer, post-ERP). So an approver could issue an `update` that rewrote the amount and,
// concurrently, a `submit`: the submit's check read the authorship as it stood BEFORE the rewrite,
// passed, and the rewrite then landed the approver's own numbers under the approver's own approval.
//
// The fix serializes both halves on the invoice row IN THE DB: a body-rewriting command must first
// CLAIM authorship (`claim_sales_invoice_author`, which takes `for update` on the invoice and refuses
// while a submit authorization is outstanding), and the submit RPC records that authorization under
// the same lock. Whichever wins the lock, the loser is refused — BEFORE any ERP call.
// ============================================================================

Deno.test('requiresSiAuthorClaim: true for the revenue sales-invoice writes that REBUILD the ERP body on an existing invoice', () => {
  const yes = (operation: string, r: Record<string, unknown>) =>
    requiresSiAuthorClaim({ domain: 'revenue', operation, record: { id: 'si-1', ...r } } as never);
  assert(yes('update', { erp_doc_kind: 'sales-invoice', items: [{ rate: 1 }] }), 'an update rebuilds the body — it sets the money');
  assert(yes('transition', { erp_doc_kind: 'sales-invoice', verb: 'amend' }), 'an amend rebuilds the body — it sets the money');
});

Deno.test('requiresSiAuthorClaim: false for writes that build no body, other kinds/domains, and create', () => {
  const no = (domain: string, operation: string, r: Record<string, unknown>) =>
    requiresSiAuthorClaim({ domain, operation, record: { id: 'si-1', ...r } } as never);
  assert(!no('revenue', 'transition', { erp_doc_kind: 'sales-invoice', verb: 'submit' }), 'submitting is not authoring');
  assert(!no('revenue', 'transition', { erp_doc_kind: 'sales-invoice', verb: 'cancel' }), 'cancelling builds no body');
  assert(
    !no('revenue', 'create', { erp_doc_kind: 'sales-invoice', items: [{ rate: 1 }] }),
    'a create has no PMO invoice row to lock yet — the mirror writer records its author (no submit can race a row that does not exist)',
  );
  assert(!no('revenue', 'update', { erp_doc_kind: 'incoming-payment' }), 'a payment is not a sales-invoice body');
  assert(!no('procurement', 'update', { erp_doc_kind: 'purchase-invoice', items: [{ rate: 1 }] }), 'procurement is not gated here');
});

/** A fake deputy client scripting the claim RPC. */
function fakeClaimClient(result: { data: unknown; error: { code?: string; message: string } | null }): SodRpcClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assertEquals(fn, 'claim_sales_invoice_author', 'must invoke the SECURITY DEFINER claim RPC by name');
      assertEquals(args, { p_si_id: 'si-1' }, 'must pass the SI id under the p_si_id arg');
      return result;
    },
  };
}

Deno.test('claimSiAuthor: an outstanding submit authorization (55006) → NOT ok, 409 si-submit-in-progress (the body rewrite never reaches ERP)', async () => {
  const res = await claimSiAuthor(
    fakeClaimClient({ data: null, error: { code: '55006', message: 'a submit authorization is outstanding for this sales invoice' } }),
    'si-1',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 409);
  assertEquals(res.message, 'si-submit-in-progress');
});

Deno.test('claimSiAuthor: a 42501 (not a member / wrong role / cross-org) → NOT ok, 403', async () => {
  const res = await claimSiAuthor(fakeClaimClient({ data: null, error: { code: '42501', message: 'not authorized' } }), 'si-1');
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
});

Deno.test('claimSiAuthor: success → ok (authorship is recorded BEFORE the ERP body write, so a later submit by this caller is self-approval)', async () => {
  const res = await claimSiAuthor(fakeClaimClient({ data: null, error: null }), 'si-1');
  assertEquals(res.ok, true);
  assertEquals(res.status, 200);
});
