// #1532 S4 — erp_push_outcome is emitted by the SHIPPED outbox write-backs (createDbMoneyOutboxDeps), once per
// transition THIS call made, and never changes what a write-back returns (NFR-PHO-REL-001).
// Verify: cd supabase/functions/adapter-dispatch && deno test moneyOutboxDeps.pushOutcome.test.ts --config deno.json --allow-env --allow-net --allow-read
import { assert, assertEquals } from '@std/assert';
import { createDbMoneyOutboxDeps, type OutboxServiceClient } from './moneyOutboxDeps.ts';

const ROW = {
  id: 'ob-1', domain: 'revenue', pmo_record_id: 'rec-1', idempotency_key: 'k-1', state: 'committing',
  external_record_id: null, canonical: null, claim_generation: 7, payload_digest: null, attempt_count: 2,
};

/** Scripted fake: `rpc` answers per function name (queue), the failed-mark update answers `updateRows` (queue). */
function fakeClient(rpc: Record<string, unknown[]>, updateRows: unknown[][] = []): OutboxServiceClient {
  const chain = {
    eq: () => chain,
    select: () => Promise.resolve({ data: updateRows.shift() ?? [], error: null }),
  };
  return {
    rpc: (fn: string) => Promise.resolve({ data: rpc[fn]?.shift() ?? null, error: null }),
    from: () => ({
      select: () => { throw new Error('not used'); },
      insert: () => { throw new Error('not used'); },
      update: () => chain,
    }),
  } as unknown as OutboxServiceClient;
}

function deps(client: OutboxServiceClient) {
  return createDbMoneyOutboxDeps({
    serviceClient: client, orgId: 'org-1', externalTier: 'erpnext', operation: 'create',
    probeByRemarksKey: () => Promise.resolve(null),
  });
}

type Mode = 'ok' | 'reject' | 'throw' | 'hang';
// deno-lint-ignore no-explicit-any
async function withPosthog(mode: Mode, fn: (sent: any[]) => Promise<void>) {
  // deno-lint-ignore no-explicit-any
  const sent: any[] = [];
  const orig = globalThis.fetch;
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_t');
  globalThis.fetch = ((_u: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    if (mode === 'throw') throw new Error('sync boom');
    if (mode === 'reject') return Promise.reject(new Error('down'));
    if (mode === 'hang') return new Promise(() => {});
    return Promise.resolve(new Response('{}'));
  }) as typeof fetch;
  try { await fn(sent); } finally { globalThis.fetch = orig; Deno.env.delete('POSTHOG_PROJECT_KEY'); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

Deno.test('AC-PHO-030 each transition this call made emits one erp_push_outcome with its domain and attempt count', () => withPosthog('ok', async (sent) => {
  const d = deps(fakeClient({
    claim_outbox_for_commit: [ROW, ROW, ROW],
    confirm_outbox: [1],
    mark_outbox_held: [1],
    quarantine_committing: [{ ...ROW, state: 'quarantined' }],
  }, [[{ id: 'ob-1' }]]));

  await d.claimOutboxForCommit('ob-1');
  assertEquals(await d.confirmOutbox('ob-1', 7), 1);
  await d.claimOutboxForCommit('ob-1');
  assertEquals(await d.markOutboxFailed('ob-1', 'external-unreachable: connect ECONNREFUSED erp.example', 7), 1);
  await d.claimOutboxForCommit('ob-1');
  assertEquals(await d.markOutboxHeld('ob-1', 'recovery-inconclusive-absence: mutable anchor cannot prove non-commit', 7), 1);
  assertEquals((await d.quarantineCommitting('ob-1'))?.state, 'quarantined');
  await tick();

  assertEquals(sent.map((s) => s.properties.outcome), ['confirmed', 'failed', 'held', 'quarantined']);
  for (const s of sent) {
    assertEquals(s.event, 'erp_push_outcome');
    assertEquals(s.distinct_id, 'edge:money-outbox');
    assertEquals(s.properties.domain, 'revenue');
    assertEquals(s.properties.tier, 'erpnext');
    assertEquals(s.properties.operation, 'create');
    assertEquals(s.properties.org_id, 'org-1');
    assertEquals(s.properties.outbox_id, 'ob-1');
    assertEquals(s.properties.attempt_count, 2);
  }
  assertEquals(sent[1].properties.error_code, 'external-unreachable');
  assertEquals(sent[2].properties.error_code, 'recovery-inconclusive-absence');
  const body = JSON.stringify(sent);
  assert(!body.includes('ECONNREFUSED') && !body.includes('erp.example'), 'ERP error text leaked');
}));

Deno.test('AC-PHO-031 a write-back that changed nothing emits nothing; finalize twice (1 then 0) emits once', () => withPosthog('ok', async (sent) => {
  const d = deps(fakeClient({
    claim_outbox_for_commit: [ROW],
    confirm_outbox: [1, 0],
    mark_outbox_held: [0],
    quarantine_committing: [null],
  }, [[]]));
  await d.claimOutboxForCommit('ob-1');
  assertEquals(await d.confirmOutbox('ob-1', 7), 1);
  assertEquals(await d.confirmOutbox('ob-1', 7), 0);
  assertEquals(await d.markOutboxHeld('ob-1', 'recovery-probe-failed: x', 7), 0);
  assertEquals(await d.markOutboxFailed('ob-1', 'external-unreachable: x', 7), 0);
  assertEquals(await d.quarantineCommitting('ob-1'), null);
  await tick();
  assertEquals(sent.length, 1);
  assertEquals(sent[0].properties.outcome, 'confirmed');
}));

Deno.test('AC-PHO-031 no event for a row this deps never read or claimed (no domain known)', () => withPosthog('ok', async (sent) => {
  const d = deps(fakeClient({ confirm_outbox: [1] }));
  assertEquals(await d.confirmOutbox('ob-unknown', 7), 1);
  await tick();
  assertEquals(sent.length, 0);
}));

Deno.test('AC-PHO-032 a held command needs a human; a confirmed one does not', () => withPosthog('ok', async (sent) => {
  const d = deps(fakeClient({ claim_outbox_for_commit: [ROW, ROW], confirm_outbox: [1], mark_outbox_held: [1] }));
  await d.claimOutboxForCommit('ob-1');
  await d.confirmOutbox('ob-1', 7);
  await d.claimOutboxForCommit('ob-1');
  await d.markOutboxHeld('ob-1', 'recovery-reissue-unauthorized: actor demoted', 7);
  await tick();
  assertEquals(sent.map((s) => [s.properties.outcome, s.properties.needs_human]), [['confirmed', false], ['held', true]]);
}));

for (const mode of ['reject', 'throw', 'hang'] as const) {
  Deno.test({
    name: `AC-PHO-033 telemetry ${mode} never changes a write-back result or throws`,
    // A hanging PostHog send keeps its bounded-deadline timer alive past the test; that is the point.
    sanitizeOps: mode !== 'hang',
    sanitizeResources: mode !== 'hang',
    fn: () => withPosthog(mode, async (sent) => {
      const quarantined = { ...ROW, state: 'quarantined' };
      const d = deps(fakeClient({
        claim_outbox_for_commit: [ROW],
        confirm_outbox: [1],
        mark_outbox_held: [1],
        quarantine_committing: [quarantined],
      }, [[{ id: 'ob-1' }]]));
      const claimed = await d.claimOutboxForCommit('ob-1');
      assertEquals(claimed?.claimGeneration, 7);
      assertEquals(await d.confirmOutbox('ob-1', 7), 1);
      assertEquals(await d.markOutboxFailed('ob-1', 'external-unreachable: x', 7), 1);
      assertEquals(await d.markOutboxHeld('ob-1', 'recovery-probe-failed: x', 7), 1);
      assertEquals((await d.quarantineCommitting('ob-1'))?.id, 'ob-1');
      await tick();
      assertEquals(sent.length, 4); // the sends were attempted, and failed harmlessly
    }),
  });
}

Deno.test('S4 fix: a sweep-path quarantined event carries attempt_count and duration_ms from the returned row', () => withPosthog('ok', async (sent) => {
  const claimedAt = new Date(Date.now() - 30_000).toISOString();
  // sweep builds fresh deps per candidate: no claimOutboxForCommit on this instance
  const q = deps(fakeClient({ quarantine_committing: [{ ...ROW, claimed_at: claimedAt, state: 'quarantined' }] }));
  assertEquals((await q.quarantineCommitting('ob-1'))?.state, 'quarantined');
  await tick();
  assertEquals(sent.length, 1);
  assertEquals(sent[0].properties.outcome, 'quarantined');
  assertEquals(sent[0].properties.attempt_count, 2);
  assert(sent[0].properties.duration_ms >= 29_000 && sent[0].properties.duration_ms < 60_000, `duration ${sent[0].properties.duration_ms}`);
}));
