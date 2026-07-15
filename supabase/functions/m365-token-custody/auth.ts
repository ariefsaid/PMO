// auth.ts — PURE authz helpers for m365-token-custody handlers (ADR-0039 Node-testable pattern).
//
// This module holds ONLY pure logic: CORS header construction and the org-resolution + Admin +
// entitlement gates. It does NOT verify the JWT (index.ts does that via verifyCallerJwt and passes
// the verified `userId` into HandlerDeps), does NOT read Deno.env, and does NOT construct a
// Supabase client — the caller-JWT client is injected. Importable in Vitest with a mock client.

import type { M365SupabaseLike } from './types.ts';
import { M365HandlerError } from './types.ts';

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
 *   - role !== 'Admin' → FORBIDDEN (AC-M365-131 — real JWT role, not impersonated; ADR-0016)
 *   - entitlement off/missing → NOT_ENTITLED (AC-M365-132 — Operator switch, ADR-0049)
 * Returns { orgId, role } on success (AC-M365-130 — org resolution under caller JWT).
 */
export async function authorizeAdminEntitled(deps: {
  callerClient: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, userId } = deps;

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

  if (role !== 'Admin') {
    throw new M365HandlerError('FORBIDDEN', 'Admin role required');
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
