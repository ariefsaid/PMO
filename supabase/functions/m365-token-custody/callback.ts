// callback.ts — `GET /callback` handler: Microsoft redirects here with ?code=&state= (or ?error=).
// Consumes the single-use PKCE state, exchanges the code for tokens, encrypts BOTH tokens, upserts
// the connection, audits, and redirects to the FE. A pure function taking INJECTED deps
// (ADR-0039). No Deno.env, no client construction, no JWT (the consumed state row is the credential
// — a 302 from Microsoft carries no Bearer header; state is single-use + user/org-bound).

import type { HandlerDeps, HandlerResult, M365SupabaseLike } from './types.ts';
import { M365_IDENTITY_MISMATCH } from './types.ts';
import { consumePkceState } from './stateStore.ts';
import { encryptToken, serializeEnvelope, resolveKek, base64UrlDecode, toByteaParam } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import { isValidTenant } from '../../../pmo-portal/src/lib/m365/graphPkce.ts';

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com';

/**
 * AC-M365-103/104/105: the OAuth callback. Flow:
 *   - Microsoft error param (user denied consent) → error_event + FE error redirect, no exchange.
 *   - missing code/state → FE error redirect.
 *   - state missing/expired/replayed (consume returns null) → INVALID_STATE error_event + FE error
 *     redirect, NO token exchange (AC-M365-104/142 — single-use).
 *   - token exchange failure (e.g. invalid_grant) → TOKEN_EXCHANGE_FAILED error_event, NO partial
 *     store, FE error redirect (AC-M365-105). Only the sanitized Microsoft error code is logged.
 *   - success → encrypt both tokens, upsert connection (unique org_id,user_id), audit
 *     `m365.connection.initiated`, FE success redirect (no token in the URL — AC-M365-140).
 */
export async function handleCallback(req: Request, deps: HandlerDeps): Promise<HandlerResult> {
  const { env, serviceClient, now } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const nowFn = now ?? (() => new Date());

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const msError = url.searchParams.get('error');

  if (msError) {
    await recordM365Error(serviceClient, {
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      contextId: state ?? undefined,
    });
    return redirectToFeError(env, 'Connection failed: access denied');
  }

  if (!code || !state) {
    return redirectToFeError(env, 'Missing code or state');
  }

  // Single-use, user/org-bound state is the credential on this GET path (no Bearer available).
  const pkce = await consumePkceState(serviceClient, state, nowFn);
  if (!pkce) {
    await recordM365Error(serviceClient, { errorCode: 'INVALID_STATE', contextId: state });
    return redirectToFeError(env, 'Invalid or expired state. Please try connecting again.');
  }

  // M3 (Luna): re-validate the env tenant BEFORE building the token URL. The host is pinned, so a
  // bad tenant is path-confusion rather than arbitrary-host SSRF — but this POST carries the
  // confidential client_secret + the auth code, so the defense-in-depth check runs at every URL
  // construction site. A misconfigured tenant is surfaced as a clear error_event + FE redirect.
  if (!isValidTenant(env.m365TenantId)) {
    await recordM365Error(serviceClient, { errorCode: 'TOKEN_EXCHANGE_FAILED', contextId: state });
    return redirectToFeError(env, 'Connection failed: tenant misconfigured. Please contact support.');
  }

  // Exchange the auth code for tokens (confidential client + PKCE verifier).
  const tokenRes = await fetchImpl(`${TOKEN_ENDPOINT}/${env.m365TenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: pkce.codeVerifier,
      client_id: env.m365ClientId,
      client_secret: env.m365ClientSecret,
      redirect_uri: env.m365RedirectUri,
    }),
  });

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;

  if (!tokenRes.ok) {
    // AC-M365-140: log ONLY the sanitized Microsoft error code — never the code/verifier/secret.
    const sanitizedError = typeof tokenData.error === 'string' ? tokenData.error : 'UNKNOWN';
    console.error('[m365-token-custody] token exchange failed', { error: sanitizedError });
    await recordM365Error(serviceClient, {
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      contextId: state,
      orgId: pkce.orgId,
    });
    return redirectToFeError(env, 'Connection failed. Please try again.');
  }

  // HIGH-1: bind the issued tokens to the expected tenant/user. Microsoft returns an id_token
  // (because the initiate scopes include openid+profile); decode its JWT payload (NO signature
  // verification — it arrives over direct server→Microsoft TLS in the token response) and ASSERT
  // its `tid` === env.m365TenantId BEFORE any encrypt/upsert. This blocks the consent-phishing /
  // OAuth-code-injection path where an attacker harvests a victim's tokens into the attacker's
  // connection: a foreign tenant's id_token is rejected here and nothing is stored.
  //
  // NOTE: env.m365TenantId MUST be a concrete tenant GUID for Phase-1 Option C single-tenant
  // (ADR-0059). 'common'/'organizations' is unsupported here — the assertion correctly rejects the
  // foreign tid those flows would issue. The REAL token tid is stored as entra_tenant_id (not the
  // env value) and the oid as entra_user_object_id (also fixes spec Minor: oid was never populated,
  // FR-M365-110).
  const claims = parseIdTokenClaims(tokenData.id_token);
  if (!claims || claims.tid !== env.m365TenantId) {
    console.error('[m365-token-custody] id_token tenant mismatch / missing id_token', {
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      hasIdToken: typeof tokenData.id_token === 'string',
    });
    await recordM365Error(serviceClient, {
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      contextId: state,
      orgId: pkce.orgId,
    });
    return redirectToFeError(env, 'Connection failed: tenant mismatch. Please try again.');
  }

  // TOFU + enforce-on-reconnect (owner design decision, 2026-07-17): bind the Microsoft USER
  // identity, not just the tenant. The FIRST connect for (org, user) — no row, OR a row whose
  // entra_user_object_id IS NULL — is ACCEPTED and the id_token's `oid` is PINNED as
  // entra_user_object_id (trust-on-first-use). Every RECONNECT (an existing row with a NON-NULL
  // entra_user_object_id) MUST present the SAME `oid`; a mismatch is a same-tenant consent-phishing
  // indicator — a PMO Admin phished the authorize URL to a DIFFERENT person in the SAME Entra
  // tenant (tid matches, so the tenant check above passes, but the victim's oid differs from the
  // pinned value). On mismatch: reject BEFORE any encrypt/upsert — no token stored, a sanitized
  // M365_IDENTITY_MISMATCH error_event, an m365.connection.identity_mismatch audit row (forensic
  // trail), and a generic FE redirect (no raw oid).
  //
  // RESIDUAL RISK (documented, not solved here): the FIRST connect is still phishable within the
  // tenant — an attacker who initiates AND completes the first connect themselves can still harvest
  // their own victim's tokens once. TOFU bounds that exposure to exactly one event; every
  // subsequent reconnect is pinned. (SSO-identity binding was explicitly NOT taken — it would
  // break connect for email/password PMO users who have no SSO principal to bind.)
  //
  // This SELECT is best-effort (TOCTOU by nature); the m365_connection_oid_write_once BEFORE
  // UPDATE trigger (0117) is the STRUCTURAL AUTHORITY — it makes identity re-binding IMPOSSIBLE
  // even if this check is bypassed or a future code path forgets it. The upsertError branch below
  // sniffs for the trigger's identity_rebind_forbidden message so the (narrow) race surfaces as the
  // same M365_IDENTITY_MISMATCH outcome rather than CONNECTION_NOT_ALLOWED.
  const { data: existingConn } = await serviceClient.from('ms_graph_connections')
    .select('id,entra_user_object_id')
    .eq('org_id', pkce.orgId)
    .eq('user_id', pkce.userId)
    .maybeSingle();
  const existingRow = existingConn as { id?: string; entra_user_object_id?: string | null } | null;
  const pinnedOid = existingRow?.entra_user_object_id ?? null;
  if (pinnedOid !== null && pinnedOid !== claims.oid) {
    return rejectIdentityMismatch(serviceClient, env, state, {
      orgId: pkce.orgId,
      userId: pkce.userId,
      entraTenantId: claims.tid,
      storedOid: pinnedOid,
      presentedOid: claims.oid,
      existingConnectionId: existingRow?.id,
    });
  }

  // C1(c) (Luna): the BEFORE INSERT OR UPDATE trigger (0113) is the AUTHORITY that makes token
  // resurrection structurally impossible — if the user was disabled or the org disentitled between
  // initiate and callback, the upsert is REJECTED with errcode 42501. This best-effort pre-check
  // gives a CLEARER error_event + user message before the encrypt/upsert round-trip; it is
  // TOCTOU by nature, so the upsertError branch below remains the authoritative backstop. No
  // client JWT is available on this GET path, so the reads go through the service client (RLS-free
  // but exact — the trigger re-checks authoritatively at write time).
  const { data: profRow } = await serviceClient.from('profiles').select('status')
    .eq('id', pkce.userId).maybeSingle();
  const { data: featRow } = await serviceClient.from('org_features').select('enabled')
    .eq('org_id', pkce.orgId).eq('feature_key', 'm365_integration').maybeSingle();
  const profileActive = (profRow as { status?: string } | null)?.status === 'active';
  const entitled = (featRow as { enabled?: boolean } | null)?.enabled === true;
  if (!profileActive || !entitled) {
    await recordM365Error(serviceClient, {
      errorCode: 'CONNECTION_NOT_ALLOWED',
      contextId: state,
      orgId: pkce.orgId,
    });
    return redirectToFeError(env, 'This connection is no longer allowed. Please contact your administrator.');
  }

  // Encrypt BOTH tokens at rest (ADR-0060 §3). No partial store on any failure below this point.
  const kek = resolveKek(env, 'kek-v1');
  const accessEnvelope = await encryptToken(String(tokenData.access_token), kek);
  const refreshEnvelope = await encryptToken(String(tokenData.refresh_token), kek);
  const accessBlob = serializeEnvelope(accessEnvelope.iv, accessEnvelope.ciphertext);
  const refreshBlob = serializeEnvelope(refreshEnvelope.iv, refreshEnvelope.ciphertext);

  const nowIso = nowFn().toISOString();
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
  const accessExpiresAt = new Date(nowFn().getTime() + expiresIn * 1000).toISOString();

  // C1(c) (Luna) + DEADLOCK closure (Luna round-3): the write goes through the
  // m365_upsert_connection SECURITY-DEFINER RPC, which locks PROFILES → ORG_FEATURES for update
  // BEFORE the connection upsert — the single global lock order (see 0115 file header). The BEFORE
  // write-guard (0113) is still the AUTHORITY: if the user was disabled / the org disentitled
  // mid-flight, the guard raises 42501 and the RPC propagates it (upsertError set). This best-
  // effort pre-check above gives a CLEARER error_event + user message before the encrypt/round-trip;
  // it is TOCTOU by nature, so the upsertError branch below remains the authoritative backstop. No
  // client JWT is available on this GET path, so the pre-check reads go through the service client.
  const { data: connId, error: upsertError } = await serviceClient.rpc('m365_upsert_connection', {
    p_org_id: pkce.orgId,
    p_user_id: pkce.userId,
    p_entra_tenant_id: claims.tid,
    p_entra_user_object_id: claims.oid,
    p_scopes: pkce.scopes,
    p_refresh_token_ciphertext: toByteaParam(refreshBlob),
    p_access_token_ciphertext: toByteaParam(accessBlob),
    p_access_token_expires_at: accessExpiresAt,
    p_key_id: 'kek-v1',
    p_connected_at: nowIso,
    p_last_refresh_at: nowIso,
  });

  if (upsertError || !connId) {
    // RACE (TOFU): a concurrent callback pinned a DIFFERENT oid between the identity pre-check
    // above and this upsert; the m365_connection_oid_write_once BEFORE UPDATE trigger (0117)
    // rejected the rebind (identity_rebind_forbidden, 42501). Surface it as the SAME identity-
    // mismatch outcome (M365_IDENTITY_MISMATCH + audit + generic redirect) so the security event is
    // greppable/auditable regardless of which path caught it. The stored oid is unknown under the
    // TOCTOU window (the concurrently-committed value is not reliably visible here) — the audit row
    // records the presented oid + tenant + the 'race' reason. Any OTHER upsertError (the C1(c)
    // write-guard: user_not_active / org_not_entitled) stays CONNECTION_NOT_ALLOWED.
    const upsertErrMsg = String((upsertError as { message?: string } | null)?.message ?? '');
    if (upsertErrMsg.includes('identity_rebind')) {
      return rejectIdentityMismatch(serviceClient, env, state, {
        orgId: pkce.orgId,
        userId: pkce.userId,
        entraTenantId: claims.tid,
        storedOid: 'unknown_pinned_by_concurrent_connect',
        presentedOid: claims.oid,
        existingConnectionId: undefined,
        reason: 'race',
      });
    }
    // C1(c) (Luna): the write-guard trigger rejected the upsert — the user was disabled / the org
    // disentitled mid-flight (or a race flipped state between the pre-check above and here). NEVER
    // reported as success: emit a token-free error_event and redirect to the FE error page. The
    // encrypted blobs are local variables only — nothing is persisted on this path.
    await recordM365Error(serviceClient, {
      errorCode: 'CONNECTION_NOT_ALLOWED',
      contextId: state,
      orgId: pkce.orgId,
    });
    return redirectToFeError(env, 'This connection is no longer allowed. Please contact your administrator.');
  }

  await logAudit(serviceClient, {
    action: 'm365.connection.initiated',
    orgId: pkce.orgId,
    actorId: pkce.userId,
    entityId: connId as string,
    detail: { scopes: pkce.scopes, entra_tenant_id: claims.tid },
  });

  return redirectToFeSuccess(env);
}

/**
 * Parse the id_token JWT payload (middle base64url segment) and return the `tid` + `oid` claims.
 * NO signature verification — the id_token is extracted from Microsoft's direct server→server TLS
 * token response (not a browser channel), so the transport is the integrity boundary (HIGH-1).
 * Returns null if the token is absent/malformed or either claim is missing (caller treats that as a
 * tenant mismatch → reject, store nothing).
 */
function parseIdTokenClaims(idToken: unknown): { tid: string; oid: string } | null {
  if (typeof idToken !== 'string' || idToken.length === 0) return null;
  const segments = idToken.split('.');
  if (segments.length < 2) return null;
  try {
    const json = JSON.parse(new TextDecoder().decode(base64UrlDecode(segments[1]!))) as Record<string, unknown>;
    const tid = typeof json.tid === 'string' ? json.tid : '';
    const oid = typeof json.oid === 'string' ? json.oid : '';
    if (!tid || !oid) return null;
    return { tid, oid };
  } catch {
    return null;
  }
}

/**
 * TOFU / enforce-on-reconnect mismatch path (owner decision, 2026-07-17): the presented id_token
 * `oid` differs from the PINNED `entra_user_object_id`. Emit a SANITIZED error_event (NO token
 * material, NO raw oid — just the M365_IDENTITY_MISMATCH code + state context), a forensic
 * audit_events row (m365.connection.identity_mismatch — oids are public Microsoft identifiers, not
 * secrets; recording stored vs presented is the point of the trail), and a GENERIC FE redirect
 * whose message carries NO oid and NO token (AC-M365-140/173). No upsert is attempted.
 */
async function rejectIdentityMismatch(
  serviceClient: M365SupabaseLike,
  env: { siteUrl: string },
  state: string,
  detail: {
    orgId: string;
    userId: string;
    entraTenantId: string;
    storedOid: string;
    presentedOid: string;
    existingConnectionId?: string;
    reason?: string;
  },
): Promise<HandlerResult> {
  // Sanitized error_event: code + context only. NO token material, NO raw oid.
  await recordM365Error(serviceClient, {
    errorCode: M365_IDENTITY_MISMATCH,
    contextId: state,
    orgId: detail.orgId,
  });
  // Forensic audit trail (server-side). oids are public Microsoft identifiers (already stored in
  // the DB) — safe + valuable for incident response. NO token material. entityId = the existing
  // pinned connection when known (ties the event to the connection row); a null-uuid sentinel when
  // the mismatch was caught in the upsert race (no connection id in hand).
  await logAudit(serviceClient, {
    action: 'm365.connection.identity_mismatch',
    orgId: detail.orgId,
    actorId: detail.userId,
    entityId: detail.existingConnectionId ?? '00000000-0000-0000-0000-000000000000',
    detail: {
      entra_tenant_id: detail.entraTenantId,
      stored_entra_user_object_id: detail.storedOid,
      presented_entra_user_object_id: detail.presentedOid,
      reason: detail.reason ?? 'identity_mismatch',
    },
  });
  return redirectToFeError(env, 'Connection failed: identity mismatch. Please contact your administrator.');
}

function redirectToFeError(env: { siteUrl: string }, message: string): HandlerResult {
  return {
    status: 302,
    headers: { Location: `${env.siteUrl}/admin/integrations?m365_error=${encodeURIComponent(message)}` },
  };
}

function redirectToFeSuccess(env: { siteUrl: string }): HandlerResult {
  return {
    status: 302,
    headers: { Location: `${env.siteUrl}/admin/integrations?m365_connected=true` },
  };
}
