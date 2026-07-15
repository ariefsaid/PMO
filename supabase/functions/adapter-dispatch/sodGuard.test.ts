// Luna money audit — BLOCK 2: the server-side SI-submit SoD gate, extracted as a pure/testable
// module so the dispatch-path enforcement is unit-provable (the bypass a direct
// dispatchDomainCommand('revenue','transition',{erp_doc_kind:'sales-invoice'}) caller could skip
// must be closed regardless of client). Deno-native test idiom (matches readModelWriters.*.test.ts).
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-all --config deno.json sodGuard.test.ts

import { assertEquals, assert } from 'jsr:@std/assert';
import { isRevenueSiSubmitTransition, enforceSiSubmitSod, type SodRpcClient } from './sodGuard.ts';

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
