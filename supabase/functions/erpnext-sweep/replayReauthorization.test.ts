/**
 * WIRE 1 / round-7 B6 [Deno] — the sweep's recovery pass must RE-ASSERT authorization before it
 * replays a frozen outbox command.
 *
 * `authGuard.checkOutboxReplayAuthorization` encodes the rule and is proven in `authGuard.test.ts`.
 * That proves NOTHING about the sweep: until this wiring, the guard had no caller, so the cron replayed
 * a `pending`/`failed` money command hours later on the strength of authorization checked ONCE, at
 * dispatch time. A user could issue a command, then be demoted, deactivated, or have their org's domain
 * ownership revoked, and the sweep would still mint the ERP document.
 *
 * These tests drive the LIVE call site (`buildReconcileDepsLive`, and through it `reconcileOrgOutbox`)
 * and assert two things a guard-only test cannot: that the check happens AT ALL, and that it happens
 * BEFORE credential/adapter resolution — i.e. a refused replay never even reaches ERP.
 *
 * Verify: deno test supabase/functions/erpnext-sweep/ --config supabase/functions/erpnext-sweep/deno.json
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { buildReconcileDepsLive, reconcileOrgOutbox } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutboxRow } from '../../../pmo-portal/src/lib/adapterSeam/dispatch.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ORG = '00000000-0000-4000-8000-0000000000aa';
const ACTOR = '00000000-0000-4000-8000-0000000000bb';

/** The org binding the sweep loaded. Its secrets are deliberately UNRESOLVABLE (the stubbed env below
 *  answers nothing), so reaching credential resolution is OBSERVABLE as a `config-rejected` failure. */
const org = {
  orgId: ORG,
  siteUrl: 'https://erp.example.test',
  secretRef: 'wire1-unset-bench',
  company: 'PMO Smoke Co',
  config: {},
  ownedDomains: ['revenue'],
  versionMajor: 15,
};

const outboxRow = (state: OutboxRow['state']): OutboxRow => ({
  id: 'outbox-b6',
  domain: 'revenue',
  pmoRecordId: '00000000-0000-4000-8000-0000000000cc',
  idempotencyKey: '5f7d2b1e-0c3a-4a9e-9f10-2b6c8d4e1a77',
  state,
  externalRecordId: null,
  canonical: null,
  claimGeneration: 0,
  payloadDigest: null,
});

interface RpcCall { fn: string; args: Record<string, unknown> }

/** A service client exposing exactly what `buildReconcileDepsLive` reads: the outbox row re-read and
 *  the two authorization RPCs (`domain_owned_by_tier`, `actor_authorization_state`). */
function fakeServiceClient(opts: {
  actorUserId: string | null;
  domainOwned?: boolean;
  actorState?: { role: string | null; active: boolean } | null;
  payload?: Record<string, unknown>;
  inputDigest?: string | null;
  /** What `pre_cutover_procurement` answers (ECA-4). */
  preCutover?: boolean | null;
}) {
  const rpcCalls: RpcCall[] = [];
  /** #1680: every UPDATE the live code issues, with the filters it chained. */
  const updates: Array<{ table: string; values: Record<string, unknown>; filters: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => {
      // #651: the shipped `buildReconcileDepsLive` now resolves the pair through `resolveErpAuthPair`,
      // whose binding lookup chains TWO `.eq()` calls before `.maybeSingle()`. The fixture keeps its own
      // intent (the re-read row the guard/finalize path needs) but must tolerate that two-eq chain.
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        update: (values: Record<string, unknown>) => {
          const entry = { table, values, filters: {} as Record<string, unknown> };
          updates.push(entry);
          // deno-lint-ignore no-explicit-any
          const u: any = {
            eq: (col: string, val: unknown) => { entry.filters[col] = val; return u; },
            then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
          };
          return u;
        },
        maybeSingle: () => Promise.resolve({
          data: {
            operation: 'create',
            payload: opts.payload ?? { id: 'si-1', erp_doc_kind: 'sales-invoice' },
            actor_user_id: opts.actorUserId,
            procurement_input_digest: opts.inputDigest ?? null,
          },
          error: null,
        }),
      };
      return b;
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'domain_owned_by_tier') return Promise.resolve({ data: opts.domainOwned ?? true, error: null });
      if (fn === 'org_has_active_erpnext_binding') return Promise.resolve({ data: true, error: null });
      if (fn === 'actor_authorization_state') {
        return Promise.resolve({ data: opts.actorState === undefined ? { role: 'Finance', active: true } : opts.actorState, error: null });
      }
      if (fn === 'pre_cutover_procurement') return Promise.resolve({ data: opts.preCutover === undefined ? false : opts.preCutover, error: null });
      return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls, updates };
}

Deno.test('a receipt recovery refuses an inconsistent server witness before resolving credentials', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, inputDigest: 'a'.repeat(64),
    payload: { id: 'receipt-1', procurementId: 'purchase-1', erp_doc_kind: 'goods-receipt',
      items: [{ item_code: 'Item', qty: 1, rate: 10 }], pmo_gr_snapshot: { supplier: 'Supplier', po: null, raw_digest: 'b'.repeat(64) } } });
  const row = { ...outboxRow('pending'), domain: 'procurement', payloadDigest: 'c'.repeat(64) };
  const { error, envReads } = await buildAndCatch(client, row);
  assert(error?.message.includes('receipt snapshot') === true, `expected an inconsistent receipt snapshot refusal, got: ${error?.message}`);
  assert(envReads === 0, 'an inconsistent snapshot is refused before credential resolution');
});

/**
 * Counts env reads so "did we reach credential resolution?" is a real observation, not an inference.
 * The accessor is REPLACED (never delegated to the real environment): the test must not depend on the
 * process's env permissions, and the binding's secrets are meant to be unresolvable here.
 */
function countingEnv() {
  const original = Deno.env.get;
  let reads = 0;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = () => {
    reads += 1;
    return undefined;
  };
  return { reads: () => reads, restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

async function buildAndCatch(client: SupabaseClient, row: OutboxRow): Promise<{ error: Error | null; envReads: number }> {
  const env = countingEnv();
  try {
    await buildReconcileDepsLive(client, org, row);
    return { error: null, envReads: env.reads() };
  } catch (err) {
    return { error: err as Error, envReads: env.reads() };
  } finally {
    env.restore();
  }
}

Deno.test("B6: a PENDING replay whose actor lost domain ownership is REFUSED before any credential resolution", async () => {
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, domainOwned: false });
  const { error, envReads } = await buildAndCatch(client, outboxRow('pending'));

  assert(error !== null, 'the replay must be refused, not silently reconciled');
  assert(
    error!.message.includes('not replayed') && error!.message.includes('does not own domain'),
    `the refusal must name the re-authorization failure — got: ${error!.message}`,
  );
  assert((error as { code?: string }).code === 'commit-rejected', 'the refusal must be classified commit-rejected (not retryable transport)');
  assert(
    rpcCalls.some((c) => c.fn === 'domain_owned_by_tier' && c.args.p_org_id === ORG),
    'the guard must be evaluated against the CURRENT ownership of this org',
  );
  assert(envReads === 0, 'a refused replay must never reach credential resolution — no ERP credentials, no ERP call');
});

Deno.test('B6: a PENDING replay whose actor was DEMOTED out of the revenue write roles is refused', async () => {
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, actorState: { role: 'Project Manager', active: true } });
  const { error, envReads } = await buildAndCatch(client, outboxRow('pending'));

  assert(error !== null && error.message.includes('not authorized for a "revenue" money write'), `expected a role refusal, got: ${error?.message}`);
  assert(rpcCalls.some((c) => c.fn === 'actor_authorization_state' && c.args.p_user_id === ACTOR), "the row's RECORDED actor is the subject of the re-check");
  assert(envReads === 0, 'no credential resolution for a refused replay');
});

Deno.test('B6: a PENDING replay whose actor was DEACTIVATED is refused', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, actorState: { role: 'Finance', active: false } });
  const { error } = await buildAndCatch(client, outboxRow('pending'));
  assert(error !== null && error.message.includes('not an active member'), `expected a membership refusal, got: ${error?.message}`);
});

Deno.test('B6: an UNATTRIBUTABLE row (no recorded actor) is held, never replayed', async () => {
  const { client } = fakeServiceClient({ actorUserId: null });
  const { error, envReads } = await buildAndCatch(client, outboxRow('failed'));
  assert(error !== null && error.message.includes('no recorded actor'), `expected the unattributable hold, got: ${error?.message}`);
  assert(envReads === 0, 'no credential resolution for a held row');
});

Deno.test('AC-BUD-122: a pending kindless historical budget row is held before credentials or ERP fetch', async () => {
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, payload: { id: 'budget-history-1' } });
  const row = { ...outboxRow('pending'), domain: 'budget' };
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    return Promise.resolve(new Response('unexpected network request', { status: 500 }));
  }) as typeof fetch;
  let error: Error | null = null;
  let envReads = 0;
  try {
    const result = await buildAndCatch(client, row);
    error = result.error;
    envReads = result.envReads;
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert(error !== null, 'the historical budget row must be held, not replayed');
  assert(error!.message.includes('missing or unknown erp_doc_kind'), `the missing kind is the refusal reason: ${error!.message}`);
  assert((error as { code?: string }).code === 'commit-rejected', 'the kindless row is held as a non-retryable authorization refusal');
  assert(rpcCalls.some((call) => call.fn === 'org_has_active_erpnext_binding'), 'the actual budget replay authorization path was evaluated');
  assert(envReads === 0, 'refusal happens before credentials are resolved');
  assert(fetchCalls === 0, 'refusal happens before any network or ERP request');
});

Deno.test('B6: an AUTHORIZED replay proceeds past the guard (the wiring gates, it does not block the pass)', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR });
  const { error, envReads } = await buildAndCatch(client, outboxRow('pending'));
  // The bench credentials are deliberately unset, so "we got to credential resolution" is the
  // observable proof that the guard admitted this replay.
  assert((error as { code?: string })?.code === 'config-rejected', `expected the flow to continue to credential resolution, got: ${error?.message}`);
  assert(envReads > 0, 'an authorized replay must reach credential resolution');
});

Deno.test('B6: a COMMITTED row (finalize-only — the ERP document already exists) is NOT re-gated', async () => {
  // Gating a finalize on the actor's CURRENT standing would strand a REAL posted money document
  // unmirrored forever. Only the states whose replay can MINT money are re-authorized.
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: null, domainOwned: false });
  const { error } = await buildAndCatch(client, outboxRow('committed'));
  assert((error as { code?: string })?.code === 'config-rejected', `a committed row must proceed to finalize, got: ${error?.message}`);
  assert(rpcCalls.length === 0, 'no authorization RPC is issued for a finalize-only replay');
});

Deno.test('B6: through the real pass, a refused candidate is reported and its row is left UNTOUCHED (never dropped)', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, domainOwned: false });
  const row = outboxRow('pending');
  const dispatched = { count: 0 };
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([row]),
    { orgId: ORG, ownedDomains: ['revenue'] },
    (candidate) => buildReconcileDepsLive(client, org, candidate),
    (() => { dispatched.count += 1; return Promise.resolve({ externalRecordId: 'SI-1', canonical: { id: 'si-1' } }); }) as never,
  );

  assert(dispatched.count === 0, 'a refused candidate must never reach dispatchMoneyWrite');
  assert(result.reconciled === 0, 'nothing was reconciled');
  assert(result.errors.length === 1 && result.errors[0].id === row.id, 'the refusal is reported per candidate');
  assert(
    result.errors[0].error.includes('not replayed'),
    `the operator must see WHY the row is held — got: ${result.errors[0].error}`,
  );
});

const PURCHASE = '00000000-0000-4000-8000-0000000000dd';
const stepPayload = (kind: string) => ({ id: 'step-1', procurementId: PURCHASE, erp_doc_kind: kind });
const stepRow = (state: OutboxRow['state']): OutboxRow => ({ ...outboxRow(state), domain: 'procurement' });

for (const kind of ['goods-receipt', 'purchase-invoice', 'payment']) {
  Deno.test(`AC-ECA-020: a PENDING ${kind} of a purchase ordered before the connection is never replayed to the ERP`, async () => {
    const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload(kind), preCutover: true });
    const { error, envReads } = await buildAndCatch(client, stepRow('pending'));
    assert((error as { code?: string })?.code === 'pre-cutover', `expected the pre-cutover refusal, got: ${error?.message}`);
    assert(rpcCalls.some((c) => c.fn === 'pre_cutover_procurement' && c.args.p_procurement_id === PURCHASE), 'asks PMO, not the payload');
    assert(envReads === 0, 'refused before credential resolution: no ERP call');
  });
}

Deno.test('AC-ECA-020: a replay whose cut-over check cannot answer is held (fail closed)', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: null });
  const { error, envReads } = await buildAndCatch(client, stepRow('failed'));
  assert((error as { code?: string })?.code === 'commit-rejected', `expected a fail-closed refusal, got: ${error?.message}`);
  assert(envReads === 0, 'no credential resolution');
});

Deno.test('AC-ECA-020: a replay of a purchase ordered after the connection proceeds past the check', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: false });
  const { error, envReads } = await buildAndCatch(client, stepRow('pending'));
  assert((error as { code?: string })?.code === 'config-rejected', `expected the flow to reach credential resolution, got: ${error?.message}`);
  assert(envReads > 0, 'admitted');
});

Deno.test('AC-ECA-020: a COMMITTED step (the ERP document already exists) is finalized, not re-gated', async () => {
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: true });
  const { error } = await buildAndCatch(client, stepRow('committed'));
  assert((error as { code?: string })?.code === 'config-rejected', `a committed row must proceed to finalize, got: ${error?.message}`);
  assert(!rpcCalls.some((c) => c.fn === 'pre_cutover_procurement'), 'no cut-over check for a finalize-only replay');
});

// ── #1680: a held pre-connection step is reported ONCE, then stays quiet until someone acts ─────────────────────
// The refusal above leaves the row untouched, so it stays a candidate and was reported again on every tick. The sweep now
// records the refusal in the row's existing `last_error` and stays quiet while the same refusal repeats; the check itself
// still runs every tick, so a released purchase is driven on the next one.

const HELD_MESSAGE = 'not sent: this purchase started before the ERP connection';

Deno.test('#1680: the first pre-cutover refusal is recorded on the held row, fenced to the unclaimed state the sweep read', async () => {
  const { client, updates } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: true });
  const row = { ...stepRow('pending'), claimGeneration: 0 };
  const { error } = await buildAndCatch(client, row);
  assert((error as { code?: string })?.code === 'pre-cutover', `still refused: ${error?.message}`);
  const stamps = updates.filter((u) => u.table === 'external_command_outbox');
  assert(stamps.length === 1, `one stamp: ${JSON.stringify(updates)}`);
  assert(JSON.stringify(Object.keys(stamps[0].values)) === '["last_error"]' && stamps[0].values.last_error === HELD_MESSAGE,
    `only last_error is written (no state or updated_at change): ${JSON.stringify(stamps[0].values)}`);
  const f = stamps[0].filters;
  assert(f.id === row.id && f.org_id === ORG && f.state === 'pending' && f.claim_generation === 0, `fenced: ${JSON.stringify(f)}`);
});

Deno.test('#1680: a held row that already carries the refusal is not written again', async () => {
  const { client, updates } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: true });
  const { error } = await buildAndCatch(client, { ...stepRow('failed'), lastError: HELD_MESSAGE });
  assert((error as { code?: string })?.code === 'pre-cutover', `still refused: ${error?.message}`);
  assert(updates.length === 0, `no repeat write: ${JSON.stringify(updates)}`);
});

Deno.test('#1680: through the real pass, a held row is reported on the first tick and quiet on the next', async () => {
  const { client } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: true });
  const pass = (row: OutboxRow) => reconcileOrgOutbox(
    () => Promise.resolve([row]),
    { orgId: ORG, ownedDomains: ['procurement'] },
    (candidate) => buildReconcileDepsLive(client, org, candidate),
    (() => { throw new Error('a held row must never reach dispatch'); }) as never,
  );
  const first = await pass(stepRow('pending'));
  assert(first.errors.length === 1 && first.errors[0].error === HELD_MESSAGE, `first tick reports it: ${JSON.stringify(first)}`);
  const second = await pass({ ...stepRow('pending'), lastError: HELD_MESSAGE });
  assert(second.errors.length === 0 && second.reconciled === 0, `second tick is quiet: ${JSON.stringify(second)}`);
});

Deno.test('#1680: once released, the quiet row is driven again (the check still runs every tick)', async () => {
  const { client, rpcCalls } = fakeServiceClient({ actorUserId: ACTOR, payload: stepPayload('goods-receipt'), preCutover: false });
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([{ ...stepRow('pending'), lastError: HELD_MESSAGE }]),
    { orgId: ORG, ownedDomains: ['procurement'] },
    (candidate) => buildReconcileDepsLive(client, org, candidate),
    (() => Promise.resolve({})) as never,
  );
  assert(rpcCalls.some((c) => c.fn === 'pre_cutover_procurement'), 'the cut-over check ran on the quiet row');
  // The bench credentials are unset, so reaching credential resolution (config-rejected) proves the row went past the gate.
  assert(result.errors.length === 1 && result.errors[0].error !== HELD_MESSAGE, `driven past the gate and its new outcome reported: ${JSON.stringify(result)}`);
});

Deno.test('#1680: quiet applies only to the same pre-cutover refusal; another error on a stamped row is reported', async () => {
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([{ ...stepRow('pending'), lastError: HELD_MESSAGE }]),
    { orgId: ORG, ownedDomains: ['procurement'] },
    () => { throw Object.assign(new Error('could not check the connection date'), { code: 'commit-rejected' }); },
    (() => Promise.resolve({})) as never,
  );
  assert(result.errors.length === 1 && result.errors[0].error === 'could not check the connection date', JSON.stringify(result));
});

Deno.test('#1680: a released row that was stamped is dispatched by the pass', async () => {
  let dispatched = 0;
  const result = await reconcileOrgOutbox(
    () => Promise.resolve([{ ...stepRow('pending'), lastError: HELD_MESSAGE }]),
    { orgId: ORG, ownedDomains: ['procurement'] },
    () => ({}) as never,
    (() => { dispatched += 1; return Promise.resolve({}); }) as never,
  );
  assert(dispatched === 1 && result.reconciled === 1 && result.errors.length === 0, JSON.stringify(result));
});
