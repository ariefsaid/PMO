/**
 * external-lists — Deno Edge Function entry point (Phase 3, task 3.1).
 *
 * ClickUp List picker: fetches the org's ClickUp Spaces/Folders/Lists hierarchy
 * using the org's per-org Vault token (resolved from external_org_bindings.secret_ref).
 *
 * Auth: runs under the CALLER JWT (verified locally via verifyCallerJwt, ADR-0057),
 * then requires active membership standing (actor_authorization_state, fail closed) and
 * re-enforces the Admin/Operator/PM gate on the verified `sub`.
 * - Admin of the org: allowed
 * - Platform Operator: allowed
 * - Project Manager of the org: allowed (per ADR-0016 project matrix — server re-enforces)
 * All of the above only while the caller's membership is currently active.
 *
 * Request: POST { tier: 'clickup' }
 * Response: { lists: [{ id, name, space_name, folder_name }] }
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: caller lacks active membership standing, or is not Admin/Operator/PM of the org
 * - 404: no active ClickUp binding for this org
 * - 422: credential resolution failed (Vault secret missing)
 * - 500: internal/upstream error
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  verifyCallerJwt,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { hasActiveStanding, type AuthorizationStateClient } from '../_shared/adminOrOperator.ts';
import { fetchBounded } from '../_shared/fetchWithDeadline.ts';

interface ListsBody {
  tier: 'clickup';
}

interface ListItem {
  id: string;
  name: string;
  space_name: string;
  folder_name: string | null;
}

interface ListsResponse {
  lists: ListItem[];
}

// Memoized JWKS resolver (same pattern as agent-chat, adapter-dispatch, external-connect)
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

// Test hook: allow injecting a local JWKS resolver to avoid background intervals.
export function setTestJwks(resolver: JwksResolver): void {
  _jwks = resolver;
}

// Test hook: Supabase client options for tests (disable auto-refresh to prevent timer leaks).
export const testSupabaseOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
};

function bearerTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1] : null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', ...headers }, // #641: every answer is CORS-readable
  });
}

function errorResponse(message: string, code: string, status: number): Response {
  return json({ error: code, message }, status);
}

// ============================================================================
// ClickUp hierarchy fetching (injected fetch for testability)
// ============================================================================

interface ClickUpTeam {
  id: string;
  name: string;
}

interface ClickUpSpace {
  id: string;
  name: string;
}

interface ClickUpFolder {
  id: string;
  name: string;
  space_id: string;
}

interface ClickUpList {
  id: string;
  name: string;
  folder_id: string | null;
  space_id: string;
}

interface ClickUpHierarchyDeps {
  fetchImpl: typeof fetch;
  token: string;
  baseUrl?: string;
}

async function fetchTeams(deps: ClickUpHierarchyDeps): Promise<ClickUpTeam[]> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await fetchBounded(deps.fetchImpl, `${baseUrl}/team`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    throw new AppError('Failed to fetch ClickUp workspaces', 'external-unreachable');
  }
  const data = (await res.json()) as { teams: ClickUpTeam[] };
  return data.teams;
}

async function fetchSpaces(deps: ClickUpHierarchyDeps, teamId: string): Promise<ClickUpSpace[]> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await fetchBounded(deps.fetchImpl, `${baseUrl}/team/${teamId}/space`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) throw new AppError('Failed to fetch ClickUp spaces', 'external-unreachable');
  const data = (await res.json()) as { spaces: ClickUpSpace[] };
  return data.spaces;
}

async function fetchFolders(deps: ClickUpHierarchyDeps, spaceId: string): Promise<ClickUpFolder[]> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await fetchBounded(deps.fetchImpl, `${baseUrl}/space/${spaceId}/folder`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) throw new AppError('Failed to fetch ClickUp folders', 'external-unreachable');
  const data = (await res.json()) as { folders: ClickUpFolder[] };
  return data.folders;
}

async function fetchLists(
  deps: ClickUpHierarchyDeps,
  spaceId: string,
  folderId: string | null,
): Promise<ClickUpList[]> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const path = folderId ? `/folder/${folderId}/list` : `/space/${spaceId}/list`;
  const res = await fetchBounded(deps.fetchImpl, `${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) throw new AppError('Failed to fetch ClickUp lists', 'external-unreachable');
  const data = (await res.json()) as { lists: ClickUpList[] };
  return data.lists;
}

/** Small fixed cap on parallel ClickUp reads across the WHOLE traversal (rate-limit friendly). */
const HIERARCHY_CONCURRENCY = 4;

/**
 * One request-wide gate: at most `limit` calls in flight across every level of the tree.
 * Once any call fails, queued and new calls reject without touching the network
 * (calls already in flight still settle).
 */
function createGate(limit: number) {
  let active = 0;
  let failure: unknown;
  let failed = false;
  const waiting: Array<() => void> = [];
  return async <R>(fn: () => Promise<R>): Promise<R> => {
    while (active >= limit && !failed) await new Promise<void>((r) => waiting.push(r));
    if (failed) throw failure;
    active++;
    try {
      return await fn();
    } catch (e) {
      if (!failed) { failed = true; failure = e; }
      throw e;
    } finally {
      active--;
      // Wake everyone on failure so they reject; otherwise hand the slot to one waiter.
      if (failed) waiting.splice(0).forEach((r) => r());
      else waiting.shift()?.();
    }
  };
}

/** Build flattened list hierarchy from ClickUp workspace. */
async function buildFlattenedLists(deps: ClickUpHierarchyDeps): Promise<ListItem[]> {
  const gate = createGate(HIERARCHY_CONCURRENCY);
  const teams = await gate(() => fetchTeams(deps));
  const perTeam = await Promise.all(teams.map(async (team) => {
    const spaces = await gate(() => fetchSpaces(deps, team.id));
    const perSpace = await Promise.all(spaces.map(async (space) => {
      const items: ListItem[] = [];
      const folders = await gate(() => fetchFolders(deps, space.id));
      // Lists in folders
      const perFolder = await Promise.all(folders.map(async (folder) =>
        (await gate(() => fetchLists(deps, space.id, folder.id))).map((list) => ({
          id: list.id,
          name: list.name,
          space_name: space.name,
          folder_name: folder.name as string | null,
        }))));
      for (const group of perFolder) items.push(...group);
      // Lists directly in space (no folder)
      for (const list of await gate(() => fetchLists(deps, space.id, null))) {
        items.push({ id: list.id, name: list.name, space_name: space.name, folder_name: null });
      }
      return items;
    }));
    return perSpace.flat();
  }));
  return perTeam.flat();
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleListsRequest(req: Request): Promise<Response> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 1. Extract and verify caller JWT (ADR-0057)
  const jwt = bearerTokenFromHeader(req.headers.get('Authorization'));
  if (!jwt) {
    return errorResponse('Missing Authorization header', 'UNAUTHORIZED', 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse('Server misconfigured', 'MISCONFIGURED', 500);
  }

  let userId: string;
  try {
    const verified = await verifyCallerJwt(jwt, getJwks(supabaseUrl), {
      issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return errorResponse('Invalid JWT', 'UNAUTHORIZED', status);
  }

  // 2. Service-role client for admin lookups
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, testSupabaseOptions);

  // 3. Load caller profile (role + org_id + status)
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('org_id, role, status')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return errorResponse('Profile not found', 'FORBIDDEN', 403);
  }

  // 3b. Standing gate: the role gate below authorizes only while the membership is active NOW —
  // the PM allowance included. A deactivated or banned caller with an unexpired JWT stops here,
  // before any Vault read or ClickUp request.
  if (!(await hasActiveStanding({
    stateClient: serviceClient as unknown as AuthorizationStateClient,
    orgId: profile.org_id,
    userId,
    profileStatus: profile.status,
  }))) {
    return errorResponse('Active organization member required', 'FORBIDDEN', 403);
  }

  // 4. Role gate: Admin OR Operator OR Project Manager
  //    PM allowed per ADR-0016 (project delivery write roles) — server re-enforces
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = profile.role === 'Admin';
  const isPM = profile.role === 'Project Manager';
  const isPlatformOperator = !!isOperator;

  if (!isAdmin && !isPM && !isPlatformOperator) {
    return errorResponse('Admin, Operator, or Project Manager role required', 'FORBIDDEN', 403);
  }

  // 5. Parse body
  let body: ListsBody;
  try {
    body = (await req.json()) as ListsBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  if (body.tier !== 'clickup') {
    return errorResponse('Only clickup tier is supported for list picker', 'BAD_REQUEST', 400);
  }

  // 6. Load ClickUp binding for this org
  const { data: binding, error: bindingError } = await serviceClient
    .from('external_org_bindings')
    .select('secret_ref, status')
    .eq('org_id', profile.org_id)
    .eq('external_tier', 'clickup')
    .single();

  if (bindingError || !binding) {
    return errorResponse('No ClickUp binding found for this org', 'NOT_FOUND', 404);
  }

  if (binding.status !== 'active') {
    return errorResponse('ClickUp binding is not active', 'CONFIG_REJECTED', 422);
  }

  // 7. Resolve token from Vault
  const { data: vaultSecret, error: vaultError } = await serviceClient.rpc('read_vault_secret', {
    p_secret_ref: binding.secret_ref,
  });

  if (vaultError || !vaultSecret) {
    return errorResponse('ClickUp credentials not found in Vault', 'CONFIG_REJECTED', 422);
  }

  // 8. Fetch and flatten ClickUp hierarchy
  try {
    const lists = await buildFlattenedLists({
      fetchImpl: fetch,
      token: vaultSecret as string,
    });
    return json({ lists });
  } catch (err) {
    const appError = err instanceof AppError ? err : new AppError('Failed to fetch ClickUp lists', 'external-unreachable');
    const status = appError.code === 'external-unreachable' ? 502 : 500;
    return errorResponse(appError.message, appError.code ?? 'external-unreachable', status);
  }
}

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  serveWithErrorReporting('external-lists', handleListsRequest);
}

// Export for unit testing (Deno test imports this module)
export { buildFlattenedLists, fetchTeams, fetchSpaces, fetchFolders, fetchLists };
export type { ClickUpHierarchyDeps, ListItem };