// callback.ts — `GET /callback` handler: Microsoft redirects here with ?code=&state= (or ?error=).
// Consumes the single-use PKCE state, exchanges the code for tokens, encrypts BOTH tokens, upserts
// the connection, audits, and redirects to the FE. A pure function taking INJECTED deps
// (ADR-0039). No Deno.env, no client construction, no JWT (the consumed state row is the credential
// — a 302 from Microsoft carries no Bearer header; state is single-use + user/org-bound).

import type { HandlerDeps, HandlerResult } from './types.ts';
import { consumePkceState } from './stateStore.ts';
import { encryptToken, serializeEnvelope, resolveKek } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';

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

  // Encrypt BOTH tokens at rest (ADR-0060 §3). No partial store on any failure below this point.
  const kek = resolveKek(env, 'kek-v1');
  const accessEnvelope = await encryptToken(String(tokenData.access_token), kek);
  const refreshEnvelope = await encryptToken(String(tokenData.refresh_token), kek);
  const accessBlob = serializeEnvelope(accessEnvelope.iv, accessEnvelope.ciphertext);
  const refreshBlob = serializeEnvelope(refreshEnvelope.iv, refreshEnvelope.ciphertext);

  const nowIso = nowFn().toISOString();
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;
  const accessExpiresAt = new Date(nowFn().getTime() + expiresIn * 1000).toISOString();

  const { data: conn, error: upsertError } = await serviceClient
    .from('ms_graph_connections')
    .upsert(
      {
        org_id: pkce.orgId,
        user_id: pkce.userId,
        entra_tenant_id: env.m365TenantId,
        scopes: pkce.scopes,
        refresh_token_ciphertext: refreshBlob,
        access_token_ciphertext: accessBlob,
        access_token_expires_at: accessExpiresAt,
        key_id: 'kek-v1',
        status: 'active',
        connected_at: nowIso,
        last_refresh_at: nowIso,
      },
      { onConflict: 'org_id,user_id' },
    )
    .select('id')
    .single();

  if (upsertError || !conn) {
    await recordM365Error(serviceClient, {
      errorCode: 'INTERNAL_ERROR',
      contextId: state,
      orgId: pkce.orgId,
    });
    return redirectToFeError(env, 'Failed to save connection. Please try again.');
  }

  await logAudit(serviceClient, {
    action: 'm365.connection.initiated',
    orgId: pkce.orgId,
    actorId: pkce.userId,
    entityId: (conn as { id: string }).id,
    detail: { scopes: pkce.scopes, entra_tenant_id: env.m365TenantId },
  });

  return redirectToFeSuccess(env);
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
