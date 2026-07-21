// Luna money audit — BLOCK 2: the server-side SI-submit SoD gate, extracted as a pure/testable
// module so the dispatch-path enforcement is unit-provable (the bypass a direct
// dispatchDomainCommand('revenue','transition',{erp_doc_kind:'sales-invoice'}) caller could skip
// must be closed regardless of client). Deno-native test idiom (matches readModelWriters.*.test.ts).
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json sodGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import { isRevenueSiSubmitTransition, grantSiSubmitClearance, requiresSiAuthorClaim, claimSiAuthor, releaseSiSubmitClearance, type SodRpcClient } from './sodGuard.ts';

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

/**
 * A fake SERVICE-ROLE client scripting the clearance-grant RPC.
 *
 * Round-7 B1b: the gate is no longer `submit_sales_invoice` under the caller's JWT. That RPC records no
 * clearance any more (it would be a freeze primitive any authenticated Admin/Finance member could aim at
 * a draft), and the clearance it used to record was releasable by the very approver it constrains. The
 * authoritative gate is the SERVICE-ROLE-ONLY `grant_sales_invoice_submit_clearance`, which authorizes
 * an EXPLICIT actor (service_role has no `auth.uid()`) and mints a clearance the dispatch alone can
 * release, by id.
 */
function fakeGrantClient(result: { data: unknown; error: { code?: string; message: string } | null }): SodRpcClient {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      assertEquals(fn, 'grant_sales_invoice_submit_clearance', 'must invoke the dispatch-only clearance RPC by name');
      assertEquals(
        args,
        { p_si_id: 'si-1', p_actor_id: 'user-b', p_clearance_id: 'clr-1' },
        'must pass the SI id, the JWT-verified ACTOR, and this dispatch\'s clearance id',
      );
      return result;
    },
  };
}

Deno.test('grantSiSubmitClearance: a 42501 self-approval error → NOT ok, 403 (the bypass is closed — dispatch must NOT submit to ERP)', async () => {
  const res = await grantSiSubmitClearance(
    fakeGrantClient({ data: null, error: { code: '42501', message: 'approver must differ from author (SoD)' } }),
    'si-1',
    'user-b',
    'clr-1',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 403);
});

Deno.test('grantSiSubmitClearance: a non-42501 error → NOT ok, 409 (distinct from the SoD 403)', async () => {
  const res = await grantSiSubmitClearance(
    fakeGrantClient({ data: null, error: { code: 'P0002', message: 'sales invoice not found' } }),
    'si-1',
    'user-b',
    'clr-1',
  );
  assertEquals(res.ok, false);
  assertEquals(res.status, 409);
});

Deno.test('grantSiSubmitClearance: success (a different approver) → ok, dispatch may proceed', async () => {
  const res = await grantSiSubmitClearance(fakeGrantClient({ data: { id: 'si-1' }, error: null }), 'si-1', 'user-b', 'clr-1');
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

// ════════════════════════════════════════════════════════════════════════════
// Round-7 cross-family audit, B1b/B1c — RELEASING the submit clearance.
//
// The clearance's side effect is that `claim_sales_invoice_author` raises 55006, refusing EVERY body
// rewrite. It must therefore be released as soon as the dispatch it protects resolves — otherwise
// Finance is frozen out of correcting the amount for the whole (now 30-minute) TTL.
//
// But WHO may release it is the security question. The first cut fenced the release to the grantee
// (`user_id = auth.uid()`) and exposed it to `authenticated` — and the attacker IS the grantee, so the
// very approver the clearance constrains could release it mid-submit and rewrite the body their own
// in-flight submit was about to commit. The release is now fenced to the CLEARANCE ID the granting
// dispatch minted, on a service-role-only RPC: neither the constrained party nor a SECOND concurrent
// submit can lift a still-outstanding freeze.
//
// Best-effort by construction: the freeze has a TTL backstop, so a failed release must never turn a
// RESOLVED money dispatch into a client-visible error.
// ════════════════════════════════════════════════════════════════════════════

/** A fake service-role client scripting the release RPC, recording what it was asked. */
function fakeReleaseClient(result: { data: unknown; error: { code?: string; message: string } | null }) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client: SodRpcClient = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return result;
    },
  };
  return { client, calls };
}

Deno.test('releaseSiSubmitClearance: releases by CLEARANCE ID — the dispatch\'s own grant, not "whatever clearance this user holds"', async () => {
  const { client, calls } = fakeReleaseClient({ data: null, error: null });

  const released = await releaseSiSubmitClearance(client, 'si-1', 'clr-1');

  assertEquals(released, true);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].fn, 'release_sales_invoice_submit_clearance');
  // The id is what fences it: a concurrent submit's clearance carries a different id and survives.
  assertEquals(calls[0].args, { p_si_id: 'si-1', p_clearance_id: 'clr-1' });
});

Deno.test('releaseSiSubmitClearance: a failing release is swallowed (the TTL is the backstop — never fail a resolved money dispatch)', async () => {
  const { client } = fakeReleaseClient({ data: null, error: { code: '42501', message: 'not authorized' } });
  const originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const released = await releaseSiSubmitClearance(client, 'si-1', 'clr-1');
    assertEquals(released, false, 'the caller learns it failed…');
    assert(logs.length === 1, '…and it is observable in the function logs, never silent');
  } finally {
    console.error = originalError;
  }
});

Deno.test('releaseSiSubmitClearance: is only ever driven for the command that took a clearance', () => {
  // The clearance is taken ONLY by `isRevenueSiSubmitTransition` commands — the same predicate the
  // dispatch uses to decide whether to release, so the two can never drift apart.
  assert(
    isRevenueSiSubmitTransition({ domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'submit' } } as never),
  );
  assert(
    !isRevenueSiSubmitTransition({ domain: 'revenue', operation: 'transition', record: { id: 'si-1', erp_doc_kind: 'sales-invoice', verb: 'cancel' } } as never),
    'a cancel never took a clearance, so it must never release one',
  );
});
