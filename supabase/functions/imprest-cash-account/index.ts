/**
 * imprest-cash-account — Deno Edge Function (#1515 S6, spec §9): bind a site float to the ERP cash account its cash moves
 * through. Tier-neutral: it reads the org's binding, picks the tier's validator from a registry KEYED BY TIER (the allowed
 * seam — no tier comparison anywhere), validates, then writes `imprest_floats.erp_cash_account_ref` as service role (no
 * client holds that grant) and audits `imprest_float.cash_account`. A tier with no validator is refused: fail closed.
 *
 * POST { floatId, account } by an active Admin or Finance member of the float's org.
 * 400 bad body · 401 no/invalid JWT · 403 role · 404 float/binding not found · 409 unsupported tier ·
 * 422 account does not fit · 502 ERP unreachable.
 */
import { createClient } from '@supabase/supabase-js';
import { verifyCallerJwt, JwtVerifyError, jwksFromUrl, type JwksResolver } from '../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { ERPNEXT_TIER } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/adapter.ts';
import { validateErpnextCashAccount, type CashAccountCheck } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/imprestCashAccount.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';
import { guardedErpFetch, isPermittedErpSiteUrl } from '../_shared/erpHostGuard.ts';

type CashAccountValidator = (check: CashAccountCheck) => Promise<boolean>;
const VALIDATORS: Readonly<Record<string, CashAccountValidator>> = { [ERPNEXT_TIER]: validateErpnextCashAccount };

let _jwks: JwksResolver | null = null;
function getJwks(supabaseUrl: string): JwksResolver {
  if (!_jwks) _jwks = jwksFromUrl(`${supabaseUrl}/auth/v1/.well-known/jwks.json`);
  return _jwks;
}
// Test hooks, as external-set-company: a local JWKS resolver and timer-free Supabase client options.
export function setTestJwks(resolver: JwksResolver): void { _jwks = resolver; }
export const testSupabaseOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' },
  });
}
const fail = (message: string, code: string, status: number): Response => json({ error: code, message }, status);

export async function handleImprestCashAccountRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return json('ok');
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
  if (!token) return fail('Missing Authorization header', 'UNAUTHORIZED', 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) return fail('Server misconfigured', 'MISCONFIGURED', 500);

  let userId: string;
  try {
    userId = (await verifyCallerJwt(token, getJwks(supabaseUrl), {
      issuer: Deno.env.get('EDGE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'],
    })).sub;
  } catch (err) {
    return fail('Invalid JWT', 'UNAUTHORIZED', err instanceof JwtVerifyError ? err.status : 401);
  }

  let body: { floatId?: unknown; account?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return fail('Invalid JSON body', 'BAD_REQUEST', 400);
  }
  const account = typeof body?.account === 'string' ? body.account.trim() : '';
  if (typeof body?.floatId !== 'string' || !UUID.test(body.floatId) || !account || account.length > 140) {
    return fail('floatId and account are required', 'BAD_REQUEST', 400);
  }

  const sc = createClient(supabaseUrl, serviceRoleKey, testSupabaseOptions);
  const { data: profile } = await sc.from('profiles').select('org_id, role').eq('id', userId).single();
  if (!profile || !['Admin', 'Finance'].includes(profile.role)) return fail('Admin or Finance role required', 'FORBIDDEN', 403);
  // The caller must CURRENTLY be an active member of the org, not just hold the role on a valid token.
  const { data: actorState, error: actorError } = await sc.rpc('actor_authorization_state', { p_org_id: profile.org_id, p_user_id: userId });
  if (actorError || !actorState || (actorState as { active?: unknown }).active !== true) {
    return fail('Only an active member of this organization can bind a cash account', 'FORBIDDEN', 403);
  }

  // The float must be this org's own, and live.
  const { data: float } = await sc.from('imprest_floats').select('id').eq('id', body.floatId).eq('org_id', profile.org_id)
    .is('archived_at', null).maybeSingle();
  if (!float) return fail('Site float not found', 'NOT_FOUND', 404);

  const { data: binding } = await sc.from('external_org_bindings').select('external_tier, secret_ref, site_url, config')
    .eq('org_id', profile.org_id).not('activated_at', 'is', null).limit(1).maybeSingle();
  if (!binding) return fail('This organization has no active ERP connection', 'NOT_FOUND', 404);
  const validate = VALIDATORS[binding.external_tier as string];
  if (!validate) return fail('This ERP connection cannot bind a cash account yet', 'imprest-cash-account-unsupported', 409);
  if (!binding.site_url || !(await isPermittedErpSiteUrl(binding.site_url))) return fail('ERP site URL is not allowed', 'CONFIG_REJECTED', 422);

  const { data: secret, error: vaultError } = await sc.rpc('read_vault_secret', { p_secret_ref: binding.secret_ref });
  if (vaultError || typeof secret !== 'string' || !secret) return fail('ERP credentials not found', 'CONFIG_REJECTED', 422);

  let fits: boolean;
  try {
    const company = (binding.config as { company?: unknown } | null)?.company;
    fits = await validate({ fetchImpl: guardedErpFetch(binding.site_url), siteUrl: binding.site_url, secret,
      company: typeof company === 'string' ? company : null, account });
  } catch (err) {
    if (err instanceof AppError && err.code === 'config-rejected') return fail(err.message, 'CONFIG_REJECTED', 422);
    return fail('Could not check the account in the ERP', 'external-unreachable', 502);
  }
  if (!fits) return fail('That account is not a cash account of the connected company that can take site cash', 'imprest-cash-account-unfit', 422);

  const { error: writeError } = await sc.from('imprest_floats').update({ erp_cash_account_ref: account })
    .eq('id', body.floatId).eq('org_id', profile.org_id);
  if (writeError) return fail('Failed to save the cash account', 'INTERNAL', 500);
  const { error: auditError } = await sc.rpc('log_audit', {
    p_action: 'imprest_float.cash_account', p_org_id: profile.org_id, p_actor_id: userId, p_entity_id: body.floatId,
    p_detail: { account, tier: binding.external_tier },
  });
  if (auditError) console.error('log_audit failed', auditError);
  return json({ ok: true, floatId: body.floatId, account });
}

if (import.meta.main) {
  serveWithErrorReporting('imprest-cash-account', handleImprestCashAccountRequest);
}
