/**
 * external-disconnect — Deno Edge Function entry point (Phase 2, task 2.4).
 *
 * Admin self-serve org-level disconnect for ClickUp / ERPNext.
 * Runs under the CALLER JWT (verified locally via verifyCallerJwt, ADR-0057),
 * then re-enforces Admin/Operator gate BEFORE any Vault delete or binding update.
 *
 * Flow:
 * 1. Verify caller JWT locally (ES256, JWKS) → get `sub` (user id)
 * 2. Load profile (role, org_id) via service-role client
 * 3. Role gate: Admin of the org OR platform Operator (direct platform_operators check)
 * 4. Call disconnect_external_integration — current standing, vault deletion and binding revocation
 *    are checked and applied in one transaction.
 * 5. Emit log_audit('integration.disconnect', org, actor, null, detail)
 * 6. Return { ok: true }
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: not Admin of org and not Operator
 * - 404: no binding found for tier
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
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

interface DisconnectBody {
  tier: 'clickup' | 'erpnext';
}

interface DisconnectResponse {
  ok: true;
}

// Memoized JWKS resolver (same pattern as agent-chat, adapter-dispatch)
let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}

// Test hook: allow injecting a local JWKS resolver to avoid background intervals from
// createRemoteJWKSet during tests.
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

export async function handleDisconnectRequest(req: Request): Promise<Response> {
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

  // 3. Load caller profile (role + org_id)
  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('org_id, role, status')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    return errorResponse('Profile not found', 'FORBIDDEN', 403);
  }

  // 4. Role gate: Admin of this org OR platform Operator
  //    Direct check on platform_operators (service-role bypasses RLS) —
  //    NOT is_operator() which uses auth.uid() and fails under service_role.
  const { data: isOperator, error: operatorError } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (operatorError) {
    console.error('platform_operators check failed', operatorError);
    return errorResponse('Internal error', 'INTERNAL', 500);
  }

  const isActiveProfile = profile.status === 'active';
  const isAdmin = profile.role === 'Admin';
  const isPlatformOperator = !!isOperator;
  if (!isActiveProfile || (!isAdmin && !isPlatformOperator)) {
    return errorResponse('Admin or Operator role required', 'FORBIDDEN', 403);
  }

  // 5. Parse body
  let body: DisconnectBody;
  try {
    body = (await req.json()) as DisconnectBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier } = body;
  if (tier !== 'clickup' && tier !== 'erpnext') {
    return errorResponse('Unknown tier (must be clickup or erpnext)', 'BAD_REQUEST', 400);
  }

  // 6. The definer transaction re-checks actor standing and role before touching either credential or binding.
  const { data: touched, error: disconnectError } = await serviceClient.rpc('disconnect_external_integration', {
    p_org_id: profile.org_id,
    p_external_tier: tier,
    p_actor_id: userId,
  });
  if (disconnectError) {
    console.error('disconnect_external_integration failed', disconnectError);
    const denied = disconnectError.code === '42501';
    return errorResponse('Failed to disconnect integration', denied ? 'FORBIDDEN' : 'INTERNAL', denied ? 403 : 500);
  }
  if (touched === 0) return errorResponse('No binding found for this tier', 'NOT_FOUND', 404);

  // 7. Emit audit event for the disconnect
  const { error: auditError } = await serviceClient.rpc('log_audit', {
    p_action: 'integration.disconnect',
    p_org_id: profile.org_id,
    // ⚑ log_audit is (p_action, p_org_id, p_actor_id, p_entity_id, p_detail) — mig 0076. The previous
    // call passed `p_entity_type` (no such parameter) and omitted `p_actor_id`, so no overload matched
    // and this audit event was never written.
    p_actor_id: userId,
    p_entity_id: null,
    p_detail: { tier, actor: userId },
  });
  if (auditError) {
    console.error('log_audit failed', auditError);
  }

  // 11. Return success
  return json({ ok: true });
}

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  serveWithErrorReporting('external-disconnect', handleDisconnectRequest);
}