/**
 * external-connect — Deno Edge Function entry point (Phase 2, task 2.2).
 *
 * Admin self-serve org-level connect for ClickUp / ERPNext.
 * Runs under the CALLER JWT (verified locally via verifyCallerJwt, ADR-0057),
 * then re-enforces Admin/Operator gate BEFORE any Vault write or binding insert.
 *
 * Flow:
 * 1. Verify caller JWT locally (ES256, JWKS) → get `sub` (user id)
 * 2. Load profile (role, org_id) via service-role client
 * 3. Role gate: Admin of the org OR platform Operator (direct platform_operators check)
 * 4. Validate credential against external system (injected fetch for testability)
 *    - ClickUp: GET /api/v2/user with Bearer token
 *    - ERPNext: GET /api/resource/User/<apiKey> with token apiKey:apiSecret
 *    - SSRF hardening: reject private/loopback/link-local/metadata addresses for ERPNext
 * 5. On success: call create_vault_secret_for_org RPC (passes p_actor_id=sub for service-role path)
 * 6. For ClickUp: call admin_change_domain_ownership(org, 'clickup', 'tasks', 'employ', userId)
 * 7. Return { ok: true, binding: { secret_ref, status: 'active' } }
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: not Admin of org and not Operator
 * - 422: invalid credential (validation failed) — NO Vault write, NO binding row
 * - 400: unknown tier or malformed body
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
import { externalConnectEnabled } from '../_shared/externalConnectEnabled.ts';
import { resolvePerOrgSecret } from '../_shared/perOrgSecret.ts';

interface ConnectBody {
  tier: 'clickup' | 'erpnext';
  credential: {
    token?: string;           // ClickUp personal access token
    apiKey?: string;          // ERPNext API key
    apiSecret?: string;       // ERPNext API secret
    siteUrl?: string;         // ERPNext site URL (e.g., https://erp.example.com)
  };
}

interface ConnectResponse {
  ok: true;
  binding: {
    secret_ref: string;
    status: 'active';
  };
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

/** Strip a case-insensitive `Bearer ` prefix; return null if absent or malformed. */
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
// Credential validators (injected fetch for unit testability)
// ============================================================================

interface ValidatorDeps {
  fetchImpl: typeof fetch;
}

/**
 * Validate the token against `GET /user` and return the ClickUp actor id (`user.id`, stringified) —
 * the echo-loop guard's identity (item 4 of the read-hygiene fix: PMO writes with a token belonging to
 * a real ClickUp user, so PMO's own writes fire webhooks back at PMO; ClickUp's only supported
 * loop-break is comparing `history_items[*].user.id` against this persisted actor id).
 *
 * Returns `null` (never throws) when the response is missing/malformed `user.id` — the token itself
 * validated fine (`res.ok`), so an unexpected wire shape must not block the connect; it only means the
 * echo-loop guard can't be armed for this org until a later reconnect gets a well-formed response.
 */
async function validateClickUpToken(
  token: string,
  deps: ValidatorDeps,
): Promise<string | null> {
  let res: Response;
  try {
    res = await deps.fetchImpl('https://api.clickup.com/api/v2/user', {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid ClickUp token', 'config-rejected');
  }
  if (!res.ok) {
    throw new AppError('Invalid ClickUp token', 'config-rejected');
  }
  try {
    const body = (await res.json()) as { user?: { id?: number | string } };
    const id = body.user?.id;
    return id !== undefined && id !== null ? String(id) : null;
  } catch {
    return null;
  }
}

async function validateClickUpTeam(token: string, deps: ValidatorDeps): Promise<string> {
  const res = await deps.fetchImpl('https://api.clickup.com/api/v2/team', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AppError('Unable to resolve ClickUp workspace', 'config-rejected');
  try {
    const body = (await res.json()) as { teams?: Array<{ id?: number | string }> };
    const id = body.teams?.[0]?.id;
    if (id === undefined || id === null || String(id) === '') throw new Error('missing team id');
    return String(id);
  } catch {
    throw new AppError('Unable to resolve ClickUp workspace', 'config-rejected');
  }
}

async function validateErpNextCredentials(
  siteUrl: string,
  apiKey: string,
  apiSecret: string,
  deps: ValidatorDeps,
): Promise<void> {
  // SSRF hardening: parse URL and reject private/loopback/link-local/metadata addresses
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(siteUrl);
  } catch {
    throw new AppError('Invalid site URL', 'config-rejected');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new AppError('Only HTTPS URLs are allowed', 'config-rejected');
  }

  const hostname = parsedUrl.hostname;
  if (isPrivateOrReservedHost(hostname)) {
    throw new AppError('Private or reserved addresses are not allowed', 'config-rejected');
  }

  try {
    const url = `${siteUrl.replace(/\/$/, '')}/api/resource/User/${encodeURIComponent(apiKey)}`;
    const res = await deps.fetchImpl(url, {
      headers: { Authorization: `token ${apiKey}:${apiSecret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new AppError('Invalid ERPNext credentials', 'config-rejected');
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid ERPNext credentials', 'config-rejected');
  }
}

/** Check if a hostname resolves to or is a private/loopback/link-local/metadata address. */
function isPrivateOrReservedHost(hostname: string): boolean {
  // Normalize: remove brackets from IPv6 addresses, remove port, lowercase
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1); // Remove brackets from [::1] format
  }
  host = host.split(':')[0]; // Remove port if present

  // Localhost and loopback
  if (host === 'localhost' || host === 'localhost.localdomain') return true;
  if (host === '::1' || host.startsWith('127.')) return true;

  // IPv4 private ranges
  const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const a = parseInt(ipv4Match[1], 10);
    const b = parseInt(ipv4Match[2], 10);
    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0/8
    if (a === 0) return true;
  }

  // IPv6 private ranges
  if (host.startsWith('fc') || host.startsWith('fd')) {
    // More precise fc00::/7 check
    const firstHextet = host.split(':')[0];
    const first = parseInt(firstHextet, 16);
    if (!isNaN(first) && (first & 0xfe) === 0xfc) return true; // fc00::/7
  }
  if (host === '::') return true; // unspecified
  if (host === '::1') return true; // loopback (already caught above but safe)

  // Cloud metadata endpoints (common patterns)
  if (host === '169.254.169.254') return true; // AWS/Azure/GCE metadata
  if (host === 'metadata.google.internal') return true;
  if (host === 'metadata.azure.com') return true;

  return false;
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleConnectRequest(req: Request): Promise<Response> {
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

  // 2. Service-role client for admin lookups (profile, operator check)
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, testSupabaseOptions);

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
  //    REPLACED: is_operator() RPC call (uses auth.uid() which is null under service_role)
  //    WITH: direct platform_operators table check on the verified userId
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = profile.role === 'Admin';
  if (!isAdmin && !isOperator) {
    return errorResponse('Admin or Operator role required', 'FORBIDDEN', 403);
  }

  // 5. Parse body
  let body: ConnectBody;
  try {
    body = (await req.json()) as ConnectBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier, credential } = body;
  if (tier !== 'clickup' && tier !== 'erpnext') {
    return errorResponse('Unknown tier (must be clickup or erpnext)', 'BAD_REQUEST', 400);
  }

  // 6. The deployment kill-switch is checked before external validation and all writes.
  // It is an operator break-glass, never a client-side status signal.
  const killSwitchEnabled = externalConnectEnabled();
  if (!killSwitchEnabled) {
    return errorResponse('Integration disabled by operator; try again later', 'INTEGRATION_DISABLED', 503);
  }

  // Validate credential against external system BEFORE any Vault write.
  const validatorDeps = { fetchImpl: fetch };
  let clickUpUserId: string | null = null;
  let clickUpTeamId: string | null = null;
  try {
    if (tier === 'clickup') {
      const token = credential.token;
      if (!token || typeof token !== 'string') {
        return errorResponse('ClickUp token is required', 'BAD_REQUEST', 400);
      }
      clickUpUserId = await validateClickUpToken(token, validatorDeps);
      clickUpTeamId = await validateClickUpTeam(token, validatorDeps);
    } else {
      const { siteUrl, apiKey, apiSecret } = credential;
      if (!siteUrl || !apiKey || !apiSecret) {
        return errorResponse('ERPNext siteUrl, apiKey, and apiSecret are required', 'BAD_REQUEST', 400);
      }
      await validateErpNextCredentials(siteUrl, apiKey, apiSecret, validatorDeps);
    }
  } catch (err) {
    if (err instanceof AppError && err.code === 'config-rejected') {
      return errorResponse(err.message, err.code, 422);
    }
    return errorResponse('Credential validation failed', 'config-rejected', 422);
  }

  // 7. Credential is valid → create Vault secret + upsert binding via RPC
  //    The RPC handles: Vault write, binding upsert, audit log, secret rotation on reconnect
  const secretName = `${tier}_token_${profile.org_id}_${Date.now()}`;
  const secretValue = tier === 'clickup'
    ? credential.token!
    : `${credential.apiKey}:${credential.apiSecret}`;

  const { data: secretRef, error: rpcError } = await serviceClient.rpc(
    'create_vault_secret_for_org',
    {
      p_org_id: profile.org_id,
      p_external_tier: tier,
      p_secret_value: secretValue,
      p_secret_name: secretName,
      // Pass the verified caller's sub as p_actor_id.
      // The RPC uses coalesce(auth.uid(), p_actor_id) — service_role has auth.uid()=null,
      // so p_actor_id becomes the effective actor for the privilege check.
      p_actor_id: userId,
    }
  );

  if (rpcError) {
    const pgCode = (rpcError as { code?: string }).code ?? 'INTERNAL';
    return errorResponse(rpcError.message, pgCode, pgCode === '42501' ? 403 : 500);
  }

  // 8. Readiness is exactly the valid token plus the real per-org Vault resolver. No extra
  // ClickUp API call is made. The final RPC is the only path that can employ ownership.
  if (tier === 'clickup') {
    const readiness = await resolvePerOrgSecret({
      connectEnabled: true,
      orgId: profile.org_id,
      tier: 'clickup',
      lookupBinding: async (orgId, externalTier) => {
        const { data } = await serviceClient.from('external_org_bindings')
          .select('secret_ref').eq('org_id', orgId).eq('external_tier', externalTier)
          .eq('status', 'active').maybeSingle();
        return data as { secret_ref?: string | null } | null;
      },
      readVaultSecret: async (ref) => {
        const { data } = await serviceClient.rpc('read_vault_secret', { p_secret_ref: ref });
        return typeof data === 'string' ? data : null;
      },
    });
    if (readiness.kind !== 'resolved') {
      // The service-only finalize boundary performs the binding + Vault cleanup in its transaction.
      // The fallback is defensive for an unavailable RPC and remains secret-free.
      const { error: readinessError } = await serviceClient.rpc('finalize_external_connect', {
        p_org_id: profile.org_id, p_external_tier: tier, p_secret_ref: secretRef,
        p_kill_switch_enabled: killSwitchEnabled, p_ready: false, p_actor_id: userId,
      });
      if (readinessError) {
        await serviceClient.rpc('delete_vault_secret', { p_secret_name: secretRef });
        await serviceClient.rpc('cleanup_external_connect_attempt', {
          p_org_id: profile.org_id, p_external_tier: tier, p_secret_ref: secretRef, p_actor_id: userId,
        });
      }
      return errorResponse('ClickUp sync is not ready; no connection was activated', 'SYNC_NOT_READY', 422);
    }

    const { error: finalizeError } = await serviceClient.rpc('finalize_external_connect', {
      p_org_id: profile.org_id,
      p_external_tier: tier,
      p_secret_ref: secretRef,
      p_kill_switch_enabled: killSwitchEnabled,
      p_ready: true,
      p_actor_id: userId,
    });
    if (finalizeError) {
      await serviceClient.rpc('delete_vault_secret', { p_secret_name: secretRef });
      await serviceClient.rpc('cleanup_external_connect_attempt', {
        p_org_id: profile.org_id, p_external_tier: tier, p_secret_ref: secretRef, p_actor_id: userId,
      });
      return errorResponse('ClickUp sync could not be activated; no connection was committed', 'CONNECT_NOT_COMMITTED', 500);
    }

    // Persist both identities atomically after the ownership/binding commit. They contain no secret.
    const configPatch: Record<string, unknown> = {};
    if (clickUpUserId !== null) configPatch.clickup_actor_id = clickUpUserId;
    if (clickUpTeamId !== null) configPatch.clickup_team_id = clickUpTeamId;
    if (Object.keys(configPatch).length > 0) {
      const { error: configError } = await serviceClient.rpc('merge_external_org_binding_config', {
        p_org_id: profile.org_id, p_external_tier: 'clickup', p_patch: configPatch,
      });
      if (configError) console.error('external_org_bindings clickup identity persist failed', configError);
    }
  }

  // 9. Return success
  return json({
    ok: true,
    binding: {
      secret_ref: secretRef,
      status: 'active',
    },
  });
}

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  Deno.serve(handleConnectRequest);
}

// Export validators and SSRF helper for testability
export { validateClickUpToken, validateErpNextCredentials, isPrivateOrReservedHost };
export type { ValidatorDeps };
