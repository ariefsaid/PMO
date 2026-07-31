// orgApproval.ts — `initiate_org_approval` handler (step 2): the client admin approves the PMO
// app for their whole Microsoft organisation. Returns Microsoft's admin-consent URL; PERSISTS
// NOTHING (spec §1.5, NFR-M365SEP-005 — Microsoft is the authority on approval; a stored flag
// would drift the moment an admin revokes consent in Entra, the same failure reasoned through for
// linked documents in ADR-0071).
//
// A pure function taking INJECTED deps (ADR-0039): caller-JWT client, service client, resolved env.
// No Deno.env, no client construction. Importable in Vitest with the Supabase clients mocked.

import type { HandlerDeps, HandlerResult, M365SupabaseLike } from './types.ts';
import { M365HandlerError, errorResult } from './types.ts';
import { buildAdminConsentUrl } from './pkce.ts';

/**
 * ACTIVATION gate (FR-M365SEP-004) — Admin-of-org OR platform Operator. This is a DIFFERENT
 * authorization decision from the data-access gate `authorizeMemberEntitled` (NFR-M365SEP-001):
 * step 2 is an org-level administrative act ("may this actor approve the app for this org?"), not a
 * data-access act ("may this actor use this org's connection?"). The two may share code; they shall
 * NOT share one decision. No future refactor may unify them on the grounds of duplication.
 *
 * Mirrors the ADR-0065 gate that ClickUp/ERPNext connect uses (supabase/functions/external-connect/
 * index.ts): the caller's REAL role is read from `profiles` under the CALLER JWT (RLS scopes the
 * read to the caller's own row — defense-in-depth, so the verified identity is the profile read),
 * and `platform_operators` is read SERVICE-side (the `is_operator()` RPC uses auth.uid() which is
 * null under service_role, so a direct table check on the verified userId is the reliable path —
 * the precedent external-connect established). It does NOT consult `org_features`/entitlement: the
 * operator's enablement (step 1) is a separate concern owned by `org_features_write` RLS +
 * `operator_toggle_feature`.
 *
 * NOTE: this gate is deliberately its own function, NOT a branch of `authorizeMemberEntitled`. An
 * activation gate and a data-access gate may share code; they must never share a decision
 * (NFR-M365SEP-001).
 */
async function authorizeAdminOrOperator(deps: {
  callerClient: M365SupabaseLike | undefined;
  serviceClient: M365SupabaseLike;
  userId: string;
}): Promise<void> {
  const { callerClient, serviceClient, userId } = deps;
  if (!callerClient) {
    throw new M365HandlerError('FORBIDDEN', 'caller client missing');
  }

  // Caller's real role from `profiles` under the caller JWT (ADR-0065 precedent).
  const { data: profile, error: profileError } = await callerClient
    .from('profiles')
    .select('org_id, role')
    .eq('id', userId)
    .single();
  if (profileError || !profile) {
    throw new M365HandlerError('FORBIDDEN', 'Admin or Operator role required');
  }
  const role = (profile as { role?: string }).role;

  // Admin-of-org passes (the first arm of the OR).
  if (role === 'Admin') return;

  // Otherwise the caller must be a platform Operator — service-side table check (ADR-0065
  // precedent; `is_operator()` RPC is null under service_role, so a direct check on the verified
  // userId is the reliable path).
  const { data: operator, error: operatorError } = await serviceClient
    .from('platform_operators')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (operatorError || !operator) {
    throw new M365HandlerError('FORBIDDEN', 'Admin or Operator role required');
  }
}

/**
 * AC-M365SEP-013/014 — step 2. Authorize via the Admin-of-org OR Operator gate (FR-M365SEP-004),
 * then return Microsoft's admin-consent URL built from the configured tenant + client id
 * (FR-M365SEP-006 — never caller-supplied, so approve and connect can never disagree about which
 * app is being approved). PERSISTS NOTHING (NFR-M365SEP-005): Microsoft is the authority on org
 * approval; the redirect-back is acknowledged to the user without being stored.
 *
 * Returns `{ status: 200, body: { adminConsentUrl } }` on success, or a typed 403 FORBIDDEN
 * HandlerResult when the caller is neither Admin-of-org nor Operator (AC-M365SEP-014).
 */
export async function handleInitiateOrgApproval(deps: HandlerDeps): Promise<HandlerResult> {
  try {
    await authorizeAdminOrOperator({
      callerClient: deps.callerClient,
      serviceClient: deps.serviceClient,
      userId: deps.userId,
    });
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }

  // FR-M365SEP-006: the consent URL is built from env.m365TenantId + env.m365ClientId ONLY. The
  // handler accepts NO tenant/clientId from the caller — the two can never disagree about which app
  // is being approved. buildAdminConsentUrl re-runs validateTenant on the env value (defense-in-
  // depth — the tenant is interpolated into the URL path).
  const adminConsentUrl = buildAdminConsentUrl({
    tenant: deps.env.m365TenantId,
    clientId: deps.env.m365ClientId,
    redirectUri: deps.env.m365RedirectUri,
    // An opaque round-trip token. NOT a validated CSRF token — step 2 stores no state (NFR-M365SEP-
    // 005), so there is nothing to validate it against. It round-trips through Microsoft's redirect
    // back; the callback's existing ?error= path surfaces any approval failure (AC-M365SEP-015).
    state: newOpaqueStateToken(),
  });

  return { status: 200, body: { adminConsentUrl } };
}

/**
 * 128-bit URL-safe opaque token for the admin-consent `state` param. NOT a CSRF token (step 2 stores
 * nothing, so it cannot be validated) — it only round-trips through Microsoft's redirect. Entropy is
 * crypto-sourced (Web Crypto getRandomValues); no clock dependency.
 */
function newOpaqueStateToken(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 43);
}
