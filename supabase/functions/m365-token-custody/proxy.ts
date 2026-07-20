// proxy.ts — `graph_proxy` handler: decrypt the cached access token, call Microsoft Graph, return
// the data. Auto-refreshes when the access token is near expiry and enforces the connection's
// consented scopes per requested path. A pure function taking INJECTED deps (ADR-0039): clients,
// fetch, clock, env. No Deno.env, no client construction.

import type { HandlerDeps, HandlerResult, GraphProxyRequest, ConnectionRow } from './types.ts';
import { resolveOrgOrResult } from './auth.ts';
import { decryptToken, deserializeEnvelope, resolveKek } from './crypto.ts';
import { refreshAccessToken } from './refresh.ts';
import { recordM365Error } from './audit.ts';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const ACCESS_TOKEN_REFRESH_BUFFER_MS = 30_000; // refresh if the access token expires within 30s

/**
 * AC-M365-110/111/112/113/114. Flow:
 *   1. authorize (Admin + entitled) → orgId.
 *   2. load the caller's connection; reject NOT_CONNECTED / CONNECTION_STALE / CONNECTION_REVOKED.
 *   3. enforce scope↔path (AC-M365-114): a Files.Read-only connection may only hit OneDrive paths;
 *      write methods need a Files.ReadWrite* scope. Hoisted before decrypt/refresh (quality #2).
 *   4. decrypt the cached access token; if absent/near-expiry, refresh (refreshAccessToken handles
 *      stale/revoke classification — AC-M365-111/112/113) and re-decrypt.
 *   5. call Graph with the decrypted Bearer; return the JSON body. NEVER echo the token (AC-M365-140).
 */
export async function handleGraphProxy(
  req: GraphProxyRequest,
  deps: HandlerDeps,
): Promise<HandlerResult> {
  const { serviceClient, userId } = deps;
  const headers = { 'Content-Type': 'application/json' };

  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== 'string') return resolved;
  const orgId = resolved;

  if (!req.path || !req.method) {
    return { status: 400, body: { error: 'BAD_REQUEST', message: 'method and path required' }, headers };
  }

  // Load the caller's connection (own-row scoped — service_role write path, ADR-0060 §4/AC-M365-133).
  const { data: conn, error: connError } = await serviceClient
    .from('ms_graph_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .single();

  if (connError || !conn) {
    return { status: 404, body: { error: 'NOT_CONNECTED', message: 'no active Microsoft 365 connection' }, headers };
  }
  const connection = conn as ConnectionRow;

  if (connection.status === 'stale') {
    return { status: 409, body: { error: 'CONNECTION_STALE', message: 'connection expired, please reconnect' }, headers };
  }
  if (connection.status === 'revoked') {
    return { status: 410, body: { error: 'CONNECTION_REVOKED', message: 'connection revoked' }, headers };
  }

  // Scope↔path enforcement (AC-M365-114). Hoisted BEFORE decrypt/refresh (quality #2) so a
  // scope-insufficient request needlessly decrypts nothing and burns no Microsoft refresh round-trip.
  if (!scopeCoversPath(connection.scopes, req.method, req.path)) {
    return {
      status: 403,
      body: { error: 'SCOPE_INSUFFICIENT', message: 'requested Graph path requires additional consent' },
      headers,
    };
  }

  // Decrypt the cached access token, refreshing first if it is absent or near expiry.
  let accessToken: string;
  try {
    accessToken = await loadFreshAccessToken(connection, deps);
  } catch {
    // After a refresh failure the row is stale OR revoked — re-read to map a security revocation to
    // 410 CONNECTION_REVOKED (not a benign 409 stale), so a reuse-revocation isn't masked (quality #10).
    const { data: fresh } = await serviceClient
      .from('ms_graph_connections')
      .select('status')
      .eq('id', connection.id)
      .single();
    if ((fresh as { status?: string } | null)?.status === 'revoked') {
      return { status: 410, body: { error: 'CONNECTION_REVOKED', message: 'connection revoked' }, headers };
    }
    return {
      status: 409,
      body: { error: 'CONNECTION_STALE', message: 'token refresh failed, please reconnect' },
      headers,
    };
  }

  // Call Graph. The decrypted Bearer is used here and never logged/echoed (AC-M365-140).
  const graphUrl = new URL(`${GRAPH_BASE}${req.path}`);
  if (req.query) {
    for (const [k, v] of Object.entries(req.query)) graphUrl.searchParams.set(k, v);
  }
  const fetchImpl = deps.fetch ?? fetch;
  const graphRes = await fetchImpl(graphUrl.toString(), {
    method: req.method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
  });

  if (!graphRes.ok) {
    await recordM365Error(serviceClient, { errorCode: 'GRAPH_ERROR', contextId: connection.id, orgId });
    return { status: 502, body: { error: 'GRAPH_ERROR', message: 'Graph API request failed' }, headers };
  }

  const data = await graphRes.json();
  return { status: 200, body: data, headers };
}

/**
 * Decrypt the cached access token, refreshing first if it is null or expires within the buffer.
 * `refreshAccessToken` re-reads the row it updated via the service client; this re-loads the fresh
 * ciphertext. Throws on a refresh/exchange failure (caller maps to CONNECTION_STALE).
 */
async function loadFreshAccessToken(connection: ConnectionRow, deps: HandlerDeps): Promise<string> {
  const { env, serviceClient, now } = deps;
  const nowFn = now ?? (() => new Date());
  const kek = resolveKek(env, connection.key_id);

  const expiresAtMs = connection.access_token_expires_at
    ? new Date(connection.access_token_expires_at).getTime()
    : 0;

  if (!connection.access_token_ciphertext || expiresAtMs < nowFn().getTime() + ACCESS_TOKEN_REFRESH_BUFFER_MS) {
    const refreshed = await refreshAccessToken(connection, deps);
    if (!refreshed) throw new Error('refresh failed');
    const { data: fresh, error: freshError } = await serviceClient
      .from('ms_graph_connections')
      .select('access_token_ciphertext, key_id')
      .eq('id', connection.id)
      .single();
    const freshRow = fresh as { access_token_ciphertext: Uint8Array | null; key_id: string } | null;
    if (freshError || !freshRow || !freshRow.access_token_ciphertext) throw new Error('refresh produced no token');
    const envelope = deserializeEnvelope(freshRow.access_token_ciphertext);
    return decryptToken(envelope.ciphertext, envelope.iv, resolveKek(env, freshRow.key_id));
  }

  const envelope = deserializeEnvelope(connection.access_token_ciphertext);
  return decryptToken(envelope.ciphertext, envelope.iv, kek);
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * OneDrive path family match. Uses trailing-slash prefixes (LOW-5) so a lookalike like
 * '/me/driveEvil' cannot pass as '/me/drive'; the exact root ('/me/drive', '/drives', '/sites')
 * is also accepted.
 */
function isOneDrivePath(path: string): boolean {
  return path === '/me/drive' || path.startsWith('/me/drive/')
    || path === '/drives' || path.startsWith('/drives/')
    || path === '/sites' || path.startsWith('/sites/');
}

/**
 * Phase-1 scope↔path enforcement (AC-M365-114, LOW-5). Only Files.* scopes are provisioned and
 * cover OneDrive paths; any non-OneDrive path (calendar, mail, …) is rejected SCOPE_INSUFFICIENT.
 * Write methods (POST/PATCH/PUT/DELETE) additionally require a Files.ReadWrite* scope — a
 * Files.Read-only connection may not write (Graph would 403 anyway; we fail earlier with a clear
 * code). Conservative by design.
 */
export function scopeCoversPath(scopes: string[], method: string, path: string): boolean {
  if (!isOneDrivePath(path)) return false;
  if (WRITE_METHODS.has(method.toUpperCase())) {
    return scopes.some((s) => s === 'Files.ReadWrite' || s === 'Files.ReadWrite.All');
  }
  return scopes.some(
    (s) => s === 'Files.Read' || s === 'Files.ReadWrite' || s === 'Files.Read.All' || s === 'Files.ReadWrite.All',
  );
}
