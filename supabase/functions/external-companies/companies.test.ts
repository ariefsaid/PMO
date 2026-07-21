/**
 * external-companies edge fn — Deno unit tests (OD-INT-6).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - Admin can fetch companies
 * - Operator can fetch companies
 * - Engineer gets 403
 * - Missing binding returns 404
 * - Inactive binding returns 422
 * - Vault secret missing returns 422
 * - ERP 404 → edge fn 404
 * - ERP network failure → 502
 * - SSRF-rejected binding site_url → 422
 * - Audit asserted on success only
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleCompaniesRequest, setTestJwks, testSupabaseOptions } from './index.ts';
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
  return createAuthedRequest('http://edge.test/companies', body, jwt);
}

describe('external-companies — ERPNext branch', () => {
  it('Admin OK — returns companies', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company', () => jsonResponse({
          data: [
            { name: 'ACME Corp' },
            { name: 'Global Industries' },
            { name: 'Test Company' },
          ],
        })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.companies.length, 3);
        assertEquals(data.companies.map((c: { name: string }) => c.name).sort(), ['ACME Corp', 'Global Industries', 'Test Company']);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company', () => jsonResponse({ data: [{ name: 'ACME' }] })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
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
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 403);
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
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'inactive', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 422);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('ERP 404 → edge fn 404', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company', () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company', () => new Response(JSON.stringify({ error: 'server error' }), { status: 500 })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 502);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('SSRF-rejected binding site_url → 422', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'http://192.168.1.100' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 422);
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company', () => jsonResponse({ data: [{ name: 'ACME' }] })),

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.list_companies');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'erpnext');
          auditCalled = true;
          return jsonResponse(null);
        }),
      ],
      async () => {
        const res = await handleCompaniesRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(auditCalled, true);
      },
    );
  });
});