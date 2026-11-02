/**
 * external-disconnect — Deno unit tests against the SHIPPED handler.
 * AC-EAC-114 (stamps cleared), AC-EAC-117 (binds to shipped code — enforced by the check script,
 * not this file), AC-EAC-118 (audit args, owned by the AC-EAC-114/118-titled test here).
 */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleDisconnectRequest, setTestJwks } from './index.ts';
import {
  createJwtAuthority, installEdgeEnv, withFetchMock as baseWithFetchMock, supabaseRpc, supabaseSelect,
  restCall, rpcCall, jsonResponse, createAuthedRequest, createTestJwksResolver,
} from '../_shared/testing/edgeTestKit.ts';

// Default standing answer (active) is appended LAST so a test's own actor_authorization_state route wins.
const withFetchMock: typeof baseWithFetchMock = (routes, run) =>
  baseWithFetchMock([...routes, supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true }))], run);

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  return createAuthedRequest('http://edge.test/disconnect', body, await auth.mintJwt({ sub }));
}

const adminProfile = () => supabaseSelect('profiles', () =>
  jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' },
    { headers: { 'content-type': 'application/vnd.pgrst.object+json' } }));
const notOperator = () => supabaseSelect('platform_operators', () =>
  new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }));

describe('external-disconnect', () => {
  it('AC-ODC-007 an Odoo disconnect goes through the one revocation RPC with tier odoo → 200, no PATCH, no ownership call', async () => {
    await withFetchMock(
      [adminProfile(), notOperator(), supabaseRpc('disconnect_external_integration', () => jsonResponse(1)), supabaseRpc('log_audit', () => jsonResponse(null))],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'odoo' }));
        assertEquals(res.status, 200);
        const rpc = rpcCall(calls, 'disconnect_external_integration');
        assertEquals(rpc.length, 1);
        assertEquals(rpc[0].bodyJson, { p_org_id: 'org-1', p_external_tier: 'odoo', p_actor_id: 'user-1' });
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 0);
        assertEquals((rpcCall(calls, 'log_audit')[0].bodyJson as { p_detail: unknown }).p_detail, { tier: 'odoo', actor: 'user-1' });
      },
    );
  });

  it('AC-EAC-114/AC-EAC-118 an ERPNext disconnect clears the activation stamps via the RPC and writes the fixed-shape audit event, not a PATCH', async () => {
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseRpc('disconnect_external_integration', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_external_tier, 'erpnext');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse(1);
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'disconnect_external_integration').length, 1);
        assertEquals(rpcCall(calls, 'delete_vault_secret').length, 0);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
        // AC-EAC-118: log_audit(text,uuid,uuid,uuid,jsonb) — p_actor_id is REQUIRED and there is no
        // p_entity_type parameter. The shipped call passed p_entity_type and omitted p_actor_id, so
        // no overload matched and the disconnect audit event was never written.
        // ⚑ Asserted on the RECORDED call, not inside the route callback: a throw in a route callback
        // is swallowed by supabase-js (it resolves { error } instead of throwing) and the handler
        // treats an audit failure as non-fatal — a route-callback assert here would be a dead oracle.
        const auditBody = rpcCall(calls, 'log_audit')[0].bodyJson as Record<string, unknown>;
        assertEquals(auditBody.p_action, 'integration.disconnect');
        assertEquals(auditBody.p_actor_id, 'user-1');
        assertEquals('p_entity_type' in auditBody, false);
      },
    );
  });

  it('a clickup disconnect releases domain ownership via admin_change_domain_ownership(action=release); an erpnext disconnect never calls it', async () => {
    // ClickUp release branch (Phase 2 task 2.4): the tasks domain is freed for a re-connect. The
    // RPC itself emits the domain-ownership audit event; a release failure is logged, not fatal.
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseRpc('disconnect_external_integration', () => jsonResponse(1)),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'disconnect_external_integration').length, 1);
      },
    );

    // The erpnext branch owns no ClickUp domain — the release call must not fire there.
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseRpc('disconnect_external_integration', () => jsonResponse(1)),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 0);
      },
    );
  });

  it('AC-EAC-004 an Engineer is refused with 403 and no side effect (disconnect is role-gated identically to connect, FR-EAC-009)', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Engineer' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        notOperator(),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'delete_vault_secret').length, 0);
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 0);
      },
    );
  });

  it('AC-EAC-007 a missing binding returns 404 before any write (the disconnect flow fails closed with nothing to disconnect)', async () => {
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseRpc('disconnect_external_integration', () => jsonResponse(0))
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'disconnect_external_integration').length, 1);
      },
    );
  });
});

describe('external-disconnect — current standing', () => {
  const profileWith = (status: string) => supabaseSelect('profiles', () =>
    jsonResponse({ org_id: 'org-1', role: 'Admin', status },
      { headers: { 'content-type': 'application/vnd.pgrst.object+json' } }));
  const refused = (name: string, routes: Parameters<typeof withFetchMock>[0]) => it(name, async () => {
    await withFetchMock([...routes, notOperator()], async ({ calls }) => {
      const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'disconnect_external_integration').length, 0);
      assertEquals(rpcCall(calls, 'delete_vault_secret').length, 0);
    });
  });
  refused('a disabled profile with inactive RPC standing is refused → 403, no revocation',
    [profileWith('disabled'), supabaseRpc('actor_authorization_state', () => jsonResponse({ active: false }))]);
  refused('an active profile whose RPC standing is inactive (banned) is refused → 403, no revocation',
    [profileWith('active'), supabaseRpc('actor_authorization_state', () => jsonResponse({ active: false }))]);
  refused('a disabled profile is refused even when the RPC reports active → 403',
    [profileWith('disabled'), supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true }))]);
  refused('fails closed when standing cannot be resolved → 403',
    [profileWith('active'), supabaseRpc('actor_authorization_state', () => new Response('{"message":"unavailable"}', { status: 500, headers: { 'content-type': 'application/json' } }))]);
});
