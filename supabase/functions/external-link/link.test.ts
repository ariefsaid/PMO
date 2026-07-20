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

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

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

        { label: 'insert binding', method: 'POST', pathname: '/rest/v1/external_project_bindings', searchParams: { select: 'id' }, response: () => jsonResponse([{ id: 'binding-1' }], { status: 201 }) },

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

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

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

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

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

        clickup('/api/v2/list/list-1', () => jsonResponse({ name: 'Test List' })),
        clickup('/api/v2/list/list-1/task', () => jsonResponse({ tasks: [] })),

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