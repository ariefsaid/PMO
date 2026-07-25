/**
 * external-link edge fn — Deno unit tests (tasks 3.2, 3.3).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - ClickUp: push-seed requires empty List, pull-adopt requires empty PMO project
 * - ClickUp: mixed case (both non-empty) returns 409 action-required
 * - ClickUp: valid link inserts external_project_bindings with linked_by/linked_at
 * - ERPNext: validates Company exists, updates external_org_bindings.config.company
 * - Role gates: Admin/PM/Operator for ClickUp, Admin/Operator for ERPNext
 * - Audit events logged for integration.link
 * - getPmoTaskCount uses HEAD+count via Content-Range (catches count-path bug)
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleLinkRequest, setTestJwks, testSupabaseOptions } from './index.ts';
import {
  createJwtAuthority,
  installEdgeEnv,
  withFetchMock,
  supabaseRpc,
  supabaseSelect,
  restCall,
  rpcCall,
  jsonResponse,
  countResponse,
  clickup,
  erp,
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
  return createAuthedRequest('http://edge.test/link', body, jwt);
}

// The real, default ClickUp workspace shape (2026-07-20 workspace probe — mirrors the committed
// fixture `_shared/testing/fixtures/clickup-webhook/list-statuses.json`): open/custom/closed only, no
// second custom status. OD-INT-10 round 3 reverted round 2's pairwise-distinctness requirement — a
// fresh ClickUp workspace ships exactly THIS shape, and forcing a customer to add a fourth status
// before they may link inverts ADR-0055 (the external system owns its own domain vocabulary). Every
// PMO status still gets an EXPLICIT, RECORDED resolution: To Do/In Progress/Done map normally,
// Blocked resolves `pmo-only` (see the dedicated LINK-succeeds test below) — so this List IS linkable.
// Tests that must reach a successful link (past the link-time status-map validation) use this; tests
// that fail earlier (role gate, mixed-content, list not found) are unaffected and keep the bare
// `{ name: 'Test List' }` response.
const LINKABLE_LIST = {
  name: 'Test List',
  statuses: [
    { status: 'to do', type: 'open', orderindex: 0 },
    { status: 'in progress', type: 'custom', orderindex: 1 },
    { status: 'complete', type: 'closed', orderindex: 2 },
  ],
};

// A List with no members configured — the routine, non-fatal case for the member-map join.
const NO_MEMBERS = { members: [] as Array<{ id: number; email?: string }> };

describe('external-link — ClickUp branch', () => {
  it('Admin OK — push-seed with empty List succeeds', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () => jsonResponse(NO_MEMBERS)),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'pm-9', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        // PMO task count via HEAD+count
        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },

        {
          label: 'insert binding',
          method: 'POST',
          pathname: '/rest/v1/external_project_bindings',
          searchParams: { select: 'id' },
          response: (call) => {
            const body = call.bodyJson as {
              config: { statusMap: { pmoToClickUp: Record<string, string>; pmoOnlyStatuses?: string[] } };
            };
            // OD-INT-10: the persisted config must record an explicit resolution for all four PMO
            // statuses, never the empty maps this bug used to ship.
            assertEquals(body.config.statusMap.pmoToClickUp['To Do'], 'to do');
            assertEquals(body.config.statusMap.pmoToClickUp['In Progress'], 'in progress');
            assertEquals(body.config.statusMap.pmoToClickUp.Done, 'complete');
            // Round 3 (OD-INT-10): this List has no second custom status, so Blocked has NO ClickUp
            // entry — it resolves `pmo-only` instead of silently colliding with In Progress's target
            // (round 2's fix for exactly that corruption).
            assertEquals(body.config.statusMap.pmoToClickUp.Blocked, undefined);
            assertEquals(body.config.statusMap.pmoOnlyStatuses, ['Blocked']);
            return jsonResponse([{ id: 'binding-1' }], { status: 201 });
          },
        },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.link');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'clickup');
          assertEquals((body.p_detail as Record<string, unknown>).direction, 'push-seed');
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_project_bindings', 'POST').length, 1);
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () => jsonResponse(NO_MEMBERS)),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },

        { label: 'insert binding', method: 'POST', pathname: '/rest/v1/external_project_bindings', searchParams: { select: 'id' }, response: () => jsonResponse([{ id: 'binding-1' }], { status: 201 }) },
        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_project_bindings', 'POST').length, 1);
      },
    );
  });

  it('PM of other project 403', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'different-pm', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('inactive PM 403', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 403);
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('List not found 404', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        clickup('/api/v2/list/list-999', () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-999',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('mixed content (both non-empty) → 409', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [{ id: 't1' }] })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('log_audit', () => jsonResponse(null)), // count query

        // PMO task count via HEAD+count
        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(3) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 409);
        assertEquals(rpcCall(calls, 'log_audit').length, 0); // audit NOT called on 409
      },
    );
  });

  it('push-seed with non-empty List → 409', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [{ id: 't1' }] })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 409);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('push-seed with a List holding only closed/archived tasks → 409 (not read as empty)', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        // The List's ONLY task is closed+archived. With the default GET /list/{id}/task filters
        // (the OLD behaviour) ClickUp would omit it and this would read as an empty List — push-seed
        // would then proceed to seed into a List that already has content. The count path must pass
        // the full filter set so this task is counted.
        clickup('/api/v2/list/list-1/task', (call) => {
          assertEquals(call.url.searchParams.get('include_closed'), 'true');
          assertEquals(call.url.searchParams.get('archived'), 'true');
          assertEquals(call.url.searchParams.get('subtasks'), 'true');
          assertEquals(call.url.searchParams.get('include_timl'), 'true');
          return jsonResponse({ tasks: [{ id: 't1', archived: true, status: { status: 'closed' } }] });
        }),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 409);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('pull-adopt with non-empty PMO project → 409', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(5) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'pull-adopt',
        }));
        assertEquals(res.status, 409);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('list already actively bound → 409', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () => jsonResponse(NO_MEMBERS)),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () =>
          jsonResponse({ id: 'binding-2', project_id: 'proj-2' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 409);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('project already linked (23505) → 409', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () => jsonResponse(NO_MEMBERS)),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },

        { label: 'insert binding 23505', method: 'POST', pathname: '/rest/v1/external_project_bindings', response: () => new Response(JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null }), { status: 409, headers: { 'content-type': 'application/json' } }) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 409);
      },
    );
  });

  // HANDLER-BOUND mutation check (security audit, round 2): unlike the pure-predicate mutation test in
  // statusMapBuilder.test.ts (which only proves statusMapCoversAllPmoStatuses itself works), THIS test
  // drives the real handleLinkRequest end-to-end and asserts both the status code AND the error body
  // shape. Deleting the `if (!statusMapCoversAllPmoStatuses(statusMap))` branch in index.ts flips this
  // to 500 (an unmocked downstream call throws) — verified RED, then restored GREEN.
  it('OD-INT-10: a List whose statuses cannot cover the four PMO statuses is rejected → 422', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        // A List with ONLY a single open-type status: never a Done target -> coverage MUST fail.
        clickup('/api/v2/list/list-1', () =>
          jsonResponse({ name: 'Test List', statuses: [{ status: 'open', type: 'open', orderindex: 0 }] })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 422);
        const errorBody = (await res.json()) as { error: string; message: string };
        assertEquals(errorBody.error, 'CONFIG_REJECTED');
        assertEquals(
          errorBody.message.includes('cannot represent every PMO task status'),
          true,
        );
        // Never persisted a half-broken binding, and never audited a link that didn't happen.
        assertEquals(restCall(calls, 'external_project_bindings', 'POST').length, 0);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  // OD-INT-10, round 3: the real 2026-07-20 workspace probe shape — open/custom/closed, exactly ONE
  // custom status, no second one for Blocked. Round 2 rejected this List outright (a since-reverted
  // pairwise-distinctness rule too strict to ship: a FRESH ClickUp workspace has exactly this shape).
  // Blocked now resolves `pmo-only` instead — never pushed outbound, never overwritten by an inbound
  // sync — so this List LINKS successfully, exactly like `LINKABLE_LIST` above (same shape).
  it('OD-INT-10: the real 3-status List (one custom status, no Blocked counterpart) LINKS successfully, with Blocked resolving pmo-only', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () => jsonResponse(NO_MEMBERS)),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },

        {
          label: 'insert binding',
          method: 'POST',
          pathname: '/rest/v1/external_project_bindings',
          searchParams: { select: 'id' },
          response: (call) => {
            const body = call.bodyJson as {
              config: { statusMap: { pmoToClickUp: Record<string, string>; pmoOnlyStatuses?: string[] } };
            };
            assertEquals(body.config.statusMap.pmoToClickUp['To Do'], 'to do');
            assertEquals(body.config.statusMap.pmoToClickUp['In Progress'], 'in progress');
            assertEquals(body.config.statusMap.pmoToClickUp.Done, 'complete');
            assertEquals(body.config.statusMap.pmoToClickUp.Blocked, undefined);
            assertEquals(body.config.statusMap.pmoOnlyStatuses, ['Blocked']);
            return jsonResponse([{ id: 'binding-1' }], { status: 201 });
          },
        },

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_project_bindings', 'POST').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('OD-INT-10 §4: member map matches by email; an unmatched member/profile on either side is absent, never blocks the link', async () => {
    await withFetchMock(
      [
        supabaseSelect('profiles', (call) => {
          // Two distinct queries hit /rest/v1/profiles: the caller's own profile (?id=eq.<uid>) and
          // the org-wide member-map join (?org_id=eq.<org>) — disambiguate on the query param.
          if (call.url.searchParams.has('org_id')) {
            return jsonResponse([
              { id: 'user-1', email: 'matched@example.com' },
              { id: 'user-unmatched', email: 'nobody@example.com' },
            ]);
          }
          return jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          });
        }),

        supabaseSelect('platform_operators', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/list/list-1', () => jsonResponse(LINKABLE_LIST)),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),
        clickup('/api/v2/list/list-1/member', () =>
          jsonResponse({
            members: [
              { id: 111, email: 'matched@example.com' },
              { id: 222, email: 'ghost@example.com' }, // no PMO counterpart
            ],
          })),

        supabaseSelect('projects', () =>
          jsonResponse({ id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseSelect('external_project_bindings', () => new Response('null', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })),

        { label: 'pmo-task-count', method: 'HEAD', pathname: '/rest/v1/tasks', response: () => countResponse(0) },

        {
          label: 'insert binding',
          method: 'POST',
          pathname: '/rest/v1/external_project_bindings',
          searchParams: { select: 'id' },
          response: (call) => {
            const body = call.bodyJson as { config: { memberMap: { pmoToClickUp: Record<string, number>; clickUpToPmo: Record<string, string> } } };
            assertEquals(body.config.memberMap.pmoToClickUp, { 'user-1': 111 });
            assertEquals(body.config.memberMap.clickUpToPmo, { '111': 'user-1' });
            return jsonResponse([{ id: 'binding-1' }], { status: 201 });
          },
        },

        supabaseRpc('log_audit', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'clickup',
          projectId: 'proj-1',
          listId: 'list-1',
          direction: 'push-seed',
        }));
        assertEquals(res.status, 200);
        assertEquals(restCall(calls, 'external_project_bindings', 'POST').length, 1);
      },
    );
  });
});

describe('external-link — ERPNext branch', () => {
  it('Admin/Operator OK — company set', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/ACME', () => jsonResponse({ data: { name: 'ACME' } })),

        { label: 'update company config', method: 'PATCH', pathname: '/rest/v1/external_org_bindings', response: (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          const config = body.config as Record<string, unknown>;
          assertEquals(config.company, 'ACME');
          return jsonResponse([]);
        } },

        supabaseRpc('log_audit', (call) => {
          const body = call.bodyJson as Record<string, unknown>;
          assertEquals(body.p_action, 'integration.link');
          assertEquals((body.p_detail as Record<string, unknown>).tier, 'erpnext');
          assertEquals((body.p_detail as Record<string, unknown>).company_id, 'ACME');
          return jsonResponse(null);
        }),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'erpnext',
          companyId: 'ACME',
        }));
        assertEquals(res.status, 200);
        assertEquals(await res.json(), { ok: true, companyId: 'ACME' });
        assertEquals(restCall(calls, 'external_org_bindings', 'PATCH').length, 1);
        assertEquals(rpcCall(calls, 'log_audit').length, 1);
      },
    );
  });

  it('PM forbidden → 403', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'erpnext',
          companyId: 'ACME',
        }));
        assertEquals(res.status, 403);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });

  it('invalid company → 404', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active', config: {}, site_url: 'https://erp.example.com' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-key:test-secret')),

        erp('erp.example.com', '/api/resource/Company/UNKNOWN', () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 })),
      ],
      async ({ calls }) => {
        const res = await handleLinkRequest(await authed({
          tier: 'erpnext',
          companyId: 'UNKNOWN',
        }));
        assertEquals(res.status, 404);
        assertEquals(rpcCall(calls, 'log_audit').length, 0);
      },
    );
  });
});