// auth.ts — PURE authz helpers for m365-token-custody handlers (ADR-0039 Node-testable pattern).
//
// This module holds ONLY pure logic: CORS header construction and the data-access gate. It does NOT
// verify the JWT (index.ts does that via verifyCallerJwt and passes the verified `userId` into
// HandlerDeps), does NOT read Deno.env, and does NOT construct a Supabase client — the caller-JWT
// client is injected. Importable in Vitest with a mock client.

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
 * DATA-ACCESS gate (FR-M365SEP-001/002) — authorizes the caller as an ACTIVE MEMBER of an ENTITLED
 * org, and consults ONLY the caller-JWT client. It takes NO serviceClient parameter: that absence is
 * itself the structural guarantee it cannot reach `platform_operators` (FR-M365SEP-001). Three
 * independently-failing assertions, each with its own typed error (FR-M365SEP-002):
 *   - profile missing/unreadable → BAD_REQUEST (org not resolvable; AC-M365SEP-011)
 *   - caller not an active member → DISABLED_MEMBER (AC-M365SEP-003; NFR-M365SEP-002)
 *   - org lacks the entitlement → NOT_ENTITLED (AC-M365SEP-005)
 * Returns { orgId, role } on success.
 *
 * NFR-M365SEP-002 (active membership is enforced EXPLICITLY). The `status !== 'active'` check below
 * is read from `profiles` directly. It is NOT inherited from `org_features`' RLS policy:
 * `profiles_select` (0002_rls.sql:32) carries NO status predicate, so a disabled caller reads their
 * own row fine; today's protection would be an accident of `org_features_select`'s policy
 * (`0070_org_features.sql:32` includes `is_active_member()`), and moving that read to the service
 * client — as was done for `platform_operators` — would silently un-protect disabled users. The
 * explicit check makes the disabled-user criterion fail on its own, regardless of the entitlement
 * read. `banned_until` is the DB half of the membership rule and is covered at the DB layer
 * (AC-M365SEP-004, pgTAP 0178) — `is_active_member()` conjoins it into the org_features read.
 *
 * Per FR-M365SEP-011, an active member of an entitled org is authorized irrespective of PMO role or
 * Operator status. The Operator-only activation question (may this actor toggle m365_integration?)
 * is a SEPARATE decision owned by `org_features_write` RLS + `operator_toggle_feature`; the two may
 * share code but never one decision (NFR-M365SEP-001).
 */
export async function authorizeMemberEntitled(deps: {
  callerClient: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, userId } = deps;

  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id, role, status')
    .eq('id', userId)
    .single();

  if (profileError || !profile) {
    throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
  }
  const { org_id: orgId, role, status } = profile as { org_id: string; role: string; status: string };

  // EXPLICIT active-member assertion (NFR-M365SEP-002). NOT inherited from org_features' RLS:
  // profiles_select (0002_rls.sql:32) carries no status predicate, so a disabled caller reads this
  // row fine. banned_until is covered at the DB layer (AC-M365SEP-004, pgTAP).
  if (status !== 'active') {
    throw new M365HandlerError('DISABLED_MEMBER', 'account access has been disabled');
  }

  const { data: feature, error: featureError } = await callerClient
    .from('org_features')
    .select('enabled')
    .eq('org_id', orgId)
    .eq('feature_key', entitlement)
    .single();

  if (featureError || (feature as { enabled?: boolean } | null)?.enabled !== true) {
    throw new M365HandlerError('NOT_ENTITLED', 'organization not entitled for this integration');
  }

  return { orgId, role };
}

/**
 * Resolve the caller's org via `authorizeMemberEntitled`, mapping any gate failure to its typed
 * HandlerResult. Shared by initiate_connect / graph_proxy / disconnect / connection_status (DRY —
 * those four handlers run the identical authorize-or-return-error DATA-ACCESS gate). Returns the
 * orgId on success, or a HandlerResult (500 INTERNAL_ERROR if the caller client is missing, or the
 * mapped gate error) for the handler to return verbatim. Rethrows non-M365HandlerError throws
 * unchanged.
 *
 * NFR-M365SEP-001: this is the DATA-ACCESS decision ("may this actor USE this org's connection?"),
 * distinct from the ACTIVATION decision ("may this actor perform a platform/org-level action?") that
 * step 2 (org approval) and entitlement toggling own. The two gates may share code; they shall not
 * share one decision. All four step-3 actions inherit this with no handler edits.
 */
export async function resolveOrgOrResult(deps: HandlerDeps): Promise<string | HandlerResult> {
  if (!deps.callerClient) {
    return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'caller client missing' } };
  }
  try {
    const { orgId } = await authorizeMemberEntitled({
      callerClient: deps.callerClient,
      userId: deps.userId,
    });
    return orgId;
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }
}
