// refresh.ts — refresh a Microsoft access token using the stored (encrypted) refresh token.
// The "refresh helper" from the Slice-B handler set (ADR-0039): a pure function taking INJECTED
// deps (env, service-client, fetch, clock). Handles token rotation, stale-on-invalid_grant, and
// reuse-detection → revoked (the security event). No Deno.env, no client construction.

import type { ConnectionRow, HandlerDeps } from './types.ts';
import { decryptToken, encryptToken, deserializeEnvelope, serializeEnvelope, resolveKek } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import { isValidTenant } from '../../../pmo-portal/src/lib/m365/graphPkce.ts';

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
): Promise<boolean> {
  const { env, serviceClient } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const nowFn = deps.now ?? (() => new Date());

  // 1. Decrypt the stored refresh token.
  let refreshToken: string;
  try {
    const kek = resolveKek(env, connection.key_id);
    const envelope = deserializeEnvelope(connection.refresh_token_ciphertext);
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
  // rather than building a malformed URL. The column CHECK (0103) already rejects such values on
  // write, so this is defense-in-depth for any legacy/tampered row.
  if (!isValidTenant(connection.entra_tenant_id)) {
    await recordM365Error(serviceClient, {
      errorCode: 'M365_REFRESH_UNHANDLED',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return false;
  }
  const tokenRes = await fetchImpl(
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
  );

  const tokenData = (await tokenRes.json()) as Record<string, unknown>;

  if (!tokenRes.ok) {
    const errorCode = typeof tokenData.error === 'string' ? tokenData.error : 'UNKNOWN';
    // Thread the injected clock so failure-path `updated_at` is deterministic (quality #3).
    await classifyRefreshFailure(serviceClient, connection, errorCode, tokenData, nowFn);
    return false;
  }

  // 3. Success: encrypt + persist the rotated pair (AC-M365-111).
  const newAccessToken = String(tokenData.access_token);
  const newRefreshToken = String(tokenData.refresh_token); // rotated
  const expiresIn = typeof tokenData.expires_in === 'number' ? tokenData.expires_in : 3600;

  const kek = resolveKek(env, 'kek-v1');
  const accessEnvelope = await encryptToken(newAccessToken, kek);
  const refreshEnvelope = await encryptToken(newRefreshToken, kek);
  const accessBlob = serializeEnvelope(accessEnvelope.iv, accessEnvelope.ciphertext);
  const refreshBlob = serializeEnvelope(refreshEnvelope.iv, refreshEnvelope.ciphertext);

  const nowIso = nowFn().toISOString();
  const accessExpiresAt = new Date(nowFn().getTime() + expiresIn * 1000).toISOString();

  await serviceClient
    .from('ms_graph_connections')
    .update({
      access_token_ciphertext: accessBlob,
      refresh_token_ciphertext: refreshBlob,
      access_token_expires_at: accessExpiresAt,
      last_refresh_at: nowIso,
      status: 'active',
      updated_at: nowIso,
    })
    .eq('id', connection.id);

  await logAudit(serviceClient, {
    action: 'm365.token.refreshed',
    orgId: connection.org_id,
    actorId: connection.user_id,
    entityId: connection.id,
    detail: { scopes: connection.scopes },
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
    await serviceClient
      .from('ms_graph_connections')
      .update({ status: 'revoked', updated_at: nowIso })
      .eq('id', connection.id);
    await logAudit(serviceClient, {
      action: 'm365.token.reuse_detected',
      orgId: connection.org_id,
      actorId: connection.user_id,
      entityId: connection.id,
      detail: { error: errorCode },
    });
    await recordM365Error(serviceClient, {
      errorCode: 'M365_SECURITY_EVENT_REUSE',
      contextId: connection.id,
      orgId: connection.org_id,
    });
    return;
  }

  if (isInvalidGrant(errorCode)) {
    // Consent revoked / refresh expired → mark stale so the user reconnects.
    await serviceClient
      .from('ms_graph_connections')
      .update({ status: 'stale', updated_at: nowIso })
      .eq('id', connection.id);
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
