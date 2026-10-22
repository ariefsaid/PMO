// refresh.ts — refresh a Microsoft access token using the stored (encrypted) refresh token.
// The "refresh helper" from the Slice-B handler set (ADR-0039): a pure function taking INJECTED
// deps (env, service-client, fetch, clock). Handles token rotation, stale-on-invalid_grant, and
// reuse-detection → revoked (the security event). No Deno.env, no client construction.

import type { ConnectionRow, HandlerDeps } from './types.ts';
import {
  decryptToken,
  encryptToken,
  deserializeEnvelope,
  serializeEnvelope,
  resolveKek,
  toByteaParam,
  fromByteaValue,
} from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import { isValidTenant } from '../../../pmo-portal/src/lib/m365/graphPkce.ts';
import { fetchMicrosoftJson } from './microsoftTransport.ts';
import { grantedScopes, validTokenPair } from './callback.ts';

const TOKEN_ENDPOINT = 'https://login.microsoftonline.com';

/**
 * Refresh the access token for `connection`. On success: encrypts + persists BOTH the new access
 * token and the ROTATED refresh token, updates expires_at/last_refresh_at/status, audits
 * `m365.token.refreshed` (AC-M365-111). On failure classifies the Microsoft error:
 *   - invalid_grant (consented scope revoked / refresh expired) → status=stale, audit
 *     `m365.token.refresh_failed`, error_event REFRESH_FAILED (AC-M365-112).
 *   - reuse indicator → status=revoked, audit `m365.token.reuse_detected`, error_event
 *     SECURITY_EVENT_REUSE (AC-M365-113).
 * Returns true on success, false on any failure (caller surfaces CONNECTION_STALE).
 */
export async function refreshAccessToken(
  connection: ConnectionRow,
  deps: HandlerDeps,
  timeoutMs?: number,
): Promise<boolean> {
  const { env, serviceClient } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const nowFn = deps.now ?? (() => new Date());

  // 1. Decrypt the stored refresh token.
  let refreshToken: string;
  try {
    const kek = resolveKek(env, connection.key_id);
    const envelope = deserializeEnvelope(fromByteaValue(connection.refresh_token_ciphertext));
    refreshToken = await decryptToken(envelope.ciphertext, envelope.iv, kek);
  } catch {
    await recordM365Error(serviceClient, {
      errorCode: 'M365_DECRYPT_FAILED',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return false;
  }

  // 2. Exchange at the Microsoft token endpoint (confidential client).
  // M3 (Luna): re-validate the DB-sourced tenant before URL construction. This POST carries the
  // decrypted refresh_token + client_secret, so the check runs at every construction site. A bad
  // tenant (path-confusion — host is pinned) records an error_event and returns false (no refresh)
  // rather than building a malformed URL. The column CHECK (0113) already rejects such values on
  // write, so this is defense-in-depth for any legacy/tampered row.
  if (!isValidTenant(connection.entra_tenant_id)) {
    await recordM365Error(serviceClient, {
      errorCode: 'M365_REFRESH_UNHANDLED',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return false;
  }
  let tokenRes: Response;
  let tokenData: Record<string, unknown>;
  try {
    const result = await fetchMicrosoftJson(
    fetchImpl,
    `${TOKEN_ENDPOINT}/${connection.entra_tenant_id}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.m365ClientId,
        client_secret: env.m365ClientSecret,
        scope: connection.scopes.join(' '),
      }),
    },
    timeoutMs,
    );
    tokenRes = result.response;
    tokenData = result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? result.data as Record<string, unknown> : {};
  } catch {
    // Transient (deadline/network): record it and report failure WITHOUT classifying the connection —
    // a hung token endpoint says nothing about the refresh token, so it must not be marked revoked.
    await recordM365Error(serviceClient, {
      errorCode: 'TOKEN_EXCHANGE_FAILED',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return false;
  }

  if (!tokenRes.ok) {
    const errorCode = typeof tokenData.error === 'string' ? tokenData.error : 'UNKNOWN';
    // Thread the injected clock so failure-path `updated_at` is deterministic (quality #3).
    await classifyRefreshFailure(serviceClient, connection, errorCode, tokenData, nowFn);
    return false;
  }

  // 3. Success: encrypt + persist the rotated pair (AC-M365-111).
  // A refresh response may keep the existing refresh token (RFC 6749 §6).
  const rotated: Record<string, unknown> = { ...tokenData, refresh_token: tokenData.refresh_token === undefined ? refreshToken : tokenData.refresh_token };
  if (!validTokenPair(rotated)) return false; // mutation-witness:refresh-token-pair
  const newAccessToken = rotated.access_token as string;
  const newRefreshToken = rotated.refresh_token as string;
  const scopes = tokenData.scope === undefined ? connection.scopes : grantedScopes(tokenData.scope, connection.scopes);
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;

  const kek = resolveKek(env, 'kek-v1');
  const accessEnvelope = await encryptToken(newAccessToken, kek);
  const refreshEnvelope = await encryptToken(newRefreshToken, kek);
  const accessBlob = serializeEnvelope(accessEnvelope.iv, accessEnvelope.ciphertext);
  const refreshBlob = serializeEnvelope(refreshEnvelope.iv, refreshEnvelope.ciphertext);

  const nowIso = nowFn().toISOString();
  const accessExpiresAt = new Date(nowFn().getTime() + expiresIn * 1000).toISOString();

  // m365_finish_refresh preserves parent-first lock order and completes only the original active
  // generation. A success audit requires both no RPC error and a returned row id. On a rejected or
  // superseded completion, record a token-free error and surface the typed connection failure.
  const { data: updated, error: persistError } = await serviceClient.rpc('m365_finish_refresh', {
    p_org_id: connection.org_id,
    p_user_id: connection.user_id,
    p_connection_id: connection.id,
    p_expected_refresh_token_ciphertext: toByteaParam(fromByteaValue(connection.refresh_token_ciphertext)),
    p_status: 'active',
    p_scopes: scopes,
    p_updated_at: nowIso,
    p_access_token_ciphertext: toByteaParam(accessBlob),
    p_refresh_token_ciphertext: toByteaParam(refreshBlob),
    p_access_token_expires_at: accessExpiresAt,
  });

  if (persistError || !updated) {
    await recordM365Error(serviceClient, {
      errorCode: 'INTERNAL_ERROR',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return false;
  }

  await logAudit(serviceClient, {
    action: 'm365.token.refreshed',
    orgId: connection.org_id,
    actorId: connection.user_id,
    entityId: connection.id,
    detail: { scopes },
  });

  return true;
}

async function classifyRefreshFailure(
  serviceClient: HandlerDeps['serviceClient'],
  connection: ConnectionRow,
  errorCode: string,
  tokenData: Record<string, unknown>,
  nowFn: () => Date,
): Promise<void> {
  // Uses the injected clock (quality #3) so failure-path `updated_at` is deterministic.
  const nowIso = nowFn().toISOString();

  if (isReuseError(tokenData, errorCode)) {
    // Security event: refresh-token reuse detected → revoke the connection.
    // m365_finish_refresh classifies only the original active generation, with parent-first locks.
    // A Microsoft-reported reuse event is recorded regardless of persistence; a state-change audit
    // requires both no RPC error and a returned row id. Token material is never logged.
    const { data: markedId, error: markError } = await serviceClient.rpc('m365_finish_refresh', {
      p_org_id: connection.org_id,
      p_user_id: connection.user_id,
      p_connection_id: connection.id,
      p_expected_refresh_token_ciphertext: toByteaParam(fromByteaValue(connection.refresh_token_ciphertext)),
      p_status: 'revoked',
      p_updated_at: nowIso,
    });
    // The DETECTION is real (Microsoft reported reuse) — record the security event regardless of
    // whether the row could be marked revoked.
    await recordM365Error(serviceClient, {
      errorCode: 'M365_SECURITY_EVENT_REUSE',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    if (markError || !markedId) {
      // FAIL CLOSED: the row was NOT marked revoked. Surface the persistence failure so it is
      // observable; do NOT emit the reuse_detected state-change audit (that would record a
      // successful revocation that never happened).
      await recordM365Error(serviceClient, {
        errorCode: 'INTERNAL_ERROR',
        contextId: connection.id,
        orgId: connection.org_id,
      });
      return;
    }
    await logAudit(serviceClient, {
      action: 'm365.token.reuse_detected',
      orgId: connection.org_id,
      actorId: connection.user_id,
      entityId: connection.id,
      detail: { error: errorCode },
    });
    return;
  }

  if (isInvalidGrant(errorCode)) {
    // Consent revoked / refresh expired → mark stale so the user reconnects.
    // m365_finish_refresh applies the same generation and parent-first lock contract here.
    // Emit the state-change audit only after a returned row id; otherwise retain the classification
    // as an error event without claiming that the connection state changed.
    const { data: markedId, error: markError } = await serviceClient.rpc('m365_finish_refresh', {
      p_org_id: connection.org_id,
      p_user_id: connection.user_id,
      p_connection_id: connection.id,
      p_expected_refresh_token_ciphertext: toByteaParam(fromByteaValue(connection.refresh_token_ciphertext)),
      p_status: 'stale',
      p_updated_at: nowIso,
    });
    if (markError || !markedId) {
      // Could not mark stale (row gone / mismatched / transient error). The classification is still
      // a fact (Microsoft returned invalid_grant), but do NOT emit the refresh_failed state-change
      // audit for a row that was never marked stale. Surface the persistence failure.
      await recordM365Error(serviceClient, {
        errorCode: 'M365_REFRESH_FAILED',
        contextId: connection.id,
        orgId: connection.org_id,
      });
      await recordM365Error(serviceClient, {
        errorCode: 'INTERNAL_ERROR',
        contextId: connection.id,
        orgId: connection.org_id,
      });
      return;
    }
    await logAudit(serviceClient, {
      action: 'm365.token.refresh_failed',
      orgId: connection.org_id,
      actorId: connection.user_id,
      entityId: connection.id,
      detail: { error: errorCode },
    });
    await recordM365Error(serviceClient, {
      errorCode: 'M365_REFRESH_FAILED',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return;
  }

  // LOW-4: an unhandled refresh failure (e.g. invalid_client from a rotated client_secret, or
  // UNKNOWN / temporarily_unavailable) previously fell through doing nothing — leaving the row
  // silently 'active' with no signal (an ops blind spot). Record an error_event so the failure is
  // observable. The row intentionally stays 'active' so a transient blip self-heals on retry; only
  // a PERSISTENT config failure stays visible here.
  await recordM365Error(serviceClient, {
    errorCode: 'M365_REFRESH_UNHANDLED',
    contextId: connection.id,
    orgId: connection.org_id,
  });
}

function isInvalidGrant(errorCode: string): boolean {
  return errorCode === 'invalid_grant' || errorCode === 'token_revoked' || errorCode === 'expired_token';
}

/**
 * Microsoft surfaces refresh-token reuse (a signal the token was replayed elsewhere) as an
 * invalid_grant whose error_description mentions "reuse". Conservative Phase-1 detection: any
 * invalid_grant carrying that marker → revoke. A later phase can hash the last-used refresh token
 * for precise detection.
 */
function isReuseError(tokenData: Record<string, unknown>, errorCode: string): boolean {
  if (errorCode !== 'invalid_grant') return false;
  const desc = typeof tokenData.error_description === 'string' ? tokenData.error_description : '';
  return desc.includes('reuse');
}
