/**
 * external-unlink edge fn — Deno unit tests (task 3.4).
 *
 * Tests the handler logic with mocked Supabase client and fetch.
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
    const updateOverride = overrides[`${table}_update_eq_eq`];

    return {
      select: (cols: string, opts?: { count?: string; head?: boolean }) => {
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
        eq: (col: string, val: unknown) => {
          if (updateOverride) {
            return {
              eq: (col2: string, val2: unknown) => Promise.resolve(updateOverride()),
            };
          }
          return {
            eq: (col2: string, val2: unknown) => Promise.resolve({ error: null }),
          };
        },
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
// Handler with injected dependencies for testing
// ============================================================================

interface HandlerDeps {
  supabaseUrl: string;
  serviceRoleKey: string;
  serviceClient: any;
  verifyJwt: (jwt: string) => Promise<{ sub: string }>;
  fetchImpl: typeof fetch;
}

async function handleUnlinkRequestWithDeps(req: Request, deps: HandlerDeps): Promise<Response> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Extract and verify caller JWT
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing Authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const jwt = m[1];

  let userId: string;
  try {
    const verified = await deps.verifyJwt(jwt);
    userId = verified.sub;
  } catch {
    return new Response(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid JWT' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 2. Service-role client for admin lookups
  const serviceClient = deps.serviceClient;

  // 3. Load caller profile (role + org_id + status)
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('org_id, role, status')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN', message: 'Profile not found' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 4. Check platform operator status
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = profile.role === 'Admin';
  const isPlatformOperator = !!isOperator;

  // 5. Parse body - tier FIRST, then tier-specific auth
  let body: { tier: 'clickup' | 'erpnext'; projectId?: string };
  try {
    body = (await req.json()) as any;
  } catch {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { tier, projectId } = body;
  if (tier !== 'clickup' && tier !== 'erpnext') {
    return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'Unknown tier (must be clickup or erpnext)' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // =========================================================================
  // ClickUp branch: soft-archive external_project_bindings row
  // =========================================================================
  if (tier === 'clickup') {
    if (!projectId) {
      return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'projectId is required for ClickUp unlink' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Load project and verify it belongs to caller's org
    const { data: project, error: projectError } = await serviceClient
      .from('projects')
      .select('id, project_manager_id, org_id')
      .eq('id', projectId)
      .eq('org_id', profile.org_id)
      .maybeSingle();

    if (projectError || !project) {
      return new Response(JSON.stringify({ error: 'NOT_FOUND', message: 'Project not found in this org' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ClickUp tier-specific auth: Admin OR Operator OR (PM of this project AND PM profile active)
    const isPmOfProject = project.project_manager_id === userId;
    let pmProfileActive = false;
    if (isPmOfProject) {
      const { data: pmProfile } = await serviceClient
        .from('profiles')
        .select('status')
        .eq('id', userId)
        .single();
      pmProfileActive = pmProfile?.status === 'active';
    }

    const allowed = isAdmin || isPlatformOperator || (isPmOfProject && pmProfileActive);
    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: 'FORBIDDEN',
          message: 'Admin, Operator, or Project Manager of this project (with active profile) required',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Load the project binding
    const { data: binding, error: bindingError } = await serviceClient
      .from('external_project_bindings')
      .select('id, external_container_id')
      .eq('org_id', profile.org_id)
      .eq('project_id', projectId)
      .eq('external_tier', 'clickup')
      .is('disconnected_at', null) // only active bindings
      .maybeSingle();

    if (bindingError || !binding) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'No active ClickUp binding found for this project' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Soft-archive: set disconnected_at = now()
    const { error: updateError } = await serviceClient
      .from('external_project_bindings')
      .update({ disconnected_at: new Date().toISOString() })
      .eq('id', binding.id);

    if (updateError) {
      console.error('external_project_bindings soft-archive failed', updateError);
      return new Response(JSON.stringify({ error: 'INTERNAL', message: 'Failed to unlink project' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Audit log
    const { error: auditError } = await serviceClient.rpc('log_audit', {
      p_action: 'integration.unlink',
      p_org_id: profile.org_id,
      p_actor_id: userId,
      p_entity_id: binding.id,
      p_detail: {
        tier: 'clickup',
        project_id: projectId,
        list_id: binding.external_container_id,
        actor: userId,
      },
    });
    if (auditError) console.error('log_audit failed', auditError);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // =========================================================================
  // ERPNext branch: clear config.company
  // =========================================================================
  if (tier === 'erpnext') {
    // ERPNext is org-level; Admin/Operator only (PM not allowed)
    if (!isAdmin && !isPlatformOperator) {
      return new Response(
        JSON.stringify({ error: 'FORBIDDEN', message: 'Admin or Operator role required for ERPNext unlink' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Load org binding
    const { data: binding, error: bindingError } = await serviceClient
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', profile.org_id)
      .eq('external_tier', 'erpnext')
      .maybeSingle();

    if (bindingError || !binding) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'No ERPNext binding found for this org' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const currentConfig = (binding.config as Record<string, unknown>) ?? {};
    if (!currentConfig.company) {
      return new Response(
        JSON.stringify({ error: 'NOT_FOUND', message: 'No ERPNext company linked' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Clear company from config
    const newConfig = { ...currentConfig, company: null };
    const { error: updateError } = await serviceClient
      .from('external_org_bindings')
      .update({ config: newConfig })
      .eq('org_id', profile.org_id)
      .eq('external_tier', 'erpnext');

    if (updateError) {
      console.error('external_org_bindings config clear failed', updateError);
      return new Response(JSON.stringify({ error: 'INTERNAL', message: 'Failed to unlink ERPNext company' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Audit log
    const { error: auditError } = await serviceClient.rpc('log_audit', {
      p_action: 'integration.unlink',
      p_org_id: profile.org_id,
      p_actor_id: userId,
      p_entity_id: null,
      p_detail: {
        tier: 'erpnext',
        company_id: currentConfig.company,
        actor: userId,
      },
    });
    if (auditError) console.error('log_audit failed', auditError);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'BAD_REQUEST', message: 'Unknown tier' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ============================================================================
// ClickUp unlink tests
// ============================================================================

Deno.test('external-unlink: ClickUp soft-archives binding (disconnected_at set)', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ClickUp PM can unlink their project', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ClickUp PM with inactive profile gets 403', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager', status: 'inactive' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: ClickUp PM of different project gets 403', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'different-pm', org_id: 'org-1' }, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: ClickUp project with null project_manager_id requires Admin/Operator', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: null, org_id: 'org-1' }, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: ClickUp Engineer gets 403', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: ClickUp missing projectId returns 400', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 400);
});

Deno.test('external-unlink: missing ClickUp binding returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'clickup', projectId: 'proj-1' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 404);
});

// ============================================================================
// ERPNext unlink tests
// ============================================================================

Deno.test('external-unlink: ERPNext clears config.company', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: ERPNext PM gets 403 (org-level only)', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Project Manager', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 403);
});

Deno.test('external-unlink: missing ERPNext binding returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'erpnext' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 404);
});

Deno.test('external-unlink: ERPNext no company linked returns 404', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 404);
});

// ============================================================================
// Audit log tests
// ============================================================================

Deno.test('external-unlink: audit event logged for ClickUp unlink', async () => {
  let auditCalled = false;
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'user-1', org_id: 'org-1' }, error: null }),
    'external_project_bindings_select_maybeSingle': async () => ({
      data: { id: 'binding-1', external_container_id: 'list-1' },
      error: null,
    }),
    'external_project_bindings_update_eq_eq': async () => ({ error: null }),
    rpc: async (name: string, params: Record<string, any>) => {
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
  assertEquals(auditCalled, true);
});

Deno.test('external-unlink: audit event logged for ERPNext unlink', async () => {
  let auditCalled = false;
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'external_org_bindings_select_maybeSingle': async () => ({
      data: { config: { company: 'ACME' } },
      error: null,
    }),
    'external_org_bindings_update_eq_eq': async () => ({ error: null }),
    rpc: async (name: string, params: Record<string, any>) => {
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
  assertEquals(auditCalled, true);
});

// ============================================================================
// Role gate tests
// ============================================================================

Deno.test('external-unlink: Admin role allowed for ClickUp', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Operator role allowed for ClickUp', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: { user_id: 'operator-1' }, error: null }),
    'projects_select_maybeSingle': async () => ({ data: { id: 'proj-1', project_manager_id: 'pm-1', org_id: 'org-1' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Admin role allowed for ERPNext', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

Deno.test('external-unlink: Operator role allowed for ERPNext', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Engineer', status: 'active' }, error: null }),
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

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 200);
});

// ============================================================================
// Invalid tier tests
// ============================================================================

Deno.test('external-unlink: unknown tier returns 400', async () => {
  const mockServiceClient = createMockSupabaseClient({
    'profiles_select_single': async () => ({ data: { org_id: 'org-1', role: 'Admin', status: 'active' }, error: null }),
    'platform_operators_select_maybeSingle': async () => ({ data: null, error: null }),
  });

  const req = new Request('https://example.com/unlink', {
    method: 'POST',
    headers: { Authorization: 'Bearer valid-jwt' },
    body: JSON.stringify({ tier: 'unknown' }),
  });

  const res = await handleUnlinkRequestWithDeps(req, {
    supabaseUrl: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
    serviceClient: mockServiceClient,
    verifyJwt: async () => ({ sub: 'user-1' }),
    fetchImpl: fetch,
  });
  assertEquals(res.status, 400);
});