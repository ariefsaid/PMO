// revoke.ts — `disconnect` handler: best-effort Microsoft revoke, then delete the local connection
// row and audit. A pure function taking INJECTED deps (ADR-0039). No Deno.env, no client construction.

import type { HandlerDeps, HandlerResult, ConnectionRow } from './types.ts';
import { resolveOrgOrResult } from './auth.ts';
import { decryptToken, deserializeEnvelope, resolveKek } from './crypto.ts';
import { logAudit } from './audit.ts';

const REVOKE_ENDPOINT = 'https://login.microsoftonline.com';

/**
 * AC-M365-120: explicit disconnect. Flow:
 *   1. authorize (Admin + entitled) → orgId.
 *   2. load the caller's connection; NOT_CONNECTED if none.
 *   3. best-effort POST the refresh token to Microsoft's revoke endpoint (failures ignored — the
 *      local delete is the source of truth; Microsoft revocation is eventual regardless).
 *   4. delete the local connection row.
 *   5. audit `m365.connection.revoked` with reason=user_disconnect.
 */
export async function handleDisconnect(deps: HandlerDeps): Promise<HandlerResult> {
  const { env, serviceClient, userId } = deps;
  const fetchImpl = deps.fetch ?? fetch;
  const headers = { 'Content-Type': 'application/json' };

  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== 'string') return resolved;
  const orgId = resolved;

  const { data: conn, error } = await serviceClient
    .from('ms_graph_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (error || !conn) {
    return { status: 404, body: { error: 'NOT_CONNECTED', message: 'no active connection' }, headers };
  }
  const connection = conn as ConnectionRow;

  // Best-effort Microsoft revoke — ignore failures (local delete is authoritative).
  try {
    const kek = resolveKek(env, connection.key_id);
    const envelope = deserializeEnvelope(connection.refresh_token_ciphertext);
    const refreshToken = await decryptToken(envelope.ciphertext, envelope.iv, kek);
    await fetchImpl(`${REVOKE_ENDPOINT}/${connection.entra_tenant_id}/oauth2/v2.0/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.m365ClientId,
        client_secret: env.m365ClientSecret,
        token: refreshToken,
      }),
    });
  } catch {
    // Ignore — best effort.
  }

  // Delete the local row (source of truth).
  await serviceClient.from('ms_graph_connections').delete().eq('id', connection.id);

  await logAudit(serviceClient, {
    action: 'm365.connection.revoked',
    orgId,
    actorId: userId,
    entityId: connection.id,
    detail: { reason: 'user_disconnect' },
  });

  return { status: 200, body: { success: true }, headers };
}
