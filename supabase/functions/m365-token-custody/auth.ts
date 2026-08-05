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
export type M365MembershipState = 'missing' | 'active' | 'disabled' | 'banned';

export interface M365Membership {
  state: M365MembershipState;
  orgId: string | null;
  role: string | null;
}

/**
 * Read membership state through the service-side actor-aware RPC. The caller-JWT profiles read
 * cannot classify disabled or raw-banned members because profiles_select is intentionally conjoined
 * with is_active_member() by 0063. This RPC is service-role-only and returns no secrets.
 */
export async function readM365MembershipState(
  serviceClient: M365SupabaseLike,
  userId: string,
): Promise<M365Membership> {
  const { data, error } = await serviceClient.rpc('m365_membership_state', { p_user_id: userId });
  if (error || !data || typeof data !== 'object') {
    return { state: 'missing', orgId: null, role: null };
  }
  const row = data as { state?: unknown; org_id?: unknown; role?: unknown };
  const state = row.state;
  if (state !== 'active' && state !== 'disabled' && state !== 'banned' && state !== 'missing') {
    return { state: 'missing', orgId: null, role: null };
  }
  return {
    state,
    orgId: typeof row.org_id === 'string' ? row.org_id : null,
    role: typeof row.role === 'string' ? row.role : null,
  };
}

export async function authorizeMemberEntitled(deps: {
  callerClient: M365SupabaseLike;
  serviceClient?: M365SupabaseLike;
  userId: string;
  requiredEntitlement?: string;
}): Promise<{ orgId: string; role: string }> {
  const entitlement = deps.requiredEntitlement ?? 'm365_integration';
  const { callerClient, userId } = deps;

  // Production always supplies serviceClient. The caller-only fallback preserves the pure helper's
  // legacy unit seam; resolveOrgOrResult below never takes this branch.
  let orgId: string;
  let role: string;
  if (deps.serviceClient) {
    const membership = await readM365MembershipState(deps.serviceClient, userId);
    if (membership.state === 'missing' || !membership.orgId || !membership.role) {
      throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
    }
    if (membership.state === 'disabled') {
      throw new M365HandlerError('DISABLED_MEMBER', 'account access has been disabled');
    }
    if (membership.state === 'banned') {
      throw new M365HandlerError('BANNED_MEMBER', 'account access is suspended');
    }
    orgId = membership.orgId;
    role = membership.role;
  } else {
    const { data: profile, error: profileError } = await callerClient
      .from('profiles')
      .select('org_id, role, status')
      .eq('id', userId)
      .single();

    if (profileError || !profile) {
      throw new M365HandlerError('BAD_REQUEST', 'org not resolvable for caller');
    }
    const profileRow = profile as { org_id: string; role: string; status: string };
    if (profileRow.status !== 'active') {
      throw new M365HandlerError('DISABLED_MEMBER', 'account access has been disabled');
    }
    orgId = profileRow.org_id;
    role = profileRow.role;
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
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
    return orgId;
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }
}
