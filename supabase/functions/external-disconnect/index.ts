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
 * 3. Role gate: Admin of the org OR platform Operator (is_operator())
 * 4. Load external_org_bindings row for (org_id, tier)
 * 5. Call delete_vault_secret RPC with secret_ref
 * 6. Update binding: status='disconnected', disconnected_at=now()
 * 7. For ClickUp: call operator_set_domain_ownership(org, 'clickup', 'tasks', 'release')
 * 8. Emit audit event: action='integration.disconnect'
 * 9. Return { ok: true }
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

Deno.serve(async (req: Request): Promise<Response> => {
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

  // 4. Role gate: Admin of this org OR platform Operator
  const { data: isOperator } = await serviceClient.rpc('is_operator').single();
  const isAdmin = profile.role === 'Admin';
  if (!isAdmin && !isOperator) {
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

  // 6. Load binding row
  const { data: binding, error: bindingError } = await serviceClient
    .from('external_org_bindings')
    .select('secret_ref, webhook_secret_ref')
    .eq('org_id', profile.org_id)
    .eq('external_tier', tier)
    .single();

  if (bindingError || !binding) {
    return errorResponse('No binding found for this tier', 'NOT_FOUND', 404);
  }

  // 7. Delete Vault secret via RPC
  const { error: deleteError } = await serviceClient.rpc('delete_vault_secret', {
    p_secret_name: binding.secret_ref,
  });
  if (deleteError) {
    console.error('delete_vault_secret failed', deleteError);
    return errorResponse('Failed to delete Vault secret', 'INTERNAL', 500);
  }

  // 8. Update binding to disconnected (soft-archive)
  const { error: updateError } = await serviceClient
    .from('external_org_bindings')
    .update({ status: 'disconnected', disconnected_at: new Date().toISOString() })
    .eq('org_id', profile.org_id)
    .eq('external_tier', tier);

  if (updateError) {
    console.error('external_org_bindings update failed', updateError);
    return errorResponse('Failed to update binding', 'INTERNAL', 500);
  }

  // 9. For ClickUp, release domain ownership
  if (tier === 'clickup') {
    const { error: ownershipError } = await serviceClient.rpc(
      'operator_set_domain_ownership',
      {
        p_org_id: profile.org_id,
        p_external_tier: 'clickup',
        p_domain: 'tasks',
        p_action: 'release',
      }
    );
    if (ownershipError) {
      // Log but don't fail — binding is already disconnected
      console.error('operator_set_domain_ownership release failed', ownershipError);
    }
  }

  // 10. Emit audit event
  const { error: auditError } = await serviceClient.rpc('log_audit', {
    p_action: 'integration.disconnect',
    p_org_id: profile.org_id,
    p_payload: {
      tier,
      actor: userId,
    },
  });
  if (auditError) {
    console.error('log_audit failed', auditError);
  }

  // 11. Return success
  return json({ ok: true });
});