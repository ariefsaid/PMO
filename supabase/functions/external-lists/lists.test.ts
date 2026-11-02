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
  withFetchMock as baseWithFetchMock,
  supabaseRpc,
  supabaseSelect,
  restCall,
  rpcCall,
  jsonResponse,
  clickup,
  createAuthedRequest,
  createTestJwksResolver,
} from '../_shared/testing/edgeTestKit.ts';

/**
 * Every route list is wrapped: the default standing answer (active) is appended LAST, so an
 * actor_authorization_state route a test supplies itself wins (first match) — the standing-failure
 * tests below rely on that.
 */
const withFetchMock: typeof baseWithFetchMock = (routes, run) =>
  baseWithFetchMock([...routes, supabaseRpc('actor_authorization_state', () => jsonResponse({ active: true }))], run);

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
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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
          jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'active' }, {
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
          jsonResponse({ org_id: 'org-1', role: 'Engineer', status: 'active' }, {
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
          jsonResponse({ org_id: 'org-1', role: 'Engineer', status: 'active' }, {
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
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 404);
      },
    );
  });

  it('inactive binding 422', async () => {
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
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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
          jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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

  it('folder fetch failure in one space fails the whole request (no partial picker)', async () => {
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
        assertEquals(res.status, 502);
      },
    );
  });
});
describe('external-lists — hierarchy honesty', () => {
  const baseMocks = () => [
    supabaseSelect('profiles', () =>
      jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
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
    clickup('/api/v2/team', () => jsonResponse({ teams: [{ id: 'team-1', name: 'Acme' }] })),
  ];
  const fail = () => new Response('{}', { status: 500 });

  it('spaces level non-success → 502, not an empty picker', async () => {
    await withFetchMock(
      [...baseMocks(), clickup('/api/v2/team/team-1/space', fail)],
      async () => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 502);
      },
    );
  });

  it('folders level non-success → 502', async () => {
    await withFetchMock(
      [
        ...baseMocks(),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces: [{ id: 's1', name: 'S' }] })),
        clickup('/api/v2/space/s1/folder', fail),
        clickup('/api/v2/space/s1/list', () => jsonResponse({ lists: [] })),
      ],
      async () => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 502);
      },
    );
  });

  it('folder lists level non-success → 502', async () => {
    await withFetchMock(
      [
        ...baseMocks(),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces: [{ id: 's1', name: 'S' }] })),
        clickup('/api/v2/space/s1/folder', () =>
          jsonResponse({ folders: [{ id: 'f1', name: 'F', space_id: 's1' }] })),
        clickup('/api/v2/folder/f1/list', fail),
        clickup('/api/v2/space/s1/list', () => jsonResponse({ lists: [] })),
      ],
      async () => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 502);
      },
    );
  });

  it('space lists level non-success → 502', async () => {
    await withFetchMock(
      [
        ...baseMocks(),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces: [{ id: 's1', name: 'S' }] })),
        clickup('/api/v2/space/s1/folder', () => jsonResponse({ folders: [] })),
        clickup('/api/v2/space/s1/list', fail),
      ],
      async () => {
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        assertEquals(res.status, 502);
      },
    );
  });

  it('concurrent sibling traversal is bounded and returns the full tree', async () => {
    const N = 12;
    let inFlight = 0;
    let peak = 0;
    const spaces = Array.from({ length: N }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
    await withFetchMock(
      [
        ...baseMocks(),
        clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces })),
        ...spaces.flatMap((s) => [
          clickup(`/api/v2/space/${s.id}/folder`, () => jsonResponse({ folders: [] })),
          clickup(`/api/v2/space/${s.id}/list`, () => jsonResponse({
            lists: [{ id: `l-${s.id}`, name: `L-${s.id}`, folder_id: null, space_id: s.id }],
          })),
        ]),
      ],
      async () => {
        const mocked = globalThis.fetch;
        globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
          const url = String(input instanceof Request ? input.url : input);
          if (!url.includes('clickup')) return mocked(input, init);
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight--;
          return mocked(input, init);
        }) as typeof fetch;
        const res = await handleListsRequest(await authed({ tier: 'clickup' }));
        globalThis.fetch = mocked;
        assertEquals(res.status, 200);
        const data = await res.json();
        assertEquals(data.lists.length, N);
        assertEquals(data.lists.map((l: { id: string }) => l.id), spaces.map((s) => `l-${s.id}`));
        if (peak > 4 || peak < 2) throw new Error(`peak concurrency ${peak} outside 2..4`);
      },
    );
  });

  // 6 spaces x 6 folders: every level fans out, so nested per-level caps would multiply.
  const wideTree = () => {
    const spaces = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, name: `S${i}` }));
    const folderIds = (s: string) => Array.from({ length: 6 }, (_, i) => `${s}f${i}`);
    return [
      ...baseMocks(),
      clickup('/api/v2/team/team-1/space', () => jsonResponse({ spaces })),
      ...spaces.flatMap((s) => [
        clickup(`/api/v2/space/${s.id}/folder`, () =>
          jsonResponse({ folders: folderIds(s.id).map((id) => ({ id, name: id })) })),
        clickup(`/api/v2/space/${s.id}/list`, () => jsonResponse({ lists: [] })),
        ...folderIds(s.id).map((id) =>
          clickup(`/api/v2/folder/${id}/list`, () => jsonResponse({ lists: [] }))),
      ]),
    ];
  };

  /** Wrap the mocked fetch: `onStart` runs as each ClickUp call begins; returning 'fail' makes it 429. */
  async function runInstrumented(
    mocks: ReturnType<typeof wideTree>,
    onStart: (url: string) => 'fail' | void,
    onEnd: () => void,
  ): Promise<Response> {
    let res!: Response;
    await withFetchMock(mocks, async () => {
      const mocked = globalThis.fetch;
      globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input);
        if (!url.includes('clickup')) return mocked(input, init);
        const verdict = onStart(url);
        await new Promise((r) => setTimeout(r, 5));
        onEnd();
        return verdict === 'fail' ? new Response('{}', { status: 429 }) : mocked(input, init);
      }) as typeof fetch;
      try {
        res = await handleListsRequest(await authed({ tier: 'clickup' }));
      } finally {
        globalThis.fetch = mocked;
      }
    });
    return res;
  }

  it('total in-flight ClickUp calls across the whole nested tree stay within the cap', async () => {
    let inFlight = 0;
    let peak = 0;
    const res = await runInstrumented(wideTree(), () => {
      peak = Math.max(peak, ++inFlight);
    }, () => { inFlight--; });
    assertEquals(res.status, 200);
    if (peak > 4 || peak < 2) throw new Error(`peak concurrency ${peak} outside 2..4`);
  });

  it('after the first ClickUp failure no further ClickUp calls start', async () => {
    let started = 0;
    let startedAtFailureEnd = -1;
    let failed = false;
    const res = await runInstrumented(wideTree(), (url) => {
      started++;
      if (!failed && url.endsWith('/folder')) {
        failed = true;
        return 'fail';
      }
    }, () => {
      if (failed && startedAtFailureEnd < 0) startedAtFailureEnd = started;
    });
    assertEquals(res.status, 502);
    // Calls already in flight (<= cap) may land; nothing new may begin once any call has failed.
    if (started > startedAtFailureEnd) {
      throw new Error(`${started - startedAtFailureEnd} calls started after the failure`);
    }
  });
});

// ============================================================================
// Current standing: the Admin/PM/Operator gate answers only while the membership is active NOW —
// the PM allowance included. A deactivated or banned caller carrying an unexpired JWT must get
// 403 BEFORE any Vault read or ClickUp request, and an unresolvable standing answer fails closed.
// ============================================================================
describe('external-lists — current standing', () => {
  it('a deactivated Admin is refused → 403, no Vault read, no ClickUp request', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'disabled' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: false })),
      supabaseSelect('platform_operators', () => new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
      assertEquals(calls.filter((c) => c.url.host === 'api.clickup.com').length, 0);
    });
  });

  it('a deactivated Project Manager is refused → 403 (standing covers the PM allowance too)', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Project Manager', status: 'disabled' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Project Manager', active: false })),
      supabaseSelect('platform_operators', () => new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
      assertEquals(calls.filter((c) => c.url.host === 'api.clickup.com').length, 0);
    });
  });

  it('a currently-inactive operator is refused → 403 before the operator branch is consulted', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Engineer', status: 'disabled' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Engineer', active: false })),
      supabaseSelect('platform_operators', () =>
        jsonResponse({ user_id: 'user-1' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
      assertEquals(calls.filter((c) => c.url.host === 'api.clickup.com').length, 0);
    });
  });

  it('an Admin whose profile is active but whose RPC standing is inactive (banned) is refused → 403, no Vault read', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: false })),
      supabaseSelect('platform_operators', () => new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
      assertEquals(calls.filter((c) => c.url.host === 'api.clickup.com').length, 0);
    });
  });

  it('a disabled profile is refused even when the RPC reports active → 403, no Vault read', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'disabled' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => jsonResponse({ role: 'Admin', active: true })),
      supabaseSelect('platform_operators', () => new Response('null', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
      assertEquals(calls.filter((c) => c.url.host === 'api.clickup.com').length, 0);
    });
  });

  it('fails closed when standing cannot be resolved → 403, no Vault read', async () => {
    await withFetchMock([
      supabaseSelect('profiles', () =>
        jsonResponse({ org_id: 'org-1', role: 'Admin', status: 'active' }, {
          headers: { 'content-type': 'application/vnd.pgrst.object+json' },
        })),
      supabaseRpc('actor_authorization_state', () => new Response('{"message":"unavailable"}', { status: 500, headers: { 'content-type': 'application/json' } })),
    ], async ({ calls }) => {
      const res = await handleListsRequest(await authed({ tier: 'clickup' }));
      assertEquals(res.status, 403);
      assertEquals(rpcCall(calls, 'read_vault_secret').length, 0);
    });
  });
});
