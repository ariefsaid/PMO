/**
 * Capability discovery against the real Odoo bed through the shipped recheck verb (#1504 S3-T8, layer B). Gated on the
 * dependency, never on CI: ODOO_BED_URL, ODOO_BED_DB and ODOO_BED_MIN_KEY (the least-privilege user's key; falls back to
 * ODOO_BED_KEY), sourced from the bed's untracked env file, never printed. Supabase is mocked; Odoo is the bed.
 */
import { assert, assertEquals } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks } from './index.ts';
import {
  createAuthedRequest, createJwtAuthority, createTestJwksResolver, installEdgeEnv, jsonResponse, rpcCall,
  supabaseRpc, supabaseSelect, withFetchMock, type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';
import { LATER_MODELS, O1_MODELS, type CapabilitySnapshot } from '../../../pmo-portal/src/lib/adapterSeam/odoo/discovery.ts';
import type { ConnectionRecord } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectionState.ts';

const BED = Deno.env.get('ODOO_BED_URL');
const DB = Deno.env.get('ODOO_BED_DB') ?? '';
const KEY = Deno.env.get('ODOO_BED_MIN_KEY') ?? Deno.env.get('ODOO_BED_KEY') ?? '';
const realFetch = globalThis.fetch;
if (BED && !Deno.env.get('ODOO_BED_MIN_KEY')) console.log('note: no least-privilege key set; discovery runs with the bed API user key');

const one = (body: unknown) => jsonResponse(body, { headers: { 'content-type': 'application/vnd.pgrst.object+json' } });
const none = () => new Response('null', { status: 200, headers: { 'content-type': 'application/json' } });

Deno.test({
  name: 'AC-ODC-010 AC-ODC-011 discovery on the stock bed: every O1 model readable, version 20, later models seen, nothing missing, no installed-modules read',
  ignore: !BED,
  fn: async () => {
    const bed = new URL(BED!);
    const saved = ['ERPNEXT_ALLOW_LOCAL_BENCH', 'ERPNEXT_LOCAL_BENCH_ORIGINS'].map((k) => [k, Deno.env.get(k)] as const);
    const env = installEdgeEnv({ SUPABASE_URL: 'http://127.0.0.1:54321' }); // the host guard admits a local bed only on a local stack
    Deno.env.set('ERPNEXT_ALLOW_LOCAL_BENCH', '1');
    Deno.env.set('ERPNEXT_LOCAL_BENCH_ORIGINS', bed.origin);
    try {
      const auth = await createJwtAuthority(env.SUPABASE_URL);
      setTestJwks(createTestJwksResolver(auth));
      const routes = [
        supabaseSelect('profiles', () => one({ org_id: 'org-1', role: 'Admin' })),
        supabaseSelect('platform_operators', none),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true })),
        supabaseSelect('external_org_bindings', () => one({ site_url: bed.origin, secret_ref: 'odoo_ref', status: 'active', activated_at: '2026-11-01T00:00:00Z', config: { database: DB, odoo_company_id: 1 } })),
        supabaseRpc('read_vault_secret', () => jsonResponse(KEY)),
        supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
        supabaseRpc('log_audit', () => jsonResponse(null)),
        { label: 'odoo-bed', host: bed.host, response: (c: FetchCall) => realFetch(c.url, { method: c.method, headers: c.headers, body: c.bodyText, redirect: 'manual' }) },
      ];
      await withFetchMock(routes, async ({ calls }) => {
        const res = await handleSetCompanyRequest(createAuthedRequest('http://edge.test/set-company', { tier: 'odoo', setupAction: 'recheck' }, await auth.mintJwt({ sub: 'user-1' })));
        const text = await res.text();
        assertEquals(res.status, 200, text);
        const patch = (rpcCall(calls, 'merge_external_org_binding_config')[0].bodyJson as { p_patch: { capabilities: CapabilitySnapshot; connection: ConnectionRecord } }).p_patch;
        const snap = patch.capabilities;
        // AC-ODC-010
        for (const model of Object.keys(O1_MODELS)) assert(snap.models[model]?.exists && snap.models[model].read, `${model} exists and is readable`);
        assertEquals(snap.version_major, 20);
        assert(snap.companies.length >= 1, 'at least one company');
        assertEquals(Object.keys(snap.later).sort(), [...LATER_MODELS].sort());
        assertEquals(snap.later['purchase.order'], true);
        assertEquals(calls.some((c) => c.url.host === bed.host && c.url.pathname.includes('/ir.module.module/')), false, 'no installed-modules read');
        // AC-ODC-011, negative half: the stock bed is not wrongly degraded.
        assertEquals(snap.missing, []);
        assertEquals(patch.connection.state, 'healthy');
        assertEquals(text.includes(KEY), false);
      });
    } finally {
      env.restore();
      for (const [k, v] of saved) v === undefined ? Deno.env.delete(k) : Deno.env.set(k, v);
    }
  },
});
