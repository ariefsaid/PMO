/**
 * external-lists edge fn — Deno unit tests (task 3.1).
 *
 * Tests the REAL handler (imported from ./index.ts) with mocked fetch via edgeTestKit.
 * Verifies:
 * - Admin/PM/Operator can fetch lists
 * - Non-authorized role (Engineer) gets 403
 * - Missing/inactive binding returns 404/422
 * - Vault secret resolution failure returns 422
 * - ClickUp API errors return 502
 * - Response shape is flattened list tree
 */

import { describe, it, beforeAll, afterAll } from '@std/testing/bdd';
import { assertEquals, assertRejects } from '@std/assert';
import { handleListsRequest, setTestJwks } from './index.ts';
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
  return createAuthedRequest('http://edge.test/lists', body, jwt);
}

describe('external-lists — ClickUp branch', () => {
  it('Admin OK — returns flattened lists', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-1', name: 'Acme Workspace' }] })),

        clickup('/api/v2/team/team-1/space', () => jsonResponse({
          spaces: [
            { id: 'space-1', name: 'Engineering' },
            { id: 'space-2', name: 'Marketing' },
          ],
        })),

        clickup('/api/v2/space/space-1/folder', () => jsonResponse({
          folders: [
            { id: 'folder-1', name: 'Backend', space_id: 'space-1' },
            { id: 'folder-2', name: 'Frontend', space_id: 'space-1' },
          ],
        })),

        clickup('/api/v2/space/space-2/folder', () => jsonResponse({ folders: [] })),

        clickup('/api/v2/space/space-1/list', () => jsonResponse({
          lists: [
            { id: 'list-1', name: 'Bugs', folder_id: null, space_id: 'space-1' },
            { id: 'list-2', name: 'Features', folder_id: null, space_id: 'space-1' },
          ],
        })),

        clickup('/api/v2/folder/folder-1/list', () => jsonResponse({
          lists: [
            { id: 'list-3', name: 'API Tasks', folder_id: 'folder-1', space_id: 'space-1' },
            { id: 'list-4', name: 'DB Tasks', folder_id: 'folder-1', space_id: 'space-1' },
          ],
        })),

        clickup('/api/v2/folder/folder-2/list', () => jsonResponse({
          lists: [
            { id: 'list-5', name: 'UI Tasks', folder_id: 'folder-2', space_id: 'space-1' },
          ],
        })),

        clickup('/api/v2/space/space-2/list', () => jsonResponse({
          lists: [
            { id: 'list-6', name: 'Campaigns', folder_id: null, space_id: 'space-2' },
          ],
        })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.lists.length, 6);
        const names = data.lists.map((l: { name: string }) => l.name).sort();
        assertEquals(names, ['API Tasks', 'Bugs', 'Campaigns', 'DB Tasks', 'Features', 'UI Tasks']);
        // Verify structure
        const bugs = data.lists.find((l: { name: string }) => l.name === 'Bugs');
        assertEquals(bugs?.space_name, 'Engineering');
        assertEquals(bugs?.folder_name, null);
        const apiTasks = data.lists.find((l: { name: string }) => l.name === 'API Tasks');
        assertEquals(apiTasks?.space_name, 'Engineering');
        assertEquals(apiTasks?.folder_name, 'Backend');
      },
    );
  });

  it('PM OK', async () => {
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

        supabaseSelect('external_org_bindings', () =>
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-1', name: 'Acme Workspace' }] })),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces: [] })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-1', name: 'Acme Workspace' }] })),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces: [] })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
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
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 403);
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
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 404);
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'inactive' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 422);
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse(null)),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 422);
      },
    );
  });

  it('ClickUp team fetch failure → 502', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 502);
      },
    );
  });

  it('handles empty workspace', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => jsonResponse({ teams: [] })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.lists.length, 0);
      },
    );
  });

  it('continues on folder/list fetch failure', async () => {
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
          jsonResponse({ secret_ref: 'vault-ref', status: 'active' }, {
            headers: { 'content-type': 'application/vnd.pgrst.object+json' },
          })),

        supabaseRpc('read_vault_secret', () => jsonResponse('test-pat-token')),

        clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-1', name: 'Acme Workspace' }] })),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({
          spaces: [
            { id: 'space-1', name: 'Engineering' },
            { id: 'space-2', name: 'Marketing' },
          ],
        })),
        clickup('/api/v2/space/space-1/folder', () => new Response(JSON.stringify({ error: 'server error' }), { status: 500 })),
        clickup('/api/v2/space/space-2/folder', () => jsonResponse({ folders: [] })),
        clickup('/api/v2/space/space-1/list', () => jsonResponse({
          lists: [
            { id: 'list-1', name: 'Bugs', folder_id: null, space_id: 'space-1' },
            { id: 'list-2', name: 'Features', folder_id: null, space_id: 'space-1' },
          ],
        })),
        clickup('/api/v2/space/space-2/list', () => jsonResponse({ lists: [] })),
      ],
      async ({ calls }) => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 200);
        const data = await res.json();
        // Only space-1 root lists should be returned
        assertEquals(data.lists.length, 2);
        assertEquals(data.lists.map((l: { name: string }) => l.name).sort(), ['Bugs', 'Features']);
      },
    );
  });
});