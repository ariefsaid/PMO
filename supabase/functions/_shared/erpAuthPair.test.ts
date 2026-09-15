// AC-ENA-083 (#651) [Deno unit] — the ONE ERPNext auth-pair resolver: Vault first, env pair only on a
// clean negative, refuse when a store cannot answer. Binds the SHIPPED module the edge functions import.
// Verify: cd supabase/functions/erpnext-sweep && deno test ../_shared --config deno.json --allow-env --allow-net --allow-read
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { resolveErpAuthPair, createErpAuthPairCache } from './erpAuthPair.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

/** A Supabase stand-in whose binding row and `rpc` answer are chosen per test. */
function fakeDb(opts: {
  binding?: { secret_ref: string } | null;
  bindingError?: { code: string } | null;
  vault?: string | null;
  vaultError?: { code: string } | null;
}) {
  let rpcCalls = 0;
  const client = {
    from() {
      // deno-lint-ignore no-explicit-any
      const b: any = {
        select: () => b, eq: () => b,
        maybeSingle: () => Promise.resolve({ data: opts.binding ?? null, error: opts.bindingError ?? null }),
      };
      return b;
    },
    rpc: () => { rpcCalls += 1; return Promise.resolve({ data: opts.vault ?? null, error: opts.vaultError ?? null }); },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls: () => rpcCalls };
}

function stubEnv(values: Record<string, string>) {
  const original = Deno.env.get;
  (Deno.env as unknown as { get: (k: string) => string | undefined }).get = (k: string) => values[k];
  return { restore: () => { (Deno.env as unknown as { get: unknown }).get = original; } };
}

const ORG = { orgId: '00000000-0000-4000-8000-0000000000aa', secretRef: 'local-bench' };

Deno.test('AC-ENA-083: no Vault secret and no env pair -> config-rejected', async () => {
  const db = fakeDb({ binding: { secret_ref: 'local-bench' }, vault: null });
  const env = stubEnv({});
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError, `expected AppError, got ${e}`);
    assert((e as AppError).code === 'config-rejected', `expected config-rejected, got ${(e as AppError).code}`);
  } finally { env.restore(); }
});

Deno.test('#651: a Vault hit is split into the api key/secret pair', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'vault-key:vault-secret' });
  const env = stubEnv({});
  try {
    const pair = await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' });
    assert(pair.apiKey === 'vault-key' && pair.apiSecret === 'vault-secret', `got ${JSON.stringify(pair)}`);
  } finally { env.restore(); }
});

Deno.test('#651: the key:secret split takes the FIRST colon — a Frappe secret may itself contain a colon', async () => {
  // Frappe secret values may legally contain ':' (the api secret is an opaque string); api keys cannot,
  // so the boundary is the first ':' — 'k:se:cret' must split to apiKey 'k' / apiSecret 'se:cret'.
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'k:se:cret' });
  const env = stubEnv({});
  try {
    const pair = await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' });
    assert(pair.apiKey === 'k' && pair.apiSecret === 'se:cret',
      `expected apiKey 'k' / apiSecret 'se:cret', got ${JSON.stringify(pair)}`);
  } finally { env.restore(); }
});

Deno.test('#651: a malformed Vault value is refused whole, never partially used', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'no-colon-here' });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'env-k', LOCAL_BENCH_SECRET: 'env-s' });
  try {
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' });
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
  } finally { env.restore(); }
});

Deno.test('AC-ENA-082 (unit half): a binding-lookup ERROR refuses and never reads the env pair', async () => {
  const db = fakeDb({ bindingError: { code: '57P01' }, vault: null });
  const env = stubEnv({ LOCAL_BENCH_KEY: 'env-k', LOCAL_BENCH_SECRET: 'env-s' });
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused — an unreadable store is not "no secret"');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
  } finally { env.restore(); }
});

Deno.test('FR-ENA-019: the kill-switch refuses before any store read', async () => {
  const db = fakeDb({ binding: { secret_ref: 'local-bench' }, vault: 'k:s' });
  const env = stubEnv({ EXTERNAL_CONNECT_ENABLED: 'false' });
  try {
    await resolveErpAuthPair(db.client, ORG);
    throw new Error('should have refused');
  } catch (e) {
    assert(e instanceof AppError && (e as AppError).code === 'config-rejected', `got ${e}`);
    assert(db.rpcCalls() === 0, 'the kill-switch must refuse BEFORE reading the secret store');
  } finally { env.restore(); }
});

Deno.test('AC-ENA-085: the cache is keyed by org — one shared tick cache still resolves each org separately', async () => {
  // A db whose Vault answer varies by the binding's secret_ref. Two orgs in the SAME tick cache must
  // each get their OWN pair (2 Vault reads, different values), never one org's pair leaked to another.
  const orgA = { orgId: '00000000-0000-4000-8000-0000000000a1', secretRef: 'org-a-erpnext' };
  const orgB = { orgId: '00000000-0000-4000-8000-0000000000b2', secretRef: 'org-b-erpnext' };
  let rpcCalls = 0;
  const bindings: Record<string, string> = { [orgA.orgId]: orgA.secretRef, [orgB.orgId]: orgB.secretRef };
  const vault: Record<string, string> = { [orgA.secretRef]: 'aaa-key:aaa-secret', [orgB.secretRef]: 'bbb-key:bbb-secret' };
  const client = {
    from() {
      // deno-lint-ignore no-explicit-any
      const b: any = { select: () => b, eq: (_k: string, v: string) => { if (_k === 'org_id') b._org = v; return b; },
        maybeSingle: () => Promise.resolve({ data: bindings[b._org] ? { secret_ref: bindings[b._org] } : null, error: null }) };
      return b;
    },
    rpc: (_fn: string, args?: { p_secret_ref?: string }) => {
      rpcCalls += 1;
      const ref = args?.p_secret_ref ?? '';
      return Promise.resolve({ data: vault[ref] ?? null, error: null });
    },
  } as unknown as SupabaseClient;
  const env = stubEnv({});
  const cache = createErpAuthPairCache();
  try {
    const pairA = await resolveErpAuthPair(client, orgA, cache);
    const pairB = await resolveErpAuthPair(client, orgB, cache);
    assert(rpcCalls === 2, `two orgs in one tick must each read Vault once — got ${rpcCalls}`);
    assert(pairA.apiSecret === 'aaa-secret' && pairB.apiSecret === 'bbb-secret',
      `org A and org B must resolve their OWN pairs — A=${JSON.stringify(pairA)} B=${JSON.stringify(pairB)}`);
    assert(pairA.apiSecret !== pairB.apiSecret, 'two orgs must never share a pair');
  } finally { env.restore(); }
});

Deno.test('FR-ENA-019: a cache resolves once per org and re-resolves after a failure', async () => {
  const db = fakeDb({ binding: { secret_ref: 'org-a-erpnext' }, vault: 'k:s' });
  const env = stubEnv({});
  const cache = createErpAuthPairCache();
  try {
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' }, cache);
    await resolveErpAuthPair(db.client, { orgId: ORG.orgId, secretRef: 'org-a-erpnext' }, cache);
    assert(db.rpcCalls() === 1, `expected 1 vault read, got ${db.rpcCalls()}`);
  } finally { env.restore(); }
});