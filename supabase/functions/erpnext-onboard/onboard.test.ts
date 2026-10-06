// AC-ENA-091 (#654) [Deno unit] — erpnext-onboard resolves its ERPNext credential through THE shared
// resolver (_shared/erpAuthPair.ts): the kill switch applies to onboarding, and an unreadable store
// refuses instead of falling back to the env pair. Binds the SHIPPED handler (./index.ts) and mocks
// globalThis.fetch — no new test deps (this fn's deno.lock is frozen).
// Verify: cd supabase/functions/erpnext-onboard && deno test --config deno.json --allow-env --allow-net --allow-read onboard.test.ts
import { handleOnboardRequest } from './index.ts';

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }

const ORG = '00000000-0000-4000-8000-0000000000aa';
const SITE = 'https://erp.onboard-test.invalid';
const SERVICE_KEY = 'test-service-role-key';

interface Seen { method: string; url: URL; headers: Headers }

/** Runs `run` with fetch + env stubbed; returns every recorded request. */
async function withWorld(
  opts: { env: Record<string, string | undefined>; vault?: string | null; vaultError?: boolean },
  run: (seen: Seen[]) => Promise<void>,
): Promise<void> {
  const prevFetch = globalThis.fetch;
  const touched = { SUPABASE_URL: 'https://edge-test.supabase.test', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ...opts.env };
  const previous: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(touched)) {
    previous[k] = Deno.env.get(k);
    if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v);
  }
  const seen: Seen[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(req.url);
    seen.push({ method: req.method, url, headers: req.headers });
    if (url.pathname === '/rest/v1/external_org_bindings') {
      const accept = req.headers.get('accept') ?? '';
      const row = { site_url: SITE, secret_ref: 'local-bench', activated_at: '2026-01-01T00:00:00Z' };
      return new Response(JSON.stringify(row), { status: 200, headers: { 'content-type': accept.includes('pgrst.object') ? 'application/vnd.pgrst.object+json' : 'application/json' } });
    }
    if (url.pathname === '/rest/v1/rpc/read_vault_secret') {
      return opts.vaultError ? json({ code: 'XX000', message: 'store down' }, 500) : json(opts.vault ?? null);
    }
    if (url.host === new URL(SITE).host) return json({ message: 'stop' }, 500); // end the run after the first ERP call
    throw new Error(`Unexpected fetch: ${req.method} ${url}`);
  }) as typeof fetch;
  try {
    await run(seen);
  } finally {
    globalThis.fetch = prevFetch;
    for (const [k, v] of Object.entries(previous)) { if (v === undefined) Deno.env.delete(k); else Deno.env.set(k, v); }
  }
}

function request(): Request {
  return new Request('http://edge.test/onboard', {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ orgId: ORG }),
  });
}

Deno.test('AC-ENA-091: the kill switch refuses onboarding before any credential read or ERP call', async () => {
  await withWorld({ env: { EXTERNAL_CONNECT_ENABLED: 'false', LOCAL_BENCH_KEY: 'k', LOCAL_BENCH_SECRET: 's' }, vault: 'vk:vs' }, async (seen) => {
    const res = await handleOnboardRequest(request());
    assert(res.status === 422, `expected 422, got ${res.status}`);
    assert((await res.json()).error === 'config-rejected', 'expected config-rejected');
    assert(!seen.some((c) => c.url.pathname.includes('read_vault_secret')), 'must not read the Vault when disabled');
    assert(!seen.some((c) => c.url.host === new URL(SITE).host), 'must not call ERPNext when disabled');
  });
});

Deno.test('AC-ENA-091: an unreadable secret store refuses onboarding and never falls back to the env pair', async () => {
  await withWorld({ env: { EXTERNAL_CONNECT_ENABLED: 'true', LOCAL_BENCH_KEY: 'k', LOCAL_BENCH_SECRET: 's' }, vaultError: true }, async (seen) => {
    const res = await handleOnboardRequest(request());
    assert(res.status === 422, `expected 422, got ${res.status}`);
    assert(!seen.some((c) => c.url.host === new URL(SITE).host), 'must not call ERPNext with the env pair after a store error');
  });
});

Deno.test('AC-ENA-091: a Vault secret is used for the ERPNext call', async () => {
  await withWorld({ env: { EXTERNAL_CONNECT_ENABLED: 'true', LOCAL_BENCH_KEY: undefined, LOCAL_BENCH_SECRET: undefined }, vault: 'vk:vs' }, async (seen) => {
    await handleOnboardRequest(request());
    const erp = seen.find((c) => c.url.host === new URL(SITE).host);
    assert(erp !== undefined, 'expected an ERPNext call');
    assert(erp!.headers.get('authorization') === 'token vk:vs', `unexpected auth header: ${erp!.headers.get('authorization')}`);
  });
});
