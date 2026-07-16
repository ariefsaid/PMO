/**
 * external-companies — Deno Edge Function entry point (OD-INT-6).
 *
 * Org-level ERPNext Company picker: fetches the Company list from the org's
 * ERPNext site using per-org Vault credentials.
 *
 * Flow:
 * 1. Verify caller JWT locally (ES256, JWKS) → get `sub` (user id)
 * 2. Load profile (role, org_id) via service-role client
 * 3. Role gate: Admin of the org OR platform Operator (direct platform_operators check)
 * 4. Load ERPNext binding for this org
 * 5. Resolve credentials from Vault via read_vault_secret RPC
 * 6. Fetch Company list from ERPNext (SSRF-guarded exactly like external-connect)
 * 7. Return { companies: [{ name }] }
 * 8. Audit log via log_audit
 *
 * Errors:
 * - 401: missing/invalid JWT
 * - 403: not Admin of org and not Operator
 * - 404: no ERPNext binding found for this org
 * - 422: binding not active / Vault secret missing
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

interface CompaniesBody {
  tier: 'erpnext';
}

interface CompaniesResponse {
  companies: Array<{ name: string }>;
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
// SSRF guard (mirrors external-connect exactly)
// ============================================================================

function isPrivateOrReservedHost(hostname: string): boolean {
  let host = hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
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
// ERPNext company fetch (injected fetch for testability)
// ============================================================================

interface ErpCompanyDeps {
  fetchImpl: typeof fetch;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

async function fetchErpNextCompanies(deps: ErpCompanyDeps): Promise<string[]> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(deps.siteUrl);
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
    const url = `${deps.siteUrl.replace(/\/$/, '')}/api/resource/Company?fields=["name"]&limit_page_length=200`;
    const res = await deps.fetchImpl(url, {
      headers: { Authorization: `token ${deps.apiKey}:${deps.apiSecret}` },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new AppError('ERPNext site not found', 'NOT_FOUND');
      }
      throw new AppError('Failed to fetch ERPNext companies', 'external-unreachable');
    }
    const data = (await res.json()) as { data?: Array<{ name: string }> };
    return (data.data ?? []).map((c) => c.name);
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Failed to fetch ERPNext companies', 'external-unreachable');
  }
}

// ============================================================================
// Main handler (exported for testability)
// ============================================================================

export async function handleCompaniesRequest(req: Request): Promise<Response> {
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
  //    REPLACED: is_operator() RPC call (uses auth.uid() which is null under service_role)
  //    WITH: direct platform_operators table check on the verified userId
  const { data: isOperator } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  const isAdmin = profile.role === 'Admin';
  const isPlatformOperator = !!isOperator;

  if (!isAdmin && !isPlatformOperator) {
    return errorResponse('Admin or Operator role required', 'FORBIDDEN', 403);
  }

  // 5. Parse body
  let body: CompaniesBody;
  try {
    body = (await req.json()) as CompaniesBody;
  } catch {
    return errorResponse('Invalid JSON body', 'BAD_REQUEST', 400);
  }

  const { tier } = body;
  if (tier !== 'erpnext') {
    return errorResponse('Only erpnext tier is supported for company list', 'BAD_REQUEST', 400);
  }

  // 6. Load ERPNext binding for this org
  const { data: binding, error: bindingError } = await serviceClient
    .from('external_org_bindings')
    .select('secret_ref, status, site_url')
    .eq('org_id', profile.org_id)
    .eq('external_tier', 'erpnext')
    .single();

  if (bindingError || !binding) {
    return errorResponse('No ERPNext binding found for this org', 'NOT_FOUND', 404);
  }

  if (binding.status !== 'active') {
    return errorResponse('ERPNext binding is not active', 'CONFIG_REJECTED', 422);
  }

  // 7. Resolve credentials from Vault
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

  // 8. Fetch Company list from ERPNext (SSRF-guarded)
  let companies: string[];
  try {
    companies = await fetchErpNextCompanies({
      fetchImpl: fetch,
      siteUrl: binding.site_url,
      apiKey,
      apiSecret,
    });
  } catch (err) {
    if (err instanceof AppError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'config-rejected' ? 422 : 502;
      return errorResponse(err.message ?? 'ERPNext error', err.code ?? 'external-unreachable', status);
    }
    return errorResponse('Failed to fetch ERPNext companies', 'external-unreachable', 502);
  }

  // 9. Audit log
  const { error: auditError } = await serviceClient.rpc('log_audit', {
    p_action: 'integration.list_companies',
    p_org_id: profile.org_id,
    p_actor_id: userId,
    p_entity_id: null,
    p_detail: {
      tier: 'erpnext',
      company_count: companies.length,
      actor: userId,
    },
  });
  if (auditError) console.error('log_audit failed', auditError);

  // 10. Return success
  return json({ companies: companies.map((name) => ({ name })) });
}

// Export validation function for testing
export { fetchErpNextCompanies, isPrivateOrReservedHost };
export type { ErpCompanyDeps };

// Deno.serve entry point (only runs when module is main)
if (import.meta.main) {
  Deno.serve(handleCompaniesRequest);
}