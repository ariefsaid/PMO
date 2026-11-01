/**
 * external-connect against the real Odoo bed (#1504 S2-T13, layer B). Gated on the dependency, never on CI:
 *   ODOO_BED_URL, ODOO_BED_DB, ODOO_BED_KEY (sourced from the bed's untracked env file, never printed).
 * Supabase RPCs are mocked; every Odoo request goes to the bed through the real fetch.
 */
import { assert, assertEquals } from '@std/assert';
import { handleConnectRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall, type MockRoute,
} from '../_shared/testing/edgeTestKit.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_KEY') ?? '';
const realFetch = globalThis.fetch;

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

function bedRoute(): MockRoute {
  const bed = new URL(BED ?? 'http://127.0.0.1:8069');
  return {
    label: 'odoo-bed', host: bed.host,
    response: (c: FetchCall) => realFetch(c.url, { method: c.method, headers: c.headers, body: c.bodyText, redirect: 'manual' }),
  };
}

/** Mints a fresh key for the bed's API user with its current key (bed report §2); the caller revokes it. */
async function mintKey(): Promise<string> {
  const res = await realFetch(`${BED}/json/2/res.users.apikeys/generate`, {
    method: 'POST', headers: { Authorization: `bearer ${KEY}`, 'X-Odoo-Database': DB, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, scope: 'rpc', name: 'pmo-s2-bed-test', expiration_date: new Date(Date.now() + 86_400_000).toISOString().slice(0, 19).replace('T', ' ') }),
  });
  assertEquals(res.status, 200, 'the bed mints a key');
  return (await res.json()) as string;
}
async function revokeKey(key: string) {
  await realFetch(`${BED}/json/2/res.users.apikeys/revoke`, {
    method: 'POST', headers: { Authorization: `bearer ${KEY}`, 'X-Odoo-Database': DB, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  }).then((r) => r.body?.cancel());
}

async function withBedEnv<T>(run: (auth: Awaited<ReturnType<typeof createJwtAuthority>>) => Promise<T>): Promise<T> {
  const saved = ['ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS'].map((k) => [k, Deno.env.get(k)] as const);
  const env = installEdgeEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' });
  Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
  Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', new URL(BED!).origin);
  try {
    const auth = await createJwtAuthority(env.SUPABASE_URL);
    setTestJwks(createTestJwksResolver(auth));
    return await run(auth);
  } finally {
    env.restore();
    for (const [k, v] of saved) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
  }
}

function supabaseRoutes(order: string[], finalize: (args: Record<string, unknown>) => Response = () => jsonResponse('active')): MockRoute[] {
  return [
    supabaseSelect('profiles', () => one({ org_id: 'org-1', role: 'Admin' })),
    supabaseSelect('platform_operators', none),
    supabaseSelect('external_org_bindings', none),
    supabaseRpc('stage_vault_secret_for_org', () => { order.push('stage'); return jsonResponse('odoo_ref'); }),
    supabaseRpc('finalize_odoo_connect', (c) => { order.push('finalize'); return finalize(c.bodyJson as Record<string, unknown>); }),
    supabaseRpc('cleanup_external_connect_attempt', () => { order.push('cleanup'); return jsonResponse(null); }),
  ];
}

const connectBody = (apiKey: string, extra: Record<string, unknown> = {}) => ({ tier: 'odoo', credential: { siteUrl: BED, database: DB, apiKey, ...extra } });

Deno.test({
  name: 'AC-ODC-001 connect against the bed: the vault gets the key, nothing else does, one JSON-2 read',
  ignore: !BED,
  fn: () => withBedEnv(async (auth) => {
    const order: string[] = [];
    await withFetchMock([...supabaseRoutes(order), bedRoute()], async ({ calls }) => {
      const res = await handleConnectRequest(createAuthedRequest('http://edge.test/connect', connectBody(KEY), await auth.mintJwt({ sub: 'user-1' })));
      const text = await res.text();
      assertEquals(res.status, 200, text);
      const json = JSON.parse(text);
      assertEquals(json.binding, { status: 'active' });
      assert(Array.isArray(json.companies) && json.companies.length > 0, 'the bed lists at least one company');
      assertEquals(json.versionMajor, 20);
      assert(!text.includes(KEY), 'the response carries the key');
      assertEquals((rpcCall(calls, 'stage_vault_secret_for_org')[0].bodyJson as Record<string, unknown>).p_secret_value, KEY);
      assert(!JSON.stringify(rpcCall(calls, 'finalize_odoo_connect')[0].bodyJson).includes(KEY), 'finalize carries the key');
      assertEquals(calls.filter((c) => c.url.pathname.startsWith('/json/2/')).length, 1);
      assertEquals(order, ['stage', 'finalize']);
    });
  }),
});

Deno.test({
  name: 'AC-ODC-006 reconnect with a freshly minted bed key stages then finalizes; another database is refused before anything is staged',
  ignore: !BED,
  fn: () => withBedEnv(async (auth) => {
    const fresh = await mintKey();
    try {
      const order: string[] = [];
      await withFetchMock([...supabaseRoutes(order), bedRoute()], async ({ calls }) => {
        const res = await handleConnectRequest(createAuthedRequest('http://edge.test/connect', connectBody(fresh), await auth.mintJwt({ sub: 'user-1' })));
        assertEquals(res.status, 200, await res.text());
        assertEquals((rpcCall(calls, 'stage_vault_secret_for_org')[0].bodyJson as Record<string, unknown>).p_secret_value, fresh);
        assertEquals(order, ['stage', 'finalize']);
      });

      // Another database: the bed pins one database, so Odoo itself refuses it (HTML 404) and nothing is staged.
      // On a multi-database host the key validates and finalize's confirm-discard guard refuses instead
      // (pgTAP AC-ODC-006, wire in connect.odoo.test.ts).
      const order2: string[] = [];
      await withFetchMock([...supabaseRoutes(order2), bedRoute()], async () => {
        const res = await handleConnectRequest(createAuthedRequest('http://edge.test/connect', connectBody(fresh, { database: `${DB}_other` }), await auth.mintJwt({ sub: 'user-1' })));
        const json = await res.json();
        assertEquals([res.status, json.error], [422, 'database-not-found'], JSON.stringify(json));
        assertEquals(order2, []);
      });
    } finally {
      await revokeKey(fresh);
    }
  }),
});
