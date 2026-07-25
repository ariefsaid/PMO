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
}) {
  const rpcCalls: RpcCall[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: {
              operation: 'create',
              payload: { id: 'si-1', erp_doc_kind: 'sales-invoice' },
              actor_user_id: opts.actorUserId,
            },
            error: null,
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn === 'domain_owned_by_tier') return { data: opts.domainOwned ?? true, error: null };
      if (fn === 'actor_authorization_state') {
        return { data: opts.actorState === undefined ? { role: 'Finance', active: true } : opts.actorState, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

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
  let dispatched = 0;
  const result = await reconcileOrgOutbox(
    async () => [row],
    { orgId: ORG, ownedDomains: ['revenue'] },
    (candidate) => buildReconcileDepsLive(client, org, candidate),
    (async () => { dispatched += 1; return { externalRecordId: 'SI-1', canonical: { id: 'si-1' } }; }) as never,
  );

  assert(dispatched === 0, 'a refused candidate must never reach dispatchMoneyWrite');
  assert(result.reconciled === 0, 'nothing was reconciled');
  assert(result.errors.length === 1 && result.errors[0].id === row.id, 'the refusal is reported per candidate');
  assert(
    result.errors[0].error.includes('not replayed'),
    `the operator must see WHY the row is held — got: ${result.errors[0].error}`,
  );
});
