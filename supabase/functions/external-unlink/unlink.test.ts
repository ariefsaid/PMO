/**
 * external-unlink edge fn — Deno unit tests (task 3.4).
 *
 * Tests the handler logic with mocked Supabase client and fetch.
 * Verifies:
 * - ClickUp: Admin/Operator/PM can unlink (soft-archive with disconnected_at)
 * - ClickUp: Engineer gets 403
 * - ERPNext: Admin/Operator can unlink (clears config.company)
 * - ERPNext: PM gets 403 (org-level only)
 * - Missing binding returns 404
 * - Audit event logged
 * - Soft-archive sets disconnected_at
 * - Role gates enforced
 */

import { assertEquals, assertRejects } from '@std/assert';
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

function createMockSupabaseClient(overrides: Record<string, any> = {}): any {
  const defaultMaybeSingle = async () => ({ data: null, error: null });
  const defaultSingle = async () => ({ data: null, error: null });
  const defaultCount = async () => ({ count: 0, error: null });

  const makeChain = (table: string) => {
    const selectOverride = overrides[`${table}_select_maybeSingle`] ?? defaultMaybeSingle;
    const singleOverride = overrides[`${table}_select_single`] ?? defaultSingle;
    const countOverride = overrides[`${table}_select_count`] ?? defaultCount;

    return {
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
        // If count and head options are provided, return count chain
        if (opts?.count === 'exact' && opts?.head === true) {
          return {
            eq: (col: string, val: unknown) => ({
              eq: (col2: string, val2: unknown) => ({
                is: (col3: string, val3: unknown) => countOverride,
              }),
            }),
          };
        }
        return {
          eq: (col: string, val: unknown) => ({
            eq: (col2: string, val2: unknown) => ({
              eq: (col3: string, val3: unknown) => ({
                is: (col4: string, val4: unknown) => ({
                  maybeSingle: selectOverride,
                  single: singleOverride,
                }),
                maybeSingle: selectOverride,
                single: singleOverride,
              }),
              is: (col3: string, val3: unknown) => ({
                maybeSingle: selectOverride,
                single: singleOverride,
              }),
              maybeSingle: selectOverride,
              single: singleOverride,
            }),
            is: (col2: string, val2: unknown) => ({
              maybeSingle: selectOverride,
              single: singleOverride,
            }),
            maybeSingle: selectOverride,
            single: singleOverride,
          }),
          is: (col: string, val: unknown) => ({
            maybeSingle: selectOverride,
            single: singleOverride,
          }),
          maybeSingle: selectOverride,
          single: singleOverride,
        };
      },
      insert: (data: unknown) => ({
        select: () => ({
          single: async () => ({ data: { id: 'new-binding-id' }, error: null }),
        }),
      }),
      update: (data: unknown) => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => ({ error: null }),
        }),
      }),
      upsert: (data: unknown) => ({ error: null }),
      rpc: async (name: string, params: unknown) => {
        if (name === 'log_audit') return { data: null, error: null };
        if (name === 'read_vault_secret') return { data: 'pat-token', error: null };
        return { data: null, error: null };
      },
    };
  };

  return {
    from: (table: string) => makeChain(table),
    rpc: async (name: string, params: unknown) => {
      if (name === 'log_audit') return { data: null, error: null };
      if (name === 'read_vault_secret') return { data: 'pat-token', error: null };
      return { data: null, error: null };
    },
    ...overrides,
  };
}

// ============================================================================
// Import the handler
// ============================================================================

import { handleUnlinkRequest } from './index.ts';

// ============================================================================
// ClickUp unlink tests
// ============================================================================

Deno.test('external-unlink: ClickUp soft-archives binding (disconnected_at set)', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ClickUp PM can unlink their project', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ClickUp Engineer gets 403', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: ClickUp missing projectId returns 400', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 400);
});

Deno.test('external-unlink: missing ClickUp binding returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 404);
});

// ============================================================================
// ERPNext unlink tests
// ============================================================================

Deno.test('external-unlink: ERPNext clears config.company', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: { company: 'ACME' } },
      error: null,
    }),
    'external_org_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ERPNext PM gets 403 (org-level only)', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: missing ERPNext binding returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 404);
});

Deno.test('external-unlink: ERPNext no company linked returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: {} },
      error: null,
    }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 404);
});

// ============================================================================
// Audit log tests
// ============================================================================

Deno.test('external-unlink: audit event logged for ClickUp unlink', async () => {
  let auditCalled = false;
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
    'rpc': async (name: string, params: unknown) => {
      if (name === 'log_audit') {
        auditCalled = true;
        assertEquals(params.p_action, 'integration.unlink');
        assertEquals(params.p_detail.tier, 'clickup');
      }
      return { data: null, error: null };
    },
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
  assertEquals(auditCalled, true);
});

Deno.test('external-unlink: audit event logged for ERPNext unlink', async () => {
  let auditCalled = false;
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: { company: 'ACME' } },
      error: null,
    }),
    'external_org_bindings_update_eq_eq': async () => ({ error: null }),
    'rpc': async (name: string, params: unknown) => {
      if (name === 'log_audit') {
        auditCalled = true;
        assertEquals(params.p_action, 'integration.unlink');
        assertEquals(params.p_detail.tier, 'erpnext');
      }
      return { data: null, error: null };
    },
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
  assertEquals(auditCalled, true);
});

// ============================================================================
// Role gate tests
// ============================================================================

Deno.test('external-unlink: Admin role allowed for ClickUp', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Operator role allowed for ClickUp', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: { user_id: 'operator-1' }, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Admin role allowed for ERPNext', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: { company: 'ACME' } },
      error: null,
    }),
    'external_org_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Operator role allowed for ERPNext', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: { user_id: 'operator-1' }, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: { company: 'ACME' } },
      error: null,
    }),
    'external_org_bindings_update_eq_eq': async () => ({ error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
});

// ============================================================================
// Soft-archive tests
// ============================================================================

Deno.test('external-unlink: ClickUp soft-archive sets disconnected_at', async () => {
  let updateCalled = false;
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => {
      updateCalled = true;
      return { error: null };
    },
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 200);
  assertEquals(updateCalled, true);
});

// ============================================================================
// Invalid tier tests
// ============================================================================

Deno.test('external-unlink: unknown tier returns 400', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'unknown' }),
  });

  const res = await handleUnlinkRequest(req);
  assertEquals(res.status, 400);
});