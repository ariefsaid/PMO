/**
 * external-connect edge fn — Deno unit tests (task 2.2 + P2 fixes).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - Admin + valid ClickUp token → 200, RPC create_vault_secret_for_org, RPC admin_change_domain_ownership
 * - Operator + valid ClickUp token → 200
 * - non-Admin/non-Operator → 403, no Vault RPC, no ownership RPC
 * - invalid ClickUp token (api.clickup.com/api/v2/user 401) → 422, no Vault write
 * - Admin + valid ERPNext creds → 200, Vault RPC only
 * - SSRF-rejected ERP URL → 422, no ERP fetch beyond validation, no Vault write
 * - invalid JWT → 401
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleConnectRequest, setTestJwks, testSupabaseOptions } from './index.ts';
import {
  createJwtAuthority,
  installEdgeEnv,
  withFetchMock,
  supabaseRpc,
  supabaseSelect,
  restCall,
  rpcCall,
  jsonResponse,
  clickup,
  erp,
  createAuthedRequest,
  createTestJwksResolver,
} from '../_shared/testing/edgeTestKit.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// One stable authority + env per test module (see TEST-ARCH.md _jwks memoization nuance)
const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// Install test JWKS resolver (no background intervals)
setTestJwks(createTestJwksResolver(auth));

afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  const jwt = await auth.mintJwt({ sub });
  return createAuthedRequest('http://edge.test/connect', body, jwt);
}

describe('external-connect — ClickUp branch', () => {
  it('Admin + valid ClickUp token → 200, Vault RPC + ownership RPC', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseRpc('create_vault_secret_for_org', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_external_tier, 'clickup');
          assertEquals(typeof body.p_secret_value, 'string');
          assertEquals(typeof body.p_secret_name, 'string');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse('vault-ref-123');
        }),

        supabaseRpc('admin_change_domain_ownership', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_external_tier, 'clickup');
          assertEquals(body.p_domain, 'tasks');
          assertEquals(body.p_action, 'employ');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse(null);
        }),

        // The real ClickUp `GET /user` shape is `{ user: { id, username, ... } }` (live-smoke
        // 2026-07-17). We already call this to validate the token — now we also persist the id (the
        // echo-loop guard's actor id, item 4 of the read-hygiene fix).
        clickup('/api/v2/user', () => jsonResponse({ user: { id: 123, username: 'test-user' } })),
        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-123' }] })),

        // Both identities land in ONE atomic patch: clickup_actor_id arms the echo-loop guard,
        // clickup_team_id lets the webhook worker resolve the org before any ClickUp call.
        supabaseRpc('merge_external_org_binding_config', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_external_tier, 'clickup');
          assertEquals(body.p_patch, { clickup_actor_id: '123', clickup_team_id: 'team-123' });
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: { token: 'valid-token' } }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true, binding: { secret_ref: 'vault-ref-123', status: 'active' } });
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 1);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 1);
        assertEquals(rpcCall(calls, 'merge_external_org_binding_config').length, 1);
      },
    );
  });

  it('Operator + valid ClickUp token → 200', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Engineer' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () =>
          jsonResponse({ user_id: 'user-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('create_vault_secret_for_org', () => jsonResponse('vault-ref-456')),

        supabaseRpc('admin_change_domain_ownership', () => jsonResponse(null)),

        clickup('/api/v2/user', () => jsonResponse({ user: { id: 456, username: 'operator-user' } })),
        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-456' }] })),

        supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: { token: 'valid-token' } }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 1);
        assertEquals(rpcCall(calls, 'merge_external_org_binding_config').length, 1);
      },
    );
  });

  it('non-Admin/non-Operator → 403, no Vault RPC, no ownership RPC', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Project Manager' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: { token: 'any-token' } }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 0);
      },
    );
  });

  it('GET /user response missing a user id → connect still succeeds, no actor id persisted', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseRpc('create_vault_secret_for_org', () => jsonResponse('vault-ref-789')),

        supabaseRpc('admin_change_domain_ownership', () => jsonResponse(null)),

        // No `user.id` in the response — an unexpected/degraded wire shape must not block the connect
        // (the token itself validated fine, res.ok); it only means the echo-loop guard can't be armed
        // for this org until a later reconnect gets a well-formed response.
        clickup('/api/v2/user', () => jsonResponse({ user: {} })),
        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-789' }] })),

        supabaseRpc('merge_external_org_binding_config', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: { token: 'valid-token' } }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 1);
        // No client-side read-then-write on the config jsonb — the atomic RPC is the only path.
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
      },
    );
  });

  it('invalid ClickUp token (401) → 422, no Vault write', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        clickup('/api/v2/user', () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: { token: 'bad-token' } }));
        assertEquals(res.status, 422);
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
      },
    );
  });
});

describe('external-connect — ERPNext branch', () => {
  it('Admin + valid ERPNext creds → 200, Vault RPC only', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseRpc('create_vault_secret_for_org', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_external_tier, 'erpnext');
          assertEquals(body.p_secret_value, 'api-key:api-secret');
          assertEquals(typeof body.p_secret_name, 'string');
          assertEquals(body.p_actor_id, 'user-1');
          return jsonResponse('vault-ref-erp');
        }),

        erp('erp.example.com', '/api/resource/User/api-key', () => jsonResponse({ data: { name: 'api-key' } })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({
          tier: 'erpnext',
          credential: { siteUrl: 'https://erp.example.com', apiKey: 'api-key', apiSecret: 'api-secret' },
        }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true, binding: { secret_ref: 'vault-ref-erp', status: 'active' } });
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 1);
        assertEquals(rpcCall(calls, 'admin_change_domain_ownership').length, 0); // no ownership RPC for ERPNext
      },
    );
  });

  it('SSRF-rejected ERP URL → 422, no ERP fetch beyond validation, no Vault write', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({
          tier: 'erpnext',
          credential: { siteUrl: 'http://192.168.1.100', apiKey: 'key', apiSecret: 'secret' },
        }));
        assertEquals(res.status, 422);
        assertEquals(rpcCall(calls, 'create_vault_secret_for_org').length, 0);
      },
    );
  });
});

describe('external-connect — JWT validation', () => {
  it('invalid JWT → 401', async () => {
    await withFetchMock(
      [],
      async () => {
        const req = new Request('http://edge.test/connect', {
          method: 'POST',
          headers: { Authorization: 'Bearer invalid.jwt.token', 'content-type': 'application/json' },
          body: JSON.stringify({ tier: 'clickup', credential: { token: 'any' } }),
        });
        const res = await handleConnectRequest(req);
        assertEquals(res.status, 401);
      },
    );
  });

  it('missing Authorization header → 401', async () => {
    await withFetchMock(
      [],
      async () => {
        const req = new Request('http://edge.test/connect', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tier: 'clickup', credential: { token: 'any' } }),
        });
        const res = await handleConnectRequest(req);
        assertEquals(res.status, 401);
      },
    );
  });

  it('unknown tier → 400', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'unknown', credential: {} }));
        assertEquals(res.status, 400);
      },
    );
  });

  it('missing ClickUp token → 400', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'clickup', credential: {} }));
        assertEquals(res.status, 400);
      },
    );
  });

  it('missing ERPNext fields → 400', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleConnectRequest(await authed({ tier: 'erpnext', credential: { siteUrl: 'https://erp.example.com' } }));
        assertEquals(res.status, 400);
      },
    );
  });
});