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