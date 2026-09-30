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
  type FetchCall,
} from '../_shared/testing/edgeTestKit.ts';

// One stable authority + env per test module (see TEST-ARCH.md _jwks memoization nuance)
const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// Install test JWKS resolver (no background intervals)
setTestJwks(createTestJwksResolver(auth));

afterAll(() => env.restore());

/** The org's ERPNext domain ownership (#656 — the probe scope) + every probed doctype readable. The
 *  probe paths are `/api/resource/<DocType>` (one segment), so the Company lookup never matches here. */
function activationProbeRoutes(
  domains: string[] = ['procurement'],
  answer: (doctype: string) => Response = () => jsonResponse({ data: [] }),
) {
  return [
    supabaseSelect('external_domain_ownership', () => jsonResponse(domains.map((domain) => ({ domain })))),
    erp('erp.example.com', /^\/api\/resource\/[^/]+$/, (call) =>
      answer(decodeURIComponent(call.url.pathname.slice('/api/resource/'.length)))),
  ];
}

function probedDoctypes(calls: FetchCall[]): string[] {
  return calls
    .filter((c) => c.url.host === 'erp.example.com' && /^\/api\/resource\/[^/]+$/.test(c.url.pathname))
    .map((c) => decodeURIComponent(c.url.pathname.slice('/api/resource/'.length)));
}

/** Everything up to (and including) a supported handshake — the shared prefix of the #656 journeys. */
function throughHandshake() {
  return [
    supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
      { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
    activeMemberRoute(),
    supabaseSelect('platform_operators', () => new Response('null',
      { status: 200, headers: { 'content-type': 'application/json' } })),
    supabaseSelect('external_org_bindings', () =>
      jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
        { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
    supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
    erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),
    erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
      () => jsonResponse({ erpnext: { version: '16.33.0' } })),
  ];
}

/** The caller's CURRENT standing (#656 review): an active member of their org. */
function activeMemberRoute(active = true) {
  return supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active }));
}

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

        activeMemberRoute(),
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
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),

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

        activeMemberRoute(),
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
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),

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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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

        activeMemberRoute(),
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
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),

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
        activeMemberRoute(),
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
        activeMemberRoute(),
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
        // Review #650: the 422 vocabulary is the handler's existing CONFIG_REJECTED (one outlier said
        // 'config-rejected'); the refusal GOAL is unchanged — legible 422, nothing written.
        assertEquals(body.error, 'CONFIG_REJECTED');
        assert(body.message.includes('14'));
        assert(body.message.includes('15 and 16'));
        assertEquals(body.reason, 'erpnext-unsupported-version');
        assertEquals(body.versionMajor, 14);
        assertEquals(body.supportedMajors, [15, 16]);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
      },
    );
  });

  it('AC-EAC-105 the handshake runs before any write — Company-validate → version-handshake → activation RPC, and no direct PATCH', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        activeMemberRoute(),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' },
            { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),
        erp('erp.example.com', '/api/method/frappe.utils.change_log.get_versions',
          () => jsonResponse({ erpnext: { version: '15.94.3' } })),
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),
        supabaseRpc('activate_external_binding', () => jsonResponse('2026-09-14T00:00:00+00:00')),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        // The write moved into the RPC — there is no direct PATCH any more.
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 0);
        // Company validation precedes the handshake, which precedes the write.
        const order = calls.map((c) => c.url.pathname);
        assert(order.indexOf('/api/resource/Company/ACME')
             < order.indexOf('/api/method/frappe.utils.change_log.get_versions'));
        assert(order.indexOf('/api/method/frappe.utils.change_log.get_versions')
             < order.indexOf('/rest/v1/rpc/activate_external_binding'));
      },
    );
  });

  it('AC-EAC-107 a v15 handshake activates with the Company account defaults', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        activeMemberRoute(),
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
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),
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
      },
    );
  });

  it('AC-EAC-108 a v16 handshake activates (DD-OPS-10 — RIS targets v16.33); the v16.33 Company shape (four defaults present, default_bank_account ABSENT) maps bank to null', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        activeMemberRoute(),
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
        // #656: the read-permission probe runs between the handshake and the activation RPC.
        ...activationProbeRoutes(),
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

  // ── #656: the integration user's read permissions are probed before activated_at is stamped ──────

  it('AC-ENA-074 (#656) a user missing reads is refused with a 422 naming EVERY unreadable doctype, and nothing is activated', async () => {
    await withFetchMock(
      [
        ...throughHandshake(),
        ...activationProbeRoutes(['timesheets'], (doctype) =>
          doctype === 'Timesheet' || doctype === 'GL Entry'
            ? jsonResponse({ exc_type: 'PermissionError', message: 'Not permitted' }, { status: 403 })
            : jsonResponse({ data: [] })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 422);
        const body = await res.json();
        assertEquals(body.error, 'CONFIG_REJECTED');
        assert(body.message.includes('Timesheet'), body.message);
        assert(body.message.includes('GL Entry'), body.message);
        assert(!body.message.includes('Employee'), 'a readable doctype is not named');
        // The structured reason the Company dialog renders in the viewer's language.
        assertEquals(body.reason, 'erpnext-missing-read-permissions');
        assertEquals(body.missing, ['Timesheet', 'GL Entry']);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('AC-ENA-074 (#656) an unreachable site during the probe is a 502 (not a permission claim), and nothing is activated', async () => {
    await withFetchMock(
      [
        ...throughHandshake(),
        ...activationProbeRoutes(['procurement'], (doctype) =>
          doctype === 'GL Entry' ? jsonResponse({ exc_type: 'ServiceUnavailable' }, { status: 503 }) : jsonResponse({ data: [] })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 502);
        assertEquals((await res.json()).error, 'external-unreachable');
        // The 5s/no-retry budget: the failing probe got exactly one attempt.
        assertEquals(probedDoctypes(calls).filter((d) => d === 'GL Entry').length, 1);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
      },
    );
  });

  it('#656 an unreadable domain ownership fails closed with a 500, and nothing is activated', async () => {
    await withFetchMock(
      [
        ...throughHandshake(),
        supabaseSelect('external_domain_ownership', () => jsonResponse({ message: 'boom', code: 'XX000' }, { status: 500 })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 500);
        assertEquals(probedDoctypes(calls).length, 0);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
      },
    );
  });

  it('#656 a fully readable user activates; the probe covers the owned domains + ledgers only, after the handshake, never following redirects', async () => {
    await withFetchMock(
      [
        ...throughHandshake(),
        ...activationProbeRoutes(['procurement']),
        supabaseRpc('activate_external_binding', () => jsonResponse('2026-09-14T00:00:00+00:00')),
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 200);
        const probed = probedDoctypes(calls);
        for (const d of ['Purchase Order', 'Purchase Invoice', 'Payment Entry', 'GL Entry', 'Payment Ledger Entry']) {
          assert(probed.includes(d), `expected ${d} to be probed — got ${probed.join(', ')}`);
        }
        assert(!probed.includes('Timesheet') && !probed.includes('Sales Invoice'), `unowned domains are not probed — got ${probed.join(', ')}`);
        const order = calls.map((c) => c.url.pathname);
        const firstProbe = calls.findIndex((c) => c.url.pathname === '/api/resource/GL%20Entry');
        assert(order.indexOf('/api/method/frappe.utils.change_log.get_versions') < firstProbe);
        assert(firstProbe < order.indexOf('/rest/v1/rpc/activate_external_binding'));
        for (const c of calls.filter((c) => c.url.host === 'erp.example.com' && c.url.pathname !== '/api/resource/Company/ACME')) {
          assertEquals(c.redirect, 'manual', `${c.url.pathname} must not follow redirects`);
        }
      },
    );
  });

  // ── #656 review: caller standing + the probe's total time budget ─────────────────────────────────

  it('AC-ENA-074 (#656) a disabled or banned Admin with a valid token is refused 403 and nothing is read or activated', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseRpc('actor_authorization_state', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_org_id, 'org-1');
          assertEquals(body.p_user_id, 'user-1');
          return jsonResponse({ role: 'Admin', active: false });
        }),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_org_bindings').length, 0);
        assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(calls.filter((c) => c.url.host === 'erp.example.com').length, 0);
      },
    );
  });

  it('#656 an unresolvable caller standing fails closed with a 403', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () => jsonResponse({ org_id: 'org-1', role: 'Admin' },
          { headers: { 'content-type': 'application/vnd.pgrst.object+json' } })),
        supabaseSelect('platform_operators', () => new Response('null',
          { status: 200, headers: { 'content-type': 'application/json' } })),
        supabaseRpc('actor_authorization_state', () => jsonResponse({ message: 'boom', code: 'XX000' }, { status: 500 })),
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
      },
    );
  });

  it('AC-ENA-074 (#656) a slow site that exhausts the probe budget is a 502 before the browser gives up, and nothing is activated', async () => {
    // Every probe answers inside its own per-call deadline (3s < 5s), but 9 probes 4 at a time need a third
    // round that cannot finish before 9s — and the 7s total-budget timer is always due first, so the cap
    // is the only way out. The oracle is the outcome, not elapsed time; the fake honours the abort so
    // nothing outlives the test.
    const slowProbe = (call: FetchCall) => new Promise<Response>((resolve, reject) => {
      const t = setTimeout(() => resolve(jsonResponse({ data: [] })), 3_000);
      call.signal.addEventListener('abort', () => { clearTimeout(t); reject(call.signal.reason); });
    });
    await withFetchMock(
      [
        ...throughHandshake(),
        supabaseSelect('external_domain_ownership', () => jsonResponse([{ domain: 'procurement' }])),
        { label: 'slow probe', host: 'erp.example.com', pathname: /^\/api\/resource\/[^/]+$/, response: slowProbe },
      ],
      async ({ calls }) => {
        const res = await handleSetCompanyRequest(await authed({ tier: 'erpnext', companyId: 'ACME' }));
        assertEquals(res.status, 502);
        assertEquals((await res.json()).error, 'external-unreachable');
        assertEquals(rpcCall(calls, 'activate_external_binding').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });
});
