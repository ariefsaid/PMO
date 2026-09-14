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
import { assertEquals, assertRejects, assert } from '@std/assert';
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

        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),

        // FR-EAC-106 (#650): the write moved into the activation RPC so company/version/stamp cannot
        // land partially. Goal oracle unchanged — the selected Company is persisted for this org.
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_company, 'ACME Corp');
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),

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
        assertEquals(await res.json(), {
          ok: true, companyId: 'ACME Corp', versionMajor: 15, activatedAt: '2026-09-14T00:00:00+00:00',
        });
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
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

        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),

        // FR-EAC-106 (#650): the config write moved into the activation RPC (mechanism change; the
        // goal oracle — the selected Company is what gets written — is asserted on the RPC args).
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_company, 'ACME');
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
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

        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),

        // FR-EAC-106 (#650): the config write moved into the activation RPC; the audit test now
        // asserts the company on the RPC args instead of the retired PATCH body.
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_company, 'ACME');
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),

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

  it('AC-EAC-104 an empty site_url refuses Company selection before any external call', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: '' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        assertEquals((await res.json()).error, 'CONFIG_REJECTED');
        assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
      },
    );
  });

  it('AC-EAC-106 an unsupported ERPNext major refuses with a legible 422 and writes nothing', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '14.30.1' } })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        const body = await res.json();
        assertEquals(body.error, 'config-rejected');
        assert(body.message.includes('14'));
        assert(body.message.includes('15 and 16'));
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
      },
    );
  });

  it('AC-EAC-107 a v15 handshake activates with the Company account defaults', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({
          data: { name: 'ACME', default_payable_account: 'Creditors - A', default_cash_account: 'Cash - A' },
        })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_version_major, 15);
          assertEquals(body.p_company, 'ACME');
          const patch = body.p_config_patch as Record<string, unknown>;
          assertEquals(patch.default_payable_account, 'Creditors - A');
          assertEquals(patch.default_cash_account, 'Cash - A');
          assertEquals(patch.default_bank_account, null);
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), {
          ok: true, companyId: 'ACME', versionMajor: 15, activatedAt: '2026-09-14T00:00:00+00:00',
        });
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
        // AC-EAC-105: the write moved into the RPC — there is no direct PATCH any more.
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        // AC-EAC-105: Company validation precedes the handshake, which precedes the write.
        const order = calls.map((c) => c.url.pathname);
        assert(order.indexOf('/api/resource/Company/ACME')
             < order.indexOf('/api/method/frappe.utils.change_log.get_versions'));
        assert(order.indexOf('/api/method/frappe.utils.change_log.get_versions')
             < order.indexOf('/rest/v1/rpc/activate_external_binding'));
      },
    );
  });

  it('AC-EAC-108 a v16 handshake activates (DD-OPS-10 — RIS targets v16.33); the v16.33 Company shape (four defaults present, default_bank_account ABSENT) maps bank to null', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        // The EXACT v16.33 shape from the live bench (Director ruling on plan premise 2):
        // default_bank_account is not null-valued — the KEY is not on the doc at all.
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({
          data: {
            name: 'ACME',
            default_payable_account: 'Creditors - PSC',
            default_cash_account: 'Cash - PSC',
            default_expense_account: 'Cost of Goods Sold - PSC',
            cost_center: 'Main - PSC',
          },
        })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '16.33.0' } })),
        supabaseRpc('activate_external_binding', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_version_major, 16);
          const patch = body.p_config_patch as Record<string, unknown>;
          assertEquals(patch.default_payable_account, 'Creditors - PSC');
          assertEquals(patch.default_cash_account, 'Cash - PSC');
          assertEquals(patch.default_expense_account, 'Cost of Goods Sold - PSC');
          assertEquals(patch.cost_center, 'Main - PSC');
          // The absent v16 key must map to null ("no default"), never undefined.
          assertEquals(patch.default_bank_account, null);
          assertEquals('default_bank_account' in patch, true);
          return jsonResponse('2026-09-14T00:00:00+00:00');
        }),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 1);
      },
    );
  });
});