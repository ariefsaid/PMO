/**
 * AC-ODC-008 — the one Odoo client resolver (`_shared/odooClientForOrg.ts`; tested here, its first consumer, because
 * CI runs `_shared` tests under an import map without the edge test kit) refuses with a classified reason and makes no Odoo request.
 */
import { assert, assertEquals, fail } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { installEdgeEnv, jsonResponse, rpcCall, supabaseRpc, supabaseSelect, withFetchMock, type FetchCall } from '../_shared/testing/edgeTestKit.ts';
import { odooClientForOrg, recordOdooProbe } from '../_shared/odooClientForOrg.ts';
import { INITIAL_CONNECTION, type ProbeOutcome } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';
import type { CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';

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

// ---- recordOdooProbe (FR-ODC-021/023/030) ----

const SNAP = (missing: string[]) => ({ observed_at: '2026-11-01T00:00:00.000Z', version_major: 20, untested_version: false, companies: [], models: {}, later: {}, missing });

async function record(prevConfig: Record<string, unknown>, outcome: ProbeOutcome, snapshot?: CapabilitySnapshot) {
  const env = installEdgeEnv();
  try {
    return await withFetchMock([
      supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
      supabaseRpc('log_audit', () => jsonResponse(null)),
    ], async ({ calls }) => {
      const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const next = await recordOdooProbe(sc, ORG, prevConfig, outcome, snapshot, 'user-1');
      return { next, merges: rpcCall(calls, 'merge_external_org_binding_config').map((c) => c.bodyJson as Record<string, unknown>), audits: rpcCall(calls, 'log_audit').map((c) => c.bodyJson as Record<string, unknown>) };
    });
  } finally { env.restore(); }
}

Deno.test('FR-ODC-023 a change in the missing list writes one audit row and stores the snapshot with the state', async () => {
  const r = await record({ capabilities: SNAP([]), connection: { ...INITIAL_CONNECTION, state: 'healthy' } }, { ok: true, missing: ['stock.location'] }, SNAP(['stock.location']));
  assertEquals(r.next.state, 'degraded');
  assertEquals(r.merges.length, 1);
  assertEquals(r.merges[0].p_external_tier, 'odoo');
  assertEquals(r.merges[0].p_org_id, ORG);
  const patch = r.merges[0].p_patch as Record<string, { state?: string; missing?: string[] }>;
  assertEquals([patch.connection.state, patch.capabilities.missing], ['degraded', ['stock.location']]);
  assertEquals(r.audits.length, 1);
  assertEquals([r.audits[0].p_action, r.audits[0].p_org_id, r.audits[0].p_actor_id, r.audits[0].p_detail], ['integration.odoo.capability_change', ORG, 'user-1', { tier: 'odoo', missing: ['stock.location'] }]);
});

Deno.test('FR-ODC-023 an equal missing list writes no audit row', async () => {
  const r = await record({ capabilities: SNAP(['x']) }, { ok: true, missing: ['x'] }, SNAP(['x']));
  assertEquals(r.audits.length, 0);
});

Deno.test('FR-ODC-023 a restored capability clears degraded and is audited', async () => {
  const r = await record({ capabilities: SNAP(['x']), connection: { ...INITIAL_CONNECTION, state: 'degraded', missing: ['x'] } }, { ok: true, missing: [] }, SNAP([]));
  assertEquals(r.next.state, 'healthy');
  assertEquals(r.audits.length, 1);
});

Deno.test('FR-ODC-031 a rejected key after a success is audited once; a repeat is not', async () => {
  const first = await record({ connection: { ...INITIAL_CONNECTION, state: 'healthy' } }, { ok: false, errorClass: 'key-rejected' });
  assertEquals(first.next.state, 'credential-rejected');
  assertEquals(first.audits.map((a) => [a.p_action, a.p_detail]), [['integration.odoo.credential_rejected', { tier: 'odoo', error_class: 'key-rejected' }]]);
  assertEquals(Object.keys(first.merges[0].p_patch as object), ['connection']);
  const again = await record({ connection: first.next }, { ok: false, errorClass: 'key-rejected' });
  assertEquals(again.audits.length, 0);
});

Deno.test('FR-ODC-030 the stored state carries the key expiry warning from config', async () => {
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const r = await record({ key_expires_on: soon }, { ok: true, missing: [] }, SNAP([]));
  assertEquals(r.next.state, 'credential-expiring');
});

Deno.test('FR-ODC-030 a failed config write is an error, not a silent probe', async () => {
  const env = installEdgeEnv();
  try {
    await withFetchMock([supabaseRpc('merge_external_org_binding_config', () => jsonResponse({ message: 'nope' }, { status: 400 }))], async () => {
      const sc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      let threw = false;
      try { await recordOdooProbe(sc, ORG, {}, { ok: true, missing: [] }); } catch { threw = true; }
      assert(threw);
    });
  } finally { env.restore(); }
});
