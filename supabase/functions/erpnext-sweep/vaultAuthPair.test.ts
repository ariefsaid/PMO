/**
 * AC-ENA-080 / AC-ENA-081 / AC-ENA-082 (#651) [Deno unit] — the ERPNext auth pair the SHIPPED sweep
 * actually SENDS. The oracle is the outgoing `Authorization` header, not the resolver's return value:
 * asserting the return proves the resolver, not the wiring (p3bc audit lesson 5).
 *
 * Verify: cd supabase/functions/erpnext-sweep && deno test . --config deno.json --allow-env --allow-net --allow-read
 */
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { sweepOrgDoctypesLive } = await import('./index.ts');
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const ORG = '00000000-0000-4000-8000-0000000000aa';

function orgBinding(secretRef: string) {
  return {
    orgId: ORG, siteUrl: 'https://erp.example.test', secretRef,
    company: 'PMO Smoke Co', config: {}, ownedDomains: ['revenue'], versionMajor: 15,
  };
}

/** Binding row + Vault answer are chosen per test; `rpc` can return a value, a clean null, or an ERROR. */
function fakeDb(opts: { secretRef: string; vault?: string | null; vaultError?: { code: string } | null }) {
  let rpcCalls = 0;
  const empty = { data: [] as unknown[], error: null };
  const client = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, in: () => b, is: () => b, not: () => b,
        insert: () => b, update: () => b, upsert: () => b,
        limit: () => Promise.resolve(empty),
        maybeSingle: () => Promise.resolve(
          table === 'external_org_bindings'
            ? { data: { secret_ref: opts.secretRef }, error: null }
            : { data: null, error: null },
        ),
        then: (resolve: (v: unknown) => void) => resolve(empty),
      };
      return b;
    },
    rpc: () => {
      rpcCalls += 1;
      return Promise.resolve({ data: opts.vault ?? null, error: opts.vaultError ?? null });
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls: () => rpcCalls };
}

function stubEnv(values: Record<string, string>) {
  const original = Deno.env.get;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

/** Records every outgoing Authorization header; serves an empty list to each doctype poll. */
function stubErpFetch() {
  const original = globalThis.fetch;
  const auth: string[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    auth.push(h.get('Authorization') ?? '');
    return Promise.resolve(new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
  return { auth, calls: () => auth.length, restore: () => { globalThis.fetch = original; } };
}

Deno.test('AC-ENA-080: a Vault-issued pair is the one SENT to ERPNext', async () => {
  const db = fakeDb({ secretRef: 'org-a-erpnext', vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('org-a-erpnext'));
    assert(erp.calls() > 0, 'the poll must have issued at least one ERP request');
    assert(
      erp.auth.every((a) => a === 'token vault-key:vault-secret'),
      `every request must carry the Vault pair — got ${JSON.stringify(erp.auth)}`,
    );
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-081: no Vault secret + env pair present -> the env pair is SENT (the local bench)', async () => {
  const db = fakeDb({ secretRef: 'local-bench', vault: null });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'bench-k', LOCAL_BENCH_SECRET: 'bench-s' });
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('local-bench'));
    assert(erp.calls() > 0, 'the poll must have issued at least one ERP request');
    assert(
      erp.auth.every((a) => a === 'token bench-k:bench-s'),
      `every request must carry the env pair — got ${JSON.stringify(erp.auth)}`,
    );
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-082: a Vault READ ERROR refuses — it never falls through to the env pair', async () => {
  const db = fakeDb({ secretRef: 'local-bench', vault: null, vaultError: { code: '57P01' } });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'bench-k', LOCAL_BENCH_SECRET: 'bench-s' });
  const erp = stubErpFetch();
  try {
    await sweepOrgDoctypesLive(db.client, orgBinding('local-bench'));
    throw new Error('an unreadable secret store must refuse, not fall back to the environment');
  } catch (e) {
    assert(e instanceof AppError, `expected AppError, got ${e}`);
    assert((e as AppError).code === 'config-rejected', `expected config-rejected, got ${(e as AppError).code}`);
    assert(erp.calls() === 0, `no ERP request may be issued — got ${JSON.stringify(erp.auth)}`);
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-085: ONE secret resolution per org per sweep tick, not one per pass', async () => {
  const { createErpAuthPairCache } = await import('../_shared/erpAuthPair.ts');
  const db = fakeDb({ secretRef: 'org-a-erpnext', vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  const erp = stubErpFetch();
  const cache = createErpAuthPairCache();
  const org = orgBinding('org-a-erpnext');
  try {
    // Two resolutions in the same tick against the SAME per-tick cache must collapse to one Vault read
    // (FR-ENA-019): a thousand-org cron must not fire thousands of avoidable RPC + Vault audit lines.
    await sweepOrgDoctypesLive(db.client, org, cache);
    await sweepOrgDoctypesLive(db.client, org, cache);
    assert(db.rpcCalls() === 1, `expected ONE vault read for the tick, got ${db.rpcCalls()}`);
  } finally { erp.restore(); env.restore(); }
});

Deno.test('#651 review: the sweep tick holds at most ONE org\'s pair — the per-org cache entry is cleared after each org', async () => {
  // The tick-level cache that memoises by org_id (AC-ENA-085) must not accumulate every org's pair for
  // the WHOLE cycle: an N-org tick would hold N plaintext pairs resident at once. After an org's
  // iteration completes, its entry must be gone, so only the current org's pair is ever resident.
  const { createErpAuthPairCache, resolveErpAuthPair } = await import('../_shared/erpAuthPair.ts');
  const { runErpSweepCycle } = await import('./index.ts');
  const db = fakeDb({ secretRef: 'org-a-erpnext', vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  const erp = stubErpFetch();
  const cache = createErpAuthPairCache();
  const org = orgBinding('org-a-erpnext');
  let resolved = false;
  try {
    await runErpSweepCycle({
      listEmployingOrgs: async () => [org],
      reconcileOrgOutbox: async () => ({ reconciled: 0, errors: [] }),
      sweepOrgDoctypes: async () => { await resolveErpAuthPair(db.client, org, cache); resolved = true; return { applied: 0 }; },
      feedOrgLedgers: async () => ({ gl: 0, ple: 0 }),
      refreshOrgAccounting: async () => ({}),
    }, cache);
    assert(resolved, 'the org must have resolved its pair through the cache during the tick');
    assert(!cache.has(org.orgId), 'after org A\'s iteration the cache must hold no resident pair for it');
    assert(cache.size === 0, `the per-tick cache must be empty after the tick — size=${cache.size}`);
  } finally { erp.restore(); env.restore(); }
});

Deno.test('AC-ENA-084: a VAULT-ONLY org can build its outbox reconcile deps (the write path)', async () => {
  const { buildReconcileDepsLive } = await import('./index.ts');
  const outboxRow = {
    operation: 'create',
    payload: { id: 'pmo-1', erp_doc_kind: 'purchase-invoice' },
    actor_user_id: '00000000-0000-4000-8000-0000000000a1',
  };
  let rpcCalls = 0;
  const env = stubEnv({}); // NO env pair exists for this org — Vault is the only source
  const erp = stubErpFetch();
  const authClient = {
    from(table: string) {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b, in: () => b, is: () => b, not: () => b,
        insert: () => b, update: () => b, upsert: () => b,
        limit: () => Promise.resolve({ data: [], error: null }),
        maybeSingle: () => Promise.resolve(
          table === 'external_command_outbox' ? { data: outboxRow, error: null }
          : table === 'external_org_bindings'
            ? { data: { secret_ref: 'org-a-erpnext', site_url: 'https://erp.example.test', version_major: 15, activated_at: '2026-01-01T00:00:00.000Z', config: { company: 'PMO Smoke Co' } }, error: null }
          : { data: null, error: null },
        ),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return b;
    },
    rpc: (fn: string) => {
      // The re-authorization guard (authGuard.ts) runs BEFORE credential resolution: answer its two
      // RPCs so the org owns the domain and its recorded actor is an active Finance member, and count
      // ONLY the Vault reader as the credential-source proof.
      if (fn === 'domain_owned_by_tier') return Promise.resolve({ data: true, error: null });
      if (fn === 'org_has_active_erpnext_binding') return Promise.resolve({ data: true, error: null });
      if (fn === 'actor_authorization_state') return Promise.resolve({ data: { role: 'Finance', active: true }, error: null });
      rpcCalls += 1; // read_vault_secret
      return Promise.resolve({ data: 'vault-key:vault-secret', error: null });
    },
  } as unknown as SupabaseClient;
  try {
    const deps = await buildReconcileDepsLive(authClient, orgBinding('org-a-erpnext'), {
      id: 'outbox-1', domain: 'procurement', pmoRecordId: 'pmo-1', idempotencyKey: 'idem-1',
      state: 'pending', externalRecordId: null, canonical: null, claimGeneration: 0, payloadDigest: null,
    } as unknown as Parameters<typeof buildReconcileDepsLive>[2]);
    assert(!!deps, 'a Vault-only org must be able to build its reconcile deps');
    assert(rpcCalls > 0, 'the pair must have come from the Vault reader');
  } finally { erp.restore(); env.restore(); }
});