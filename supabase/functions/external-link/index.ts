/**
 * external-link — Deno Edge Function entry point (Phase 3, tasks 3.2, 3.3).
 *
 * Project-level link to external system:
 * - ClickUp: links a PMO project to a ClickUp List with direction (push-seed | pull-adopt)
 * - ERPNext: refused here; the Company is chosen only through external-set-company's validated activation
 *
 * Auth: runs under CALLER JWT (verifyCallerJwt, ADR-0057), re-enforces tier-specific role gate on verified `sub`.
 * - ClickUp: Admin OR Operator OR (Project Manager of the project AND PM profile active)
 *
 * ClickUp direction rules (OD-CUA-3, mirrored from clickup-onboard):
 * - push-seed: List must be empty (ClickUp task count = 0)
 * - pull-adopt: PMO project must have no tasks
 * - MIXED (both non-empty) → 409 'action-required'
 *
 * ClickUp status/member maps (OD-INT-10): built through the SAME shared builders as clickup-onboard
 * (`statusMapBuilder.ts`/`memberMap.ts`) — the two link paths must never drift apart again. A List
 * whose statuses cannot cover all four PMO task_status values is rejected with 422 CONFIG_REJECTED
 * before anything is persisted; the member map is a best-effort email join and never blocks the link.
 *
 * On success (ClickUp): inserts external_project_bindings row with
 *   org_id, project_id, external_tier='clickup', external_container_id=listId,
 *   config={direction, statusMap, memberMap}, linked_by=sub, linked_at=now()
 *   Emits audit event 'integration.link'
 *
 * On success (ERPNext): updates external_org_bindings.config.company = companyId
 *   Emits audit event 'integration.link'
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: role gate failed
 * - 404: project not found / binding not found / List not found
 * - 409: mixed content (ClickUp direction rejection)
 * - 422: validation failed (incl. an incomplete ClickUp status map, OD-INT-10)
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
import {
  buildClickUpStatusMap,
  statusMapCoversAllPmoStatuses,
  type ClickUpListStatus,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/statusMapBuilder.ts';
import {
  buildClickUpMemberMap,
  type ClickUpMemberMap,
} from '../../../pmo-portal/src/lib/adapterSeam/clickup/memberMap.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { fetchBounded, FetchDeadlineError } from '../_shared/fetchWithDeadline.ts';

interface LinkBody {
  tier: string;
  // ClickUp fields
  projectId?: string;
  listId?: string;
  direction?: 'push-seed' | 'pull-adopt';
}

// Memoized JWKS resolver
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }, // #641: every answer is CORS-readable
  });
}

function errorResponse(message: string, code: string, status: number): Response {
  return json({ error: code, message }, status);
}

// ============================================================================
// ClickUp validation helpers (injected fetch for testability)
// ============================================================================

const CLICKUP_BASE_URL = 'https://api.clickup.com/api/v2';

interface ClickUpDeps {
  fetchImpl: typeof fetch;
  token: string;
}

/**
 * Get ClickUp List task count (page=0 to check if empty).
 *
 * `GET /list/{id}/task` excludes closed, subtasks, archived, and multi-list tasks by DEFAULT — without
 * these flags a List holding only closed/archived (or only-subtask) items reads as EMPTY, so push-seed
 * would proceed to seed into a List that is not actually empty. Count with the SAME full filter set the
 * sweep reads use (`reads.ts`'s `buildListQuery`) so emptiness here means the same thing it means there.
 */
async function getListTaskCount(deps: ClickUpDeps, listId: string): Promise<number> {
  const query = new URLSearchParams({
    page: '0',
    include_closed: 'true',
    subtasks: 'true',
    archived: 'true',
    include_timl: 'true',
  });
  const res = await fetchBounded(deps.fetchImpl, `${CLICKUP_BASE_URL}/list/${listId}/task?${query.toString()}`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    if (res.status === 404) throw new AppError('ClickUp List not found', 'NOT_FOUND');
    throw new AppError('Failed to fetch ClickUp list tasks', 'external-unreachable');
  }
  const data = (await res.json()) as { tasks: unknown[] };
  return data.tasks?.length ?? 0;
}

/** Verify List exists and get its configured statuses (they feed the status-map builder). */
async function getListDetails(deps: ClickUpDeps, listId: string): Promise<ClickUpListStatus[] | null> {
  const res = await fetchBounded(deps.fetchImpl, `${CLICKUP_BASE_URL}/list/${listId}`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new AppError('Failed to verify ClickUp list', 'external-unreachable');
  }
  const data = (await res.json()) as { statuses?: ClickUpListStatus[] };
  return data.statuses ?? [];
}

/** Get the List's members (best-effort input to the member-map join — OD-INT-10 §4). */
async function getListMembers(deps: ClickUpDeps, listId: string): Promise<Array<{ id: number; email?: string }>> {
  const res = await fetchBounded(deps.fetchImpl, `${CLICKUP_BASE_URL}/list/${listId}/member`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    throw new AppError('Failed to fetch ClickUp list members', 'external-unreachable');
  }
  const data = (await res.json()) as { members?: Array<{ id: number; email?: string }> };
  return data.members ?? [];
}

/**
 * Build the per-project member map (OD-INT-10 §4): join PMO profiles to ClickUp List members by
 * email. Best-effort and NEVER blocks the link — a fetch failure, or a List with no members yet,
 * simply degrades to an empty map (unmapped assignees are the routine, non-fatal case already
 * handled by toClickUpAssigneeId/fromClickUpAssignee).
 */
async function buildProjectMemberMap(
  deps: ClickUpDeps,
  serviceClient: SupabaseClient,
  orgId: string,
  listId: string,
): Promise<ClickUpMemberMap> {
  const empty: ClickUpMemberMap = { pmoToClickUp: {}, clickUpToPmo: {} };
  try {
    const rawMembers = await getListMembers(deps, listId);
    const clickUpMembers = rawMembers.filter(
      (m): m is { id: number; email: string } => typeof m.email === 'string' && m.email.length > 0,
    );
    if (clickUpMembers.length === 0) return empty;

    const { data: profiles, error } = await serviceClient.from('profiles').select('id, email').eq('org_id', orgId);
    if (error || !profiles) {
      console.error('member-map profiles lookup failed (non-fatal, linking continues)', error);
      return empty;
    }

    return buildClickUpMemberMap(profiles as Array<{ id: string; email: string }>, clickUpMembers);
  } catch (err) {
    console.error('ClickUp member map build failed (non-fatal, linking continues)', err);
    return empty;
  }
}

/** Get PMO project task count. */
async function getPmoTaskCount(
  serviceClient: SupabaseClient,
  orgId: string,
  projectId: string,
): Promise<number> {
  const { count, error } = await serviceClient
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('project_id', projectId)
    .is('tombstoned_at', null);
  if (error) throw new AppError(error.message, error.code);
  return count ?? 0;
}

/** Validate ClickUp link direction rules. Returns the List's configured statuses (feeds the
 *  status-map builder) so the caller doesn't need a second `GET /list/{id}`. */
async function validateClickUpLinkDirection(
  deps: ClickUpDeps,
  serviceClient: SupabaseClient,
  orgId: string,
  projectId: string,
  listId: string,
  direction: 'push-seed' | 'pull-adopt',
): Promise<{ statuses: ClickUpListStatus[] }> {
  // Verify List exists
  const listStatuses = await getListDetails(deps, listId);
  if (!listStatuses) {
    throw new AppError('ClickUp List not found', 'NOT_FOUND');
  }

  const listCount = await getListTaskCount(deps, listId);
  const pmoCount = await getPmoTaskCount(serviceClient, orgId, projectId);

  // Mixed case (both non-empty) - reject with action-required (409) first
  if (pmoCount > 0 && listCount > 0) {
    throw new AppError(
      'List and project both non-empty — choose a clean direction',
      'action-required',
    );
  }

  // Check direction constraints
  if (direction === 'push-seed') {
    // push-seed requires List to be empty
    if (listCount > 0) {
      throw new AppError(
        'List is not empty — push-seed requires an empty ClickUp List',
        'action-required',
      );
    }
  } else if (direction === 'pull-adopt') {
    // pull-adopt requires PMO project to be empty
    if (pmoCount > 0) {
      throw new AppError(
        'PMO project has tasks — pull-adopt requires an empty project',
        'action-required',
      );
    }
  }

  return { statuses: listStatuses };
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleLinkRequest(req: Request): Promise<Response> {
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

  const { data: actorState, error: actorError } = await serviceClient.rpc('actor_authorization_state', {
    p_org_id: profile.org_id,
    p_user_id: userId,
  });
  if (actorError || !actorState || actorState.active !== true || profile.status !== 'active') {
    return errorResponse('Active organization member required', 'FORBIDDEN', 403);
  }

  // 4. Check platform operator status
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = actorState.role === 'Admin';
  const isPlatformOperator = !!isOperator;

  // 5. Parse body - tier FIRST, then tier-specific auth
  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier } = body;
  if (tier !== 'clickup') {
    // The ERPNext company is chosen only through external-set-company's validated activation (version, read checks, defaults).
    return errorResponse('Unknown tier (must be clickup)', 'BAD_REQUEST', 400);
  }

  const featureKey = 'clickup_sync';
  const { data: featureEnabled, error: featureError } = await serviceClient.rpc('service_feature_enabled', {
    p_org_id: profile.org_id,
    p_key: featureKey,
  });
  if (featureError) return errorResponse('Could not resolve the plan switch', 'INTERNAL', 500);
  if (featureEnabled !== true) return errorResponse('This integration is not enabled for this organization', 'feature_off', 409);

  // 6. Load org's external binding
  const { data: binding, error: bindingError } = await serviceClient
    .from('external_org_bindings')
    .select('secret_ref, status, config, site_url')
    .eq('org_id', profile.org_id)
    .eq('external_tier', tier)
    .single();

  if (bindingError || !binding) {
    return errorResponse(`No ${tier} binding found for this org`, 'NOT_FOUND', 404);
  }

  if (binding.status !== 'active') {
    return errorResponse(`${tier} binding is not active`, 'CONFIG_REJECTED', 422);
  }

  // =========================================================================
  // ClickUp branch
  // =========================================================================
  if (tier === 'clickup') {
    const { projectId, listId, direction } = body;
    if (!projectId || !listId || !direction) {
      return errorResponse('projectId, listId, and direction are required for ClickUp', 'BAD_REQUEST', 400);
    }

    if (direction !== 'push-seed' && direction !== 'pull-adopt') {
      return errorResponse('direction must be push-seed or pull-adopt', 'BAD_REQUEST', 400);
    }

    // Load project and verify it belongs to caller's org
    const { data: project, error: projectError } = await serviceClient
      .from('projects')
      .select('id, project_manager_id, org_id')
      .eq('id', projectId)
      .eq('org_id', profile.org_id)
      .maybeSingle();

    if (projectError || !project) {
      return errorResponse('Project not found in this org', 'NOT_FOUND', 404);
    }

    const allowed = isAdmin || isPlatformOperator ||
      (actorState.role === 'Project Manager' && project.project_manager_id === userId);
    if (!allowed) {
      return errorResponse(
        'Admin, Operator, or Project Manager of this project (with active profile) required',
        'FORBIDDEN',
        403,
      );
    }

    // Resolve token from Vault
    const { data: token, error: vaultError } = await serviceClient.rpc('read_vault_secret', {
      p_secret_ref: binding.secret_ref,
    });

    if (vaultError || !token) {
      return errorResponse('ClickUp credentials not found in Vault', 'CONFIG_REJECTED', 422);
    }

    // Validate direction rules (also returns the List's configured statuses for the map builder)
    const clickUpDeps: ClickUpDeps = { fetchImpl: fetch, token: token as string };
    let listStatuses: ClickUpListStatus[];
    try {
      const result = await validateClickUpLinkDirection(
        clickUpDeps,
        serviceClient,
        profile.org_id,
        projectId,
        listId,
        direction,
      );
      listStatuses = result.statuses;
    } catch (err) {
      if (err instanceof AppError) {
        // Map the thrown AppError code to this fn's documented contract (see the header comment):
        // 404 = List/project/binding not found · 409 = action-required (mixed push-seed/pull-adopt)
        // · 422 = everything else (validation). Previously NOT_FOUND fell through to 422, which
        // contradicted the contract — a missing ClickUp List must be 404.
        const status = err.code === 'action-required' ? 409 : err.code === 'NOT_FOUND' ? 404 : 422;
        return errorResponse(err.message, err.code ?? 'CONFIG_REJECTED', status);
      }
      if (err instanceof FetchDeadlineError) {
        return errorResponse('ClickUp did not respond in time', 'external-unreachable', 502);
      }
      return errorResponse('Direction validation failed', 'CONFIG_REJECTED', 422);
    }

    // OD-INT-10: build + reject an incomplete binding BEFORE persisting — a status map that does
    // not cover every PMO status (To Do, In Progress, Done, Blocked) fails outbound writes on the
    // first task and silently corrupts inbound delivery reporting (delivery_pct/S-curve read off
    // status='Done'). This is a config problem with the List's status setup, not the mixed-content
    // "choose a direction" case (409 action-required above) — so it is a 422, matching every other
    // "the caller's input can't be honoured as configured" path in this function (e.g. the ERPNext
    // branch below).
    const statusMap = buildClickUpStatusMap(listStatuses);
    if (!statusMapCoversAllPmoStatuses(statusMap)) {
      return errorResponse(
        'ClickUp List cannot represent every PMO task status (To Do, In Progress, Done, Blocked) — ' +
          'add a status of each needed type in ClickUp before linking this List',
        'CONFIG_REJECTED',
        422,
      );
    }

    // Best-effort member map (FR-CUA-013, OD-INT-10 §4): never blocks the link.
    const memberMap = await buildProjectMemberMap(clickUpDeps, serviceClient, profile.org_id, listId);

    // Pre-insert check: prevent linking a List that's already actively bound to another project
    const { data: existingBinding, error: existingError } = await serviceClient
      .from('external_project_bindings')
      .select('id, project_id')
      .eq('org_id', profile.org_id)
      .eq('external_tier', 'clickup')
      .eq('external_container_id', listId)
      .is('disconnected_at', null)
      .maybeSingle();

    if (existingError) {
      console.error('external_project_bindings lookup failed', existingError);
      return errorResponse('Failed to check existing bindings', 'INTERNAL', 500);
    }

    if (existingBinding) {
      return errorResponse(
        `List is already linked to another project (${existingBinding.project_id})`,
        'CONFLICT',
        409,
      );
    }

    const { data: bindingId, error: insertError } = await serviceClient.rpc('link_external_project_audited', {
      p_org_id: profile.org_id,
      p_actor_id: userId,
      p_project_id: projectId,
      p_container_id: listId,
      p_config: { direction, statusMap, memberMap },
    });

    if (insertError) {
      if (insertError.code === '42501') return errorResponse('Current authority required', 'FORBIDDEN', 403);
      // Handle unique constraint violation (already linked)
      if (insertError.code === '23505') {
        return errorResponse('Project already linked to a ClickUp List', 'CONFLICT', 409);
      }
      console.error('external_project_bindings insert failed', insertError);
      return errorResponse('Failed to create project binding', 'INTERNAL', 500);
    }

    // The audit event is written by the RPC in the same transaction as the binding.
    return json({
      ok: true,
      binding: { id: bindingId, direction, listId },
    });
  }

  return errorResponse('Unknown tier', 'BAD_REQUEST', 400);
}

// Export validation functions for testing
export { validateClickUpLinkDirection, getPmoTaskCount };
export type { ClickUpDeps };

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  serveWithErrorReporting('external-link', handleLinkRequest);
}
