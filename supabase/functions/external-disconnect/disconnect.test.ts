/**
 * external-disconnect — Deno unit tests against the SHIPPED handler.
 * AC-EAC-114 (stamps cleared), AC-EAC-117 (binds to shipped code — enforced by the check script,
 * not this file), AC-EAC-118 (audit args, owned by the AC-EAC-114/118-titled test here).
 */
import { describe, it, afterAll } from '@std/testing/bdd';
import { assertEquals } from '@std/assert';
import { handleDisconnectRequest, setTestJwks } from './index.ts';
import {
  createJwtAuthority, installEdgeEnv, withFetchMock, supabaseRpc, supabaseSelect,
  restCall, rpcCall, jsonResponse, createAuthedRequest, createTestJwksResolver,
} from '../_shared/testing/edgeTestKit.ts';

const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);
setTestJwks(createTestJwksResolver(auth));
afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  return createAuthedRequest('http://edge.test/disconnect', body, await auth.mintJwt({ sub }));
}

const adminProfile = () => supabaseSelect('profiles', () =>
  jsonResponse({ org_id: 'org-1', role: 'Admin' },
    { headers: { 'content-type': 'application/vnd.pgrst.object+json' } }));
const notOperator = () => supabaseSelect('platform_operators', () =>
  new Response('null', { status: 200, headers: { 'content-type': 'application/json' } }));

describe('external-disconnect', () => {
  it('AC-EAC-114/AC-EAC-118 an ERPNext disconnect clears the activation stamps via the RPC and writes the fixed-shape audit event, not a PATCH', async () => {
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', webhook_secret_ref: null },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('delete_vault_secret', () => jsonResponse(null)),
        supabaseRpc('deactivate_external_binding', (call) => {
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
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 1);
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
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', webhook_secret_ref: null },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('delete_vault_secret', () => jsonResponse(null)),
        supabaseRpc('deactivate_external_binding', () => jsonResponse(1)),
        supabaseRpc('admin_change_domain_ownership', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_external_tier, 'clickup');
          assertEquals(body.p_domain, 'tasks');
          assertEquals(body.p_action, 'release');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse(null);
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 1);
      },
    );

    // The erpnext branch owns no ClickUp domain — the release call must not fire there.
    await withFetchMock(
      [
        adminProfile(), notOperator(),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', webhook_secret_ref: null },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('delete_vault_secret', () => jsonResponse(null)),
        supabaseRpc('deactivate_external_binding', () => jsonResponse(1)),
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
        supabaseSelect('external_org_bindings', () =>
          new Response('null', { status: 200, headers: { 'content-type': 'application/json' } })),
      ],
      async ({ calls }) => {
        const res = await handleDisconnectRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'deactivate_external_binding').length, 0);
      },
    );
  });
});
