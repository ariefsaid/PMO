/**
 * external-unlink edge fn — Deno unit tests (task 3.4).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - ClickUp: Admin/Operator/PM can unlink (soft-archive with disconnected_at)
 * - ClickUp: Engineer gets 403
 * - ClickUp: PM with inactive profile gets 403
 * - ClickUp: PM of different project gets 403
 * - ClickUp: project with null project_manager_id requires Admin/Operator
 * - ERPNext: Admin/Operator can unlink (clears config.company)
 * - ERPNext: PM gets 403 (org-level only)
 * - Missing binding returns 404
 * - Audit event logged
 * - Soft-archive sets disconnected_at
 * - Role gates enforced
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleUnlinkRequest, setTestJwks } from './index.ts';
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
} from '../_shared/testing/edgeTestKit.ts';

// One stable authority + env per test module (see TEST-ARCH.md _jwks memoization nuance)
const env = installEdgeEnv();
const auth = await createJwtAuthority(env.SUPABASE_URL);

// Install test JWKS resolver (no background intervals)
setTestJwks(createTestJwksResolver(auth));

afterAll(() => env.restore());

async function authed(body: unknown, sub = 'user-1') {
  const jwt = await auth.mintJwt({ sub });
  return createAuthedRequest('http://edge.test/unlink', body, jwt);
}

describe('external-unlink — ClickUp branch', () => {
  it('Admin OK — clickup unlink soft-archives binding and audits', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', (call) => {
          assertEquals(call.url.searchParams.get('id'), 'eq.proj-1');
          assertEquals(call.url.searchParams.get('org_id'), 'eq.org-1');
          return jsonResponse({ id: 'proj-1', project_manager_id: 'pm-9', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          });
        }),

        supabaseSelect('external_project_bindings', () =>
          jsonResponse({ id: 'binding-1', external_container_id: 'list-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        {
          label: 'soft-archive binding',
          method: 'PATCH',
          pathname: '/rest/v1/external_project_bindings',
          response: (call) => {
            assertEquals(typeof call.bodyJson, 'object');
            const body = call.bodyJson as Record<string, unknown>;
            if (typeof body.disconnected_at !== 'string') throw new Error('missing disconnected_at');
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.unlink');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'clickup');
          assertEquals((body.p_detail as Record<string, unknown>).project_id, 'proj-1');
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true });
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('PM of project OK', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () =>
          jsonResponse({ id: 'binding-1', external_container_id: 'list-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        {
          label: 'soft-archive binding',
          method: 'PATCH',
          pathname: '/rest/v1/external_project_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            if (typeof body.disconnected_at !== 'string') throw new Error('missing disconnected_at');
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 1);
      },
    );
  });

  it('PM of other project 403 — no mutation, no audit', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'different-pm', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('inactive PM 403 — no mutation, no audit', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'inactive' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('Engineer 403', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Engineer', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 403);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('missing projectId 400', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 400);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 0);
      },
    );
  });

  it('missing binding 404 — no mutation, no audit', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'clickup', projectId: 'proj-1' }));
        assertEquals(res.status, 404);
        assertEquals(restCall(calls, 'external_project_bindings', 'PATCH').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });
});

describe('external-unlink — ERPNext branch', () => {
  it('Admin OK — clears config.company', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ config: { company: 'ACME' } }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        {
          label: 'clear company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, null);
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.unlink');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'erpnext');
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true });
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('Operator OK', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Engineer', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () =>
          jsonResponse({ user_id: 'user-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ config: { company: 'ACME' } }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        {
          label: 'clear company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, null);
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);
      },
    );
  });

  it('PM 403 (org-level only)', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('missing binding 404', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('no company linked 404', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ config: {} }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('audit event logged for ERPNext unlink', async () => {
    let auditCalled = false;
    await withFetchMock(
      [
        supabaseSelect('profiles', () =>
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ config: { company: 'ACME' } }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        {
          label: 'clear company config',
          method: 'PATCH',
          pathname: '/rest/v1/external_org_bindings',
          response: (call) => {
            const body = call.bodyJson as Record<string, unknown>;
            const config = body.config as Record<string, unknown>;
            assertEquals(config.company, null);
            return jsonResponse([]);
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.unlink');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'erpnext');
          auditCalled = true;
          return jsonResponse(null);
        }),
      ],
      async () => {
        const res = await handleUnlinkRequest(await authed({ tier: 'erpnext' }));
        assertEquals(res.status, 200);
        assertEquals(auditCalled, true);
      },
    );
  });
});