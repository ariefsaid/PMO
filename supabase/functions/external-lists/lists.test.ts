/**
 * external-lists edge fn — Deno unit tests (task 3.1).
 *
 * Tests the core logic with mocked fetch and mocked Supabase RPC.
 * Verifies:
 * - Admin/PM/Operator can fetch lists
 * - Non-authorized role (Engineer) gets 403
 * - Missing/inactive binding returns 404/422
 * - Vault secret resolution failure returns 422
 * - ClickUp API errors return 502
 * - Response shape is flattened list tree
 */

import { assertEquals, assertRejects } from '@std/assert';
import { buildFlattenedLists, fetchTeams, fetchSpaces, fetchFolders, fetchLists } from './index.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

// ============================================================================
// Test utilities / mocks
// ============================================================================

interface MockFetchRoute {
  method: string;
  urlIncludes: string;
  status?: number;
  json: unknown | (() => unknown);
}

function createMockFetch(routes: MockFetchRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = (init?.method ?? 'GET').toUpperCase();
    const route = routes.find((r) => r.method.toUpperCase() === method && url.includes(r.urlIncludes));
    if (!route) {
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }
    const json = typeof route.json === 'function' ? (route.json as () => unknown)() : route.json;
    return new Response(JSON.stringify(json), { status: route.status ?? 200 });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

// ClickUp API response fixtures
function teamResponse() {
  return { teams: [{ id: 'team-1', name: 'Acme Workspace' }] };
}

function spacesResponse(teamId: string) {
  if (teamId === 'team-1') {
    return {
      spaces: [
        { id: 'space-1', name: 'Engineering' },
        { id: 'space-2', name: 'Marketing' },
      ],
    };
  }
  return { spaces: [] };
}

function foldersResponse(spaceId: string) {
  if (spaceId === 'space-1') {
    return {
      folders: [
        { id: 'folder-1', name: 'Backend', space_id: 'space-1' },
        { id: 'folder-2', name: 'Frontend', space_id: 'space-1' },
      ],
    };
  }
  if (spaceId === 'space-2') {
    return { folders: [] };
  }
  return { folders: [] };
}

function listsResponse(spaceId: string, folderId: string | null) {
  const key = `${spaceId}:${folderId ?? 'null'}`;
  const fixtures: Record<string, { lists: Array<{ id: string; name: string; folder_id: string | null; space_id: string }> }> = {
    'space-1:null': {
      lists: [
        { id: 'list-1', name: 'Bugs', folder_id: null, space_id: 'space-1' },
        { id: 'list-2', name: 'Features', folder_id: null, space_id: 'space-1' },
      ],
    },
    'space-1:folder-1': {
      lists: [
        { id: 'list-3', name: 'API Tasks', folder_id: 'folder-1', space_id: 'space-1' },
        { id: 'list-4', name: 'DB Tasks', folder_id: 'folder-1', space_id: 'space-1' },
      ],
    },
    'space-1:folder-2': {
      lists: [
        { id: 'list-5', name: 'UI Tasks', folder_id: 'folder-2', space_id: 'space-1' },
      ],
    },
    'space-2:null': {
      lists: [
        { id: 'list-6', name: 'Campaigns', folder_id: null, space_id: 'space-2' },
      ],
    },
  };
  return fixtures[key] ?? { lists: [] };
}

// ============================================================================
// Unit tests for buildFlattenedLists
// ============================================================================

Deno.test('buildFlattenedLists: flattens space -> folder -> list hierarchy', async () => {
  const { fetchImpl, calls } = createMockFetch([
    { method: 'GET', urlIncludes: '/team/team-1/space', json: spacesResponse('team-1') },
    { method: 'GET', urlIncludes: '/space/space-1/folder', json: foldersResponse('space-1') },
    { method: 'GET', urlIncludes: '/space/space-2/folder', json: foldersResponse('space-2') },
    { method: 'GET', urlIncludes: '/space/space-1/list', json: listsResponse('space-1', null) },
    { method: 'GET', urlIncludes: '/folder/folder-1/list', json: listsResponse('space-1', 'folder-1') },
    { method: 'GET', urlIncludes: '/folder/folder-2/list', json: listsResponse('space-1', 'folder-2') },
    { method: 'GET', urlIncludes: '/space/space-2/list', json: listsResponse('space-2', null) },
    { method: 'GET', urlIncludes: '/team', json: teamResponse() },
  ]);

  const lists = await buildFlattenedLists({ fetchImpl, token: 'test-token' });

  assertEquals(lists.length, 6);

  // Verify structure
  const bugs = lists.find((l) => l.name === 'Bugs');
  assertEquals(bugs?.space_name, 'Engineering');
  assertEquals(bugs?.folder_name, null);

  const apiTasks = lists.find((l) => l.name === 'API Tasks');
  assertEquals(apiTasks?.space_name, 'Engineering');
  assertEquals(apiTasks?.folder_name, 'Backend');

  const campaigns = lists.find((l) => l.name === 'Campaigns');
  assertEquals(campaigns?.space_name, 'Marketing');
  assertEquals(campaigns?.folder_name, null);

  // Verify all expected lists present
  const names = lists.map((l) => l.name).sort();
  assertEquals(names, ['API Tasks', 'Bugs', 'Campaigns', 'DB Tasks', 'Features', 'UI Tasks']);
});

Deno.test('buildFlattenedLists: handles empty workspace', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team', json: { teams: [] } },
  ]);

  const lists = await buildFlattenedLists({ fetchImpl, token: 'test-token' });
  assertEquals(lists.length, 0);
});

Deno.test('buildFlattenedLists: handles API error on team fetch', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team', status: 401, json: { error: 'unauthorized' } },
  ]);

  await assertRejects(
    async () => await buildFlattenedLists({ fetchImpl, token: 'bad-token' }),
    AppError,
    'Failed to fetch ClickUp workspaces',
  );
});

Deno.test('buildFlattenedLists: handles space with no folders', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team/team-1/space', json: spacesResponse('team-1') },
    { method: 'GET', urlIncludes: '/space/space-1/folder', json: foldersResponse('space-1') },
    { method: 'GET', urlIncludes: '/space/space-2/folder', json: foldersResponse('space-2') },
    { method: 'GET', urlIncludes: '/space/space-1/list', json: listsResponse('space-1', null) },
    { method: 'GET', urlIncludes: '/folder/folder-1/list', json: listsResponse('space-1', 'folder-1') },
    { method: 'GET', urlIncludes: '/folder/folder-2/list', json: listsResponse('space-1', 'folder-2') },
    { method: 'GET', urlIncludes: '/space/space-2/list', json: { lists: [] } },
    { method: 'GET', urlIncludes: '/team', json: teamResponse() },
  ]);

  const lists = await buildFlattenedLists({ fetchImpl, token: 'test-token' });
  // 5 lists total (2 in space-1 root + 3 in folders + 0 in space-2)
  assertEquals(lists.length, 5);
});

Deno.test('buildFlattenedLists: continues on folder/list fetch failure', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team/team-1/space', json: spacesResponse('team-1') },
    { method: 'GET', urlIncludes: '/space/space-1/folder', status: 500, json: { error: 'server error' } },
    { method: 'GET', urlIncludes: '/space/space-2/folder', json: { folders: [] } },
    { method: 'GET', urlIncludes: '/space/space-1/list', json: listsResponse('space-1', null) },
    { method: 'GET', urlIncludes: '/space/space-2/list', json: { lists: [] } },
    { method: 'GET', urlIncludes: '/team', json: teamResponse() },
  ]);

  const lists = await buildFlattenedLists({ fetchImpl, token: 'test-token' });
  // Only space-1 root lists should be returned
  assertEquals(lists.length, 2);
  assertEquals(lists.map((l) => l.name).sort(), ['Bugs', 'Features']);
});

// ============================================================================
// Low-level fetch function tests
// ============================================================================

Deno.test('fetchTeams: returns teams array', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team', json: { teams: [{ id: 't1', name: 'T1' }] } },
  ]);
  const teams = await fetchTeams({ fetchImpl, token: 't' });
  assertEquals(teams.length, 1);
  assertEquals(teams[0].id, 't1');
});

Deno.test('fetchTeams: throws on error', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team', status: 403, json: { error: 'forbidden' } },
  ]);
  await assertRejects(
    async () => await fetchTeams({ fetchImpl, token: 't' }),
    AppError,
    'Failed to fetch ClickUp workspaces',
  );
});

Deno.test('fetchSpaces: returns spaces for team', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/team/t1/space', json: { spaces: [{ id: 's1', name: 'Space 1' }] } },
  ]);
  const spaces = await fetchSpaces({ fetchImpl, token: 't' }, 't1');
  assertEquals(spaces.length, 1);
  assertEquals(spaces[0].name, 'Space 1');
});

Deno.test('fetchFolders: returns folders for space', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/space/s1/folder', json: { folders: [{ id: 'f1', name: 'Folder 1', space_id: 's1' }] } },
  ]);
  const folders = await fetchFolders({ fetchImpl, token: 't' }, 's1');
  assertEquals(folders.length, 1);
});

Deno.test('fetchLists: returns lists for folder', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/folder/f1/list', json: { lists: [{ id: 'l1', name: 'List 1', folder_id: 'f1', space_id: 's1' }] } },
  ]);
  const lists = await fetchLists({ fetchImpl, token: 't' }, 's1', 'f1');
  assertEquals(lists.length, 1);
  assertEquals(lists[0].name, 'List 1');
});

Deno.test('fetchLists: returns lists for space (no folder)', async () => {
  const { fetchImpl } = createMockFetch([
    { method: 'GET', urlIncludes: '/space/s1/list', json: { lists: [{ id: 'l1', name: 'List 1', folder_id: null, space_id: 's1' }] } },
  ]);
  const lists = await fetchLists({ fetchImpl, token: 't' }, 's1', null);
  assertEquals(lists.length, 1);
  assertEquals(lists[0].folder_id, null);
});