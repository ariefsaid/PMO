/**
 * external-lists — Deno Edge Function entry point (Phase 3, task 3.1).
 *
 * ClickUp List picker: fetches the org's ClickUp Spaces/Folders/Lists hierarchy
 * using the org's per-org Vault token (resolved from external_org_bindings.secret_ref).
 *
 * Auth: runs under the CALLER JWT (verified locally via verifyCallerJwt, ADR-0057),
 * then re-enforces Admin/Operator/PM gate on the verified `sub`.
 * - Admin of the org: allowed
 * - Platform Operator: allowed
 * - Project Manager of the org: allowed (per ADR-0016 project matrix — server re-enforces)
 *
 * Request: POST { tier: 'clickup' }
 * Response: { lists: [{ id, name, space_name, folder_name }] }
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: not Admin/Operator/PM of the org
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

function bearerTokenFromHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1] : null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
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
  const res = await deps.fetchImpl(`${baseUrl}/team`, {
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
  const res = await deps.fetchImpl(`${baseUrl}/team/${teamId}/space`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { spaces: ClickUpSpace[] };
  return data.spaces;
}

async function fetchFolders(deps: ClickUpHierarchyDeps, spaceId: string): Promise<ClickUpFolder[]> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await deps.fetchImpl(`${baseUrl}/space/${spaceId}/folder`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) return [];
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
  const res = await deps.fetchImpl(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { lists: ClickUpList[] };
  return data.lists;
}

/** Build flattened list hierarchy from ClickUp workspace. */
async function buildFlattenedLists(deps: ClickUpHierarchyDeps): Promise<ListItem[]> {
  const teams = await fetchTeams(deps);
  const allLists: ListItem[] = [];

  for (const team of teams) {
    const spaces = await fetchSpaces(deps, team.id);
    for (const space of spaces) {
      const folders = await fetchFolders(deps, space.id);
      // Lists in folders
      for (const folder of folders) {
        const lists = await fetchLists(deps, space.id, folder.id);
        for (const list of lists) {
          allLists.push({
            id: list.id,
            name: list.name,
            space_name: space.name,
            folder_name: folder.name,
          });
        }
      }
      // Lists directly in space (no folder)
      const spaceLists = await fetchLists(deps, space.id, null);
      for (const list of spaceLists) {
        allLists.push({
          id: list.id,
          name: list.name,
          space_name: space.name,
          folder_name: null,
        });
      }
    }
  }

  return allLists;
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleListsRequest(req: Request): Promise<Response> {
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
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
      issuer: `${supabaseUrl}/auth/v1`,
      audience: 'authenticated',
      algorithms: ['ES256'],
    });
    userId = verified.sub;
  } catch (err) {
    const status = err instanceof JwtVerifyError ? err.status : 401;
    return errorResponse('Invalid JWT', 'UNAUTHORIZED', status);
  }

  // 2. Service-role client for admin lookups
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // 3. Load caller profile (role + org_id)
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return errorResponse('Profile not found', 'FORBIDDEN', 403);
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
  Deno.serve(handleListsRequest);
}

// Export for unit testing (Deno test imports this module)
export { buildFlattenedLists, fetchTeams, fetchSpaces, fetchFolders, fetchLists };
export type { ClickUpHierarchyDeps, ListItem };