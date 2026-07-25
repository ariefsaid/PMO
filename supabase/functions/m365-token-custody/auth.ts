// auth.ts — PURE authz helpers for m365-token-custody handlers (ADR-0039 Node-testable pattern).
//
// This module holds ONLY pure logic: CORS header construction and the org-resolution + Admin +
// entitlement gates. It does NOT verify the JWT (index.ts does that via verifyCallerJwt and passes
// the verified `userId` into HandlerDeps), does NOT read Deno.env, and does NOT construct a
// Supabase client — the caller-JWT client is injected. Importable in Vitest with a mock client.

import type { M365SupabaseLike, HandlerDeps, HandlerResult } from './types.ts';
import { M365HandlerError, errorResult } from './types.ts';

/** CORS headers, origin-narrowed by index.ts from env (never '*' — mirrors compose-view/agent-chat). */
export function corsHeaders(allowedOrigin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

/**
 * Org resolution + Admin gate + entitlement gate, run under the injected caller-JWT client (RLS-
 * scoped deputy auth, mirrors adapter-dispatch/compose-view). Throws M365HandlerError on any gate
 * failure so the calling handler can map it to a typed result:
 *   - profile missing → BAD_REQUEST (org not resolvable)
 *   - caller not a platform Operator → FORBIDDEN (AC-M365-131; ADR-0058 §3 amendment 2026-07-24)
 *   - entitlement off/missing → NOT_ENTITLED (AC-M365-132 — Operator switch, ADR-0049)
 * Returns { orgId, role } on success (AC-M365-130 — org resolution under caller JWT).
 */
export async function authorizeOperatorEntitled(deps: {
  callerClient: M365SupabaseLike;
  /** service-role client — `platform_operators` is a platform table with no caller-readable policy,
   *  so the Operator check MUST run service-side (same pattern as external-connect). */
  serviceClient: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, serviceClient, userId } = deps;

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
  }
  const orgId = (profile as { org_id: string; role: string }).org_id;
  const role = (profile as { org_id: string; role: string }).role;

  // Operator gate (ADR-0058 §3 amendment, 2026-07-24). NOT the org-Admin gate the other
  // integrations use: the Entra app registration lives in the VENDOR tenant (ADR-0059 Option C),
  // so connecting it is a platform action, not a client opt-in. ClickUp/ERPNext keep the
  // Admin-or-Operator gate because the client supplies those credentials themselves.
  // `userId` comes from verifyCallerJwt, so this is the real caller — impersonation cannot
  // reach it (ADR-0016). Read service-side: `platform_operators` has no caller-readable policy.
  const { data: operatorRow } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!operatorRow) {
    throw new M365HandlerError('FORBIDDEN', 'Operator role required');
  }

  const { data: feature, error: featureError } = await callerClient
    .from('org_features')
    .select('enabled')
    .eq('org_id', orgId)
    .eq('feature_key', entitlement)
    .single();

  const entitled = !featureError && (feature as { enabled?: boolean } | null)?.enabled === true;
  if (!entitled) {
    throw new M365HandlerError('NOT_ENTITLED', 'organization not entitled for this integration');
  }

  return { orgId, role };
}

/**
 * Resolve the caller's org via authorizeOperatorEntitled, mapping any gate failure to its typed
 * HandlerResult. Shared by initiate_connect / graph_proxy / disconnect (DRY — those three handlers
 * run the identical authorize-or-return-error gate, quality #6). Returns the orgId on success, or a
 * HandlerResult (500 INTERNAL_ERROR if the caller client is missing, or the mapped gate error) for
 * the handler to return verbatim. Rethrows non-M365HandlerError throws unchanged.
 */
export async function resolveOrgOrResult(deps: HandlerDeps): Promise<string | HandlerResult> {
  if (!deps.callerClient) {
    return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'caller client missing' } };
  }
  try {
    const { orgId } = await authorizeOperatorEntitled({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
    return orgId;
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }
}
