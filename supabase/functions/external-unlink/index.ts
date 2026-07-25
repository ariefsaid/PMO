/**
 * external-unlink — Deno Edge Function entry point (Phase 3, task 3.4).
 *
 * Project/org-level unlink from external system:
 * - ClickUp: soft-archives external_project_bindings row (sets disconnected_at=now(), keeps tombstone)
 * - ERPNext: clears external_org_bindings.config.company
 *
 * Auth: runs under CALLER JWT (verifyCallerJwt, ADR-0057), re-enforces tier-specific role gate on verified `sub`.
 * - ClickUp: Admin OR Operator OR (Project Manager of the project AND PM profile active)
 * - ERPNext: Admin OR Operator (org-level)
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: role gate failed
 * - 404: binding not found
 * - 500: internal error
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  verifyCallerJwt,
  JwtVerifyError,
  jwksFromUrl,
  type JwksResolver,
} from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';

interface UnlinkBody {
  tier: 'clickup' | 'erpnext';
  projectId?: string; // required for ClickUp project unlink
}

interface UnlinkResponse {
  ok: true;
}

let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

// Test hook: allow injecting a local JWKS resolver (e.g., from createLocalJWKSet) to avoid
// background intervals from createRemoteJWKSet during tests.
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
// Main handler (exported for testability)
// ============================================================================

export async function handleUnlinkRequest(req: Request): Promise<Response> {
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
  let body: UnlinkBody;
  try {
    body = (await req.json()) as UnlinkBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier, projectId } = body;
  if (tier !== 'clickup' && tier !== 'erpnext') {
    return errorResponse('Unknown tier (must be clickup or erpnext)', 'BAD_REQUEST', 400);
  }

  // =========================================================================
  // ClickUp branch: soft-archive external_project_bindings row
  // =========================================================================
  if (tier === 'clickup') {
    if (!projectId) {
      return errorResponse('projectId is required for ClickUp unlink', 'BAD_REQUEST', 400);
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
      return errorResponse('No active ClickUp binding found for this project', 'NOT_FOUND', 404);
    }

    // Soft-archive: set disconnected_at = now()
    const { error: updateError } = await serviceClient
      .from('external_project_bindings')
      .update({ disconnected_at: new Date().toISOString() })
      .eq('id', binding.id);

    if (updateError) {
      console.error('external_project_bindings soft-archive failed', updateError);
      return errorResponse('Failed to unlink project', 'INTERNAL', 500);
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

    return json({ ok: true });
  }

  // =========================================================================
  // ERPNext branch: clear config.company
  // =========================================================================
  if (tier === 'erpnext') {
    // ERPNext is org-level; Admin/Operator only (PM not allowed)
    if (!isAdmin && !isPlatformOperator) {
      return errorResponse('Admin or Operator role required for ERPNext unlink', 'FORBIDDEN', 403);
    }

    // Load org binding
    const { data: binding, error: bindingError } = await serviceClient
      .from('external_org_bindings')
      .select('config')
      .eq('org_id', profile.org_id)
      .eq('external_tier', 'erpnext')
      .maybeSingle();

    if (bindingError || !binding) {
      return errorResponse('No ERPNext binding found for this org', 'NOT_FOUND', 404);
    }

    const currentConfig = (binding.config as Record<string, unknown>) ?? {};
    if (!currentConfig.company) {
      return errorResponse('No ERPNext company linked', 'NOT_FOUND', 404);
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
      return errorResponse('Failed to unlink ERPNext company', 'INTERNAL', 500);
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

    return json({ ok: true });
  }

  return errorResponse('Unknown tier', 'BAD_REQUEST', 400);
}

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  Deno.serve(handleUnlinkRequest);
}