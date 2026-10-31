/**
 * AC-ODC-008 — the one Odoo client resolver (`_shared/odooClientForOrg.ts`; tested here, its first consumer, because
 * CI runs `_shared` tests under an import map without the edge test kit) refuses with a classified reason and makes no Odoo request.
 */
import { assert, assertEquals, fail } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { odooClientForOrg } from '../_shared/odooClientForOrg.ts';

const ORG = '0d000000-0000-4000-8000-000000000001';
const SITE = 'https://odoo.example.test';
const ACTIVE = { site_url: SITE, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-10-31T00:00:00Z', config: { database: 'db1', odoo_company_id: 1 } };

async function resolve(binding: Record<string, unknown> | null, key: unknown, options?: Parameters<typeof odooClientForOrg>[2]) {
  const env = installEdgeEnv();
  try {
    return await withFetchMock([
      supabaseSelect('external_org_bindings', () => jsonResponse(binding === null ? [] : [binding])),
      supabaseRpc('read_vault_secret', () => jsonResponse(key)),
    ], async ({ calls }) => {
      const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const result = await odooClientForOrg(sc, ORG, options);
      return { result, calls };
    });
  } finally { env.restore(); }
}

const odooCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.host === 'odoo.example.test');

const cases: Array<[string, Record<string, unknown> | null, unknown, string, Parameters<typeof odooClientForOrg>[2]?]> = [
  ['no binding row', null, 'k', 'not-found'],
  ['a disconnected binding', { ...ACTIVE, status: 'disconnected' }, 'k', 'inactive'],
  ['a binding that is not activated', { ...ACTIVE, activated_at: null }, 'k', 'inactive'],
  ['a missing vault secret', ACTIVE, null, 'credentials'],
  ['an empty vault secret', ACTIVE, '', 'credentials'],
  ['a two-part secret (two secrets under one reference)', ACTIVE, 'a:b', 'credentials'],
  ['a private site', { ...ACTIVE, site_url: 'http://10.0.0.5' }, 'k', 'invalid-site'],
  ['no chosen company', { ...ACTIVE, config: { database: 'db1' } }, 'k', 'company-not-set'],
];

for (const [label, binding, key, refusal, options] of cases) {
  Deno.test(`AC-ODC-008 ${label} → ${refusal}, no Odoo request`, async () => {
    const { result, calls } = await resolve(binding, key, options);
    assertEquals('refusal' in result ? result.refusal : 'resolved', refusal);
    assertEquals(odooCalls(calls).length, 0);
  });
}

Deno.test('AC-ODC-008 the kill switch off → kill-switch before any read', async () => {
  Deno.env.set('EXTERNAL_CONNECT_ENABLED', 'false');
  try {
    const { result, calls } = await resolve(ACTIVE, 'k');
    assertEquals('refusal' in result && result.refusal, 'kill-switch');
    assertEquals(calls.length, 0);
  } finally { Deno.env.delete('EXTERNAL_CONNECT_ENABLED'); }
});

Deno.test('AC-ODC-008 the binding read is scoped to the given org and tier odoo', async () => {
  const { calls } = await resolve(ACTIVE, 'k');
  const read = calls.find((c) => c.url.pathname === '/rest/v1/external_org_bindings')!;
  assertEquals(read.url.searchParams.get('org_id'), `eq.${ORG}`);
  assertEquals(read.url.searchParams.get('external_tier'), 'eq.odoo');
});

Deno.test('FR-ODC-005 setup reads may skip activation and company; the key is read only after every check passes', async () => {
  const { result, calls } = await resolve({ ...ACTIVE, activated_at: null, config: { database: 'db1' } }, 'K1', { requireActivated: false, requireCompany: false });
  if (!('client' in result)) return fail(`refused: ${result.refusal}`);
  assertEquals(result.client.apiKey, 'K1');
  assertEquals(result.client.database, 'db1');
  assertEquals(result.client.baseUrl, SITE);
  assertEquals(result.companyId, null);
  assertEquals(rpcCall(calls, 'read_vault_secret').length, 1);
  assertEquals(odooCalls(calls).length, 0);
});

Deno.test('FR-ODC-100 a resolved client carries the company and a host-guarded fetch', async () => {
  const { result } = await resolve(ACTIVE, 'K1');
  if (!('client' in result)) return fail(`refused: ${result.refusal}`);
  assertEquals(result.companyId, 1);
  let refused = false;
  try { await result.client.fetchImpl('https://elsewhere.example.test/json/2/x/y'); } catch { refused = true; }
  assert(refused, 'the client fetch must refuse any other origin');
});

Deno.test('FR-ODC-046 a resolved client is paced', async () => {
  const { result } = await resolve(ACTIVE, 'K1');
  if (!('client' in result)) return fail(`refused: ${result.refusal}`);
  assertEquals(typeof result.client.pace, 'function');
});
