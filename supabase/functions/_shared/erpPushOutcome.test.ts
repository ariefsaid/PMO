import { assert, assertEquals } from 'jsr:@std/assert@1';
import { emitErpPushOutcome, stableOutcomeCode } from './erpPushOutcome.ts';
import { SERVER_EVENT_ALLOWLIST } from './posthogServer.ts';

Deno.test('stableOutcomeCode keeps a code token and never ERP text', () => {
  assertEquals(stableOutcomeCode('external-unreachable: connect ECONNREFUSED erp.client.example.com'), 'external-unreachable');
  assertEquals(stableOutcomeCode('recovery-inconclusive-absence: mutable anchor cannot prove non-commit'), 'recovery-inconclusive-absence');
  assertEquals(stableOutcomeCode('Invoice ACC-SINV-0001 for PT Contoh is wrong'), 'unclassified'); // no leading code token
  assertEquals(stableOutcomeCode(undefined), 'unclassified');
  assertEquals(stableOutcomeCode('commit-rejected: ACC-SINV-0001 invalid'), 'commit-rejected');
  assertEquals(stableOutcomeCode('destination_not_permitted: host not allowed'), 'destination_not_permitted');
  assertEquals(stableOutcomeCode('recovery-probe-failed: x'), 'recovery-probe-failed');
  // a lowercase word is not a known code: it must not leave the edge
  assertEquals(stableOutcomeCode('acme-holdings: wrong'), 'unclassified');
  assertEquals(stableOutcomeCode('pt-contoh: wrong'), 'unclassified');
});

Deno.test('AC-PHO-030 payload has no amount, name or ERP id keys', async () => {
  // deno-lint-ignore no-explicit-any
  const sent: any[] = [];
  const orig = globalThis.fetch;
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  try {
    await emitErpPushOutcome({
      tier: 'erpnext', domain: 'revenue', operation: 'create', outcome: 'failed',
      errorCode: stableOutcomeCode('commit-rejected: ACC-SINV-0001 PT Contoh 1500000'),
      attemptCount: 2, durationMs: 40, orgId: 'org-1', outboxId: 'ob-1',
    });
    assertEquals(sent.length, 1);
    assertEquals(sent[0].event, 'erp_push_outcome');
    assertEquals(sent[0].distinct_id, 'edge:money-outbox');
    const { $process_person_profile: _p, ...props } = sent[0].properties;
    for (const k of Object.keys(props)) assert(SERVER_EVENT_ALLOWLIST.erp_push_outcome.has(k), `unexpected key ${k}`);
    assertEquals(props.error_code, 'commit-rejected');
    assertEquals(props.needs_human, false);
    const body = JSON.stringify(sent[0]);
    for (const leak of ['ACC-', 'PT Contoh', '1500000']) assert(!body.includes(leak), `leaked ${leak}`);
  } finally {
    globalThis.fetch = orig;
    Deno.env.delete('POSTHOG_PROJECT_KEY');
  }
});
