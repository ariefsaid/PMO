// revoke.ts — `disconnect` handler: best-effort Microsoft revoke, then delete the local connection
// row and audit. A pure function taking INJECTED deps (ADR-0039). No Deno.env, no client construction.

import type { HandlerDeps, HandlerResult, ConnectionRow } from './types.ts';
import { resolveOrgOrResult } from './auth.ts';
import { decryptToken, deserializeEnvelope, resolveKek } from './crypto.ts';
import { logAudit, recordM365Error } from './audit.ts';
import { isValidTenant } from '../../../pmo-portal/src/lib/m365/graphPkce.ts';

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
  // M3 (Luna): validate the DB-sourced tenant before constructing the revoke URL (this POST carries
  // the decrypted refresh_token + client_secret). The column CHECK (0111) rejects bad values on
  // write, so this is defense-in-depth; a bad tenant simply skips the Microsoft revoke and still
  // proceeds to the authoritative local delete below.
  try {
    if (!isValidTenant(connection.entra_tenant_id)) {
      throw new Error('invalid tenant');
    }
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
  // H6 (Luna): inspect the delete result. Previously the awaited delete was IGNORED — a DB error
  // left the encrypted row in place yet the function still wrote a 'revoked' audit event and
  // returned 200. Luna (Low) additionally: a CONCURRENT zero-row delete (the row was already gone —
  // e.g. a just-fired lifecycle cascade) was treated as success too. Only audit success / return
  // 200 when a row was ACTUALLY deleted; otherwise surface failure.
  //
  // Luna round-4 (MED-2 — service-role direct-DML lockdown + DEADLOCK closure): the delete now goes
  // through the m365_delete_connection SECURITY-DEFINER RPC, which locks PROFILES → ORG_FEATURES for
  // update BEFORE the connection DELETE — the single global lock order (see 0113/0114 headers) — so
  // every connection mutation (upsert/refresh/status/delete) takes locks parent→child and NONE can
  // reproduce the child→parent deadlock. The RPC is also IDENTITY-BOUND (MED-1): the DELETE matches
  // only a row whose (org_id, user_id) equal the caller's org/user, so a mismatched (org,user,id)
  // can NEVER mutate another identity's row (returns null → NOT_CONNECTED). service_role no longer
  // holds direct INSERT/UPDATE/DELETE on this table (0114), so the RPCs are the only write path.
  // The returned id is the proof the row was actually deleted; null = already gone / mismatched.
  const { data: deletedId, error: deleteError } = await serviceClient.rpc('m365_delete_connection', {
    p_org_id: orgId,
    p_user_id: userId,
    p_connection_id: connection.id,
  });
  if (deleteError) {
    await recordM365Error(serviceClient, {
      errorCode: 'INTERNAL_ERROR',
      contextId: connection.id,
      orgId,
    });
    return {
      status: 503,
      body: { error: 'INTERNAL_ERROR', message: 'failed to delete connection; please retry' },
      headers,
    };
  }
  if (!deletedId) {
    // Concurrent zero-row delete — the connection was already revoked (e.g. a lifecycle cascade
    // fired between our SELECT and our DELETE). NOT success: surface NOT_CONNECTED so the caller
    // doesn't believe a token it no longer holds was just revoked. No success audit is written.
    await recordM365Error(serviceClient, {
      errorCode: 'INTERNAL_ERROR',
      contextId: connection.id,
      orgId,
    });
    return { status: 404, body: { error: 'NOT_CONNECTED', message: 'no active connection' }, headers };
  }

  await logAudit(serviceClient, {
    action: 'm365.connection.revoked',
    orgId,
    actorId: userId,
    entityId: connection.id,
    detail: { reason: 'user_disconnect' },
  });

  return { status: 200, body: { success: true }, headers };
}
