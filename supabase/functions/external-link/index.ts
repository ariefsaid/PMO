/**
 * external-link — Deno Edge Function entry point (Phase 3, tasks 3.2, 3.3).
 *
 * Project-level link to external system:
 * - ClickUp: links a PMO project to a ClickUp List with direction (push-seed | pull-adopt)
 * - ERPNext: updates the org's ERPNext binding with a Company doc name
 *
 * Auth: runs under CALLER JWT (verifyCallerJwt, ADR-0057), re-enforces tier-specific role gate on verified `sub`.
 * - ClickUp: Admin OR Operator OR (Project Manager of the project AND PM profile active)
 * - ERPNext: Admin OR Operator (org-level, not project-scoped)
 *
 * ClickUp direction rules (OD-CUA-3, mirrored from clickup-onboard):
 * - push-seed: List must be empty (ClickUp task count = 0)
 * - pull-adopt: PMO project must have no tasks
 * - MIXED (both non-empty) → 409 'action-required'
 *
 * On success (ClickUp): inserts external_project_bindings row with
 *   org_id, project_id, external_tier='clickup', external_container_id=listId,
 *   config={direction, statusMap:{}, memberMap:{}}, linked_by=sub, linked_at=now()
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
 * - 422: validation failed
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

interface LinkBody {
  tier: 'clickup' | 'erpnext';
  // ClickUp fields
  projectId?: string;
  listId?: string;
  direction?: 'push-seed' | 'pull-adopt';
  // ERPNext fields
  companyId?: string;
}

interface LinkResponse {
  ok: true;
  binding?: {
    id: string;
    direction?: 'push-seed' | 'pull-adopt';
    listId?: string;
  };
  companyId?: string;
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
// ClickUp validation helpers (injected fetch for testability)
// ============================================================================

interface ClickUpDeps {
  fetchImpl: typeof fetch;
  token: string;
  baseUrl?: string;
}

/** Get ClickUp List task count (page=0 to check if empty). */
async function getListTaskCount(deps: ClickUpDeps, listId: string): Promise<number> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await deps.fetchImpl(`${baseUrl}/list/${listId}/task?page=0`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return -1; // List not found
    throw new AppError('Failed to fetch ClickUp list tasks', 'external-unreachable');
  }
  const data = (await res.json()) as { tasks: unknown[] };
  return data.tasks?.length ?? 0;
}

/** Verify List exists and get its name. */
async function verifyListExists(deps: ClickUpDeps, listId: string): Promise<string | null> {
  const baseUrl = deps.baseUrl ?? 'https://api.clickup.com/api/v2';
  const res = await deps.fetchImpl(`${baseUrl}/list/${listId}`, {
    headers: { Authorization: `Bearer ${deps.token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new AppError('Failed to verify ClickUp list', 'external-unreachable');
  }
  const data = (await res.json()) as { name: string };
  return data.name;
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

/** Validate ClickUp link direction rules. */
async function validateClickUpLinkDirection(
  deps: ClickUpDeps,
  serviceClient: SupabaseClient,
  orgId: string,
  projectId: string,
  listId: string,
  direction: 'push-seed' | 'pull-adopt',
): Promise<void> {
  // Verify List exists
  const listName = await verifyListExists(deps, listId);
  if (!listName) {
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
}

// ============================================================================
// ERPNext validation helpers
// ============================================================================

interface ErpNextDeps {
  fetchImpl: typeof fetch;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

/** Validate ERPNext Company exists. SSRF-guarded like external-connect. */
async function validateErpNextCompany(deps: ErpNextDeps, companyId: string): Promise<void> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(deps.siteUrl);
  } catch {
    throw new AppError('Invalid ERPNext site URL', 'config-rejected');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new AppError('Only HTTPS URLs are allowed', 'config-rejected');
  }
  const hostname = parsedUrl.hostname;
  if (isPrivateOrReservedHost(hostname)) {
    throw new AppError('Private or reserved addresses are not allowed', 'config-rejected');
  }

  const url = `${deps.siteUrl.replace(/\/$/, '')}/api/resource/Company/${encodeURIComponent(companyId)}`;
  const res = await deps.fetchImpl(url, {
    headers: { Authorization: `token ${deps.apiKey}:${deps.apiSecret}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    if (res.status === 404) {
      throw new AppError('Company not found in ERPNext', 'NOT_FOUND');
    }
    throw new AppError('Failed to validate ERPNext company', 'external-unreachable');
  }
}

function isPrivateOrReservedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.split(':')[0];

  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '::1' || host.startsWith('127.')) return true;

  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }

  if (host.startsWith('fc') || host.startsWith('fd')) {
    const firstHextet = host.split(':')[0];
    const first = parseInt(firstHextet, 16);
    if (!isNaN(first) && (first & 0xfe) === 0xfc) return true;
  }
  if (host === '::') return true;
  if (host === '::1') return true;
  if (host === '169.254.169.254') return true;
  if (host === 'metadata.google.internal') return true;
  if (host === 'metadata.azure.com') return true;

  return false;
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleLinkRequest(req: Request): Promise<Response> {
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

  // 4. Check platform operator status
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = profile.role === 'Admin';
  const isPlatformOperator = !!isOperator;

  // 5. Parse body - tier FIRST, then tier-specific auth
  let body: LinkBody;
  try {
    body = (await req.json()) as LinkBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier } = body;
  if (tier !== 'clickup' && tier !== 'erpnext') {
    return errorResponse('Unknown tier (must be clickup or erpnext)', 'BAD_REQUEST', 400);
  }

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

    // Validate direction rules
    const clickUpDeps: ClickUpDeps = { fetchImpl: fetch, token: token as string };
    try {
      await validateClickUpLinkDirection(clickUpDeps, serviceClient, profile.org_id, projectId, listId, direction);
    } catch (err) {
      if (err instanceof AppError) {
        return errorResponse(err.message, err.code ?? 'CONFIG_REJECTED', err.code === 'action-required' ? 409 : 422);
      }
      return errorResponse('Direction validation failed', 'CONFIG_REJECTED', 422);
    }

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

    // Insert external_project_bindings row
    const { data: bindingRow, error: insertError } = await serviceClient
      .from('external_project_bindings')
      .insert({
        org_id: profile.org_id,
        project_id: projectId,
        external_tier: 'clickup',
        external_container_id: listId,
        config: {
          direction,
          statusMap: {},
          memberMap: {},
        },
        linked_by: userId,
        linked_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) {
      // Handle unique constraint violation (already linked)
      if (insertError.code === '23505') {
        return errorResponse('Project already linked to a ClickUp List', 'CONFLICT', 409);
      }
      console.error('external_project_bindings insert failed', insertError);
      return errorResponse('Failed to create project binding', 'INTERNAL', 500);
    }

    // Audit log
    const { error: auditError } = await serviceClient.rpc('log_audit', {
      p_action: 'integration.link',
      p_org_id: profile.org_id,
      p_actor_id: userId,
      p_entity_id: bindingRow.id,
      p_detail: jsonbBuildObject({
        tier: 'clickup',
        project_id: projectId,
        list_id: listId,
        direction,
        actor: userId,
      }),
    });
    if (auditError) console.error('log_audit failed', auditError);

    return json({
      ok: true,
      binding: { id: bindingRow.id, direction, listId },
    });
  }

  // =========================================================================
  // ERPNext branch
  // =========================================================================
  if (tier === 'erpnext') {
    // ERPNext is org-level, not project-scoped. Admin/Operator only (PM not allowed).
    if (!isAdmin && !isPlatformOperator) {
      return errorResponse('Admin or Operator role required for ERPNext link', 'FORBIDDEN', 403);
    }

    const { companyId } = body;
    if (!companyId) {
      return errorResponse('companyId is required for ERPNext', 'BAD_REQUEST', 400);
    }

    // Resolve ERPNext credentials from Vault
    const { data: vaultSecret, error: vaultError } = await serviceClient.rpc('read_vault_secret', {
      p_secret_ref: binding.secret_ref,
    });

    if (vaultError || !vaultSecret) {
      return errorResponse('ERPNext credentials not found in Vault', 'CONFIG_REJECTED', 422);
    }

    const stored = (vaultSecret as string).split(':');
    if (stored.length !== 2) {
      return errorResponse('Invalid ERPNext credential format in Vault', 'CONFIG_REJECTED', 422);
    }
    const [apiKey, apiSecret] = stored;

    // Validate Company exists in ERPNext
    const erpNextDeps: ErpNextDeps = {
      fetchImpl: fetch,
      siteUrl: binding.site_url,
      apiKey,
      apiSecret,
    };

    try {
      await validateErpNextCompany(erpNextDeps, companyId);
    } catch (err) {
      if (err instanceof AppError) {
        return errorResponse(err.message, err.code ?? 'CONFIG_REJECTED', err.code === 'NOT_FOUND' ? 404 : 422);
      }
      return errorResponse('Company validation failed', 'CONFIG_REJECTED', 422);
    }

    // Update external_org_bindings.config.company
    const newConfig = { ...(binding.config as Record<string, unknown>), company: companyId };
    const { error: updateError } = await serviceClient
      .from('external_org_bindings')
      .update({ config: newConfig })
      .eq('org_id', profile.org_id)
      .eq('external_tier', 'erpnext');

    if (updateError) {
      console.error('external_org_bindings config update failed', updateError);
      return errorResponse('Failed to update ERPNext binding', 'INTERNAL', 500);
    }

    // Audit log
    const { error: auditError } = await serviceClient.rpc('log_audit', {
      p_action: 'integration.link',
      p_org_id: profile.org_id,
      p_actor_id: userId,
      p_entity_id: null,
      p_detail: jsonbBuildObject({
        tier: 'erpnext',
        company_id: companyId,
        actor: userId,
      }),
    });
    if (auditError) console.error('log_audit failed', auditError);

    return json({ ok: true, companyId });
  }

  return errorResponse('Unknown tier', 'BAD_REQUEST', 400);
}

// Helper to build JSONB object (since we can't use Postgres jsonb_build_object directly)
export function jsonbBuildObject(obj: Record<string, unknown>): Record<string, unknown> {
  return obj;
}

// Export validation functions for testing
export { validateClickUpLinkDirection, validateErpNextCompany, getPmoTaskCount };
export type { ClickUpDeps, ErpNextDeps };

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  Deno.serve(handleLinkRequest);
}