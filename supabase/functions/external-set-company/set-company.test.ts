/**
 * external-set-company edge fn — Deno unit tests (OD-INT-6).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - Admin can set company
 * - Operator can set company
 * - Engineer gets 403
 * - Missing binding returns 404
 * - Inactive binding returns 422
 * - Vault secret missing returns 422
 * - Company not found in ERP 404
 * - ERP network failure → 502
 * - Invalid companyId 400
 * - Audit asserted on success only
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleSetCompanyRequest, setTestJwks, testSupabaseOptions } from './index.ts';
import {
  createJwtAuthority,
  installEdgeEnv,
  withFetchMock,
  supabaseRpc,
  supabaseSelect,
  restCall,
  rpcCall,
  jsonResponse,
  createAuthedRequest,
  createTestJwksResolver,
  erp,
} from '../_shared/testing/edgeTestKit.ts';

// One stable authority + env per test module (see TEST-ARCH.md _jwks memoization nuance)
const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// Install test JWKS resolver (no background intervals)
setTestJwks(createTestJwksResolver(auth));

afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  const jwt = await auth.mintJwt({ sub });
  return createAuthedRequest('http://edge.test/set-company', body, jwt);
}

describe('external-set-company — ERPNext branch', () => {
  it('Admin OK — sets config.company', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/ACME%20Corp', () => jsonResponse({ data: { name: 'ACME Corp' } })),

        {
          label: 'update company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, 'ACME Corp');
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.set_company');
          assertEquals((body.p_detail as Record<string, unknown>).company_id, 'ACME Corp');
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME Corp' }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true, companyId: 'ACME Corp' });
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('Operator OK', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),

        {
          label: 'update company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, 'ACME');
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('Engineer 403', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Engineer' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('missing binding 404', async () => {
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

        supabaseSelect('external_org_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('inactive binding 422', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'inactive', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('Vault secret missing 422', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('company not found in ERP 404', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/NONEXISTENT', () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'NONEXISTENT' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('ERP network/non-404 failure → 502', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/ACME', () => new Response(JSON.stringify({ error: 'server error' }), { status: 500 })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 502);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('invalid companyId 400', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: '' }));
        assertEquals(res.status, 400);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('no PATCH on 4xx/5xx preconditions', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Engineer' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('audit event logged on success', async () => {
    let auditCalled = false;
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),

        {
          label: 'update company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, 'ACME');
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.set_company');
          assertEquals((body.p_detail as Record<string, unknown>).company_id, 'ACME');
          auditCalled = true;
          return jsonResponse(null);
        }),
      ],
      async () => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(auditCalled, true);
      },
    );
  });
});