// initiate.ts — `initiate_connect` handler: generate PKCE, store the single-use state, return the
// Microsoft authorize URL. A pure function taking INJECTED deps (ADR-0039): the caller-JWT client,
// service client, and resolved env. No Deno.env, no client construction.

import type { HandlerDeps, HandlerResult, InitiateConnectResponse } from './types.ts';
import { resolveOrgOrResult } from './auth.ts';
import { storePkceState } from './stateStore.ts';
import {
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizeUrl,
  M365_PHASE1_DATA_SCOPES,
  M365_FOLDER_SCOPES,
} from './pkce.ts';
import { checkRequestRate } from '../_shared/requestRateGuard.ts';
import { newOpaqueStateToken } from '../_shared/opaqueStateToken.ts';

/**
 * Scopes for Phase-1 OneDrive + SharePoint document-library linking. `openid` + `profile` make
 * Microsoft return an `id_token` in the token response — the callback asserts that id_token's
 * `tid` against `env.m365TenantId` BEFORE storing anything, binding the issued tokens to the
 * expected tenant (HIGH-1 consent-phishing / OAuth-code-injection mitigation). `offline_access`
 * yields a durable refresh token; `Files.Read` is the OneDrive read scope. `Files.Read.All` +
 * `Sites.Read.All` reach a SharePoint document LIBRARY — `Files.Read` alone cannot (it covers
 * only the signed-in user's OneDrive, not shared sites). Those three are read scopes (ADR-0060 §1/§5).
 * Record folders (ADR-0089) are an INCREMENTAL consent: `Sites.Selected` is requested only by an explicit
 * `folders: true` reconnect (M365_FOLDER_SCOPES); the default connect and the admin-consent URL are
 * read-only exactly as before.
 */
export const M365_PHASE1_SCOPES = [
  ...M365_PHASE1_DATA_SCOPES,
  'offline_access',
  'openid',
  'profile',
];

/**
 * AC-M365-101/102: authorize (active member + entitled) → generate PKCE → store state (single-use, 10-min
 * TTL) → build the allowlisted Microsoft authorize URL. Returns { authorizeUrl, state }; the FE
 * navigates the user there. The tenant/redirect_uri come ONLY from env (never caller input), so a
 * malicious tenant/redirect cannot be smuggled (AC-M365-141, enforced in buildAuthorizeUrl).
 */
/**
 * Client contract (the FE reconnect button): body is exactly `{ action: 'initiate_connect' }` or
 * `{ action: 'initiate_connect', folders: true }`; any other key, or `folders` other than boolean true, is
 * refused with 400 BAD_REQUEST. Response is unchanged: `{ authorizeUrl, state }`.
 */
function parseInitiateBody(body: unknown): { folders: boolean } | null {
  if (body === undefined) return { folders: false };
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== 'action' && key !== 'folders') return null;
  if (!('folders' in record)) return { folders: false };
  return record.folders === true ? { folders: true } : null;
}

export async function handleInitiateConnect(deps: HandlerDeps, body?: unknown): Promise<HandlerResult> {
  const { env, serviceClient, now } = deps;
  const nowFn = now ?? (() => new Date());

  const parsed = parseInitiateBody(body);
  if (!parsed) {
    return { status: 400, body: { error: 'BAD_REQUEST', message: 'invalid connect request' } };
  }
  const scopes = parsed.folders ? [...M365_PHASE1_SCOPES, ...M365_FOLDER_SCOPES] : M365_PHASE1_SCOPES;

  const resolved = await resolveOrgOrResult(deps);
  if (typeof resolved !== 'string') return resolved;
  const orgId = resolved;

  // Bound abandoned OAuth starts with the shared request-rate guard. The database migration also
  // caps live rows per user, so a limiter outage cannot turn this transient table into an unbounded
  // store. This is an availability throttle, not the authorization boundary.
  const rate = await checkRequestRate(serviceClient as never, {
    key: `m365-token-custody:initiate_connect:${deps.userId}`,
    limit: 5,
    windowSecs: 10 * 60,
  });
  if (rate.exceeded) {
    return {
      status: 429,
      body: { error: 'RATE_LIMITED', message: 'too many connection attempts' },
      headers: { 'Retry-After': String(rate.retryAfterSeconds) },
    };
  }

  // PKCE (RFC 7636): verifier + S256 challenge + 256-bit state token.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const state = newOpaqueStateToken();

  await storePkceState(
    serviceClient,
    { orgId, userId: deps.userId, codeVerifier, state, scopes },
    nowFn,
  );

  const authorizeUrl = buildAuthorizeUrl({
    tenant: env.m365TenantId,
    clientId: env.m365ClientId,
    redirectUri: env.m365RedirectUri,
    scopes,
    state,
    codeChallenge,
  });

  const response: InitiateConnectResponse = { authorizeUrl, state };
  return { status: 200, body: response };
}

/**
 * The shared opaque state token is bound to the caller via m365_pkce_states and consumed once by
 * the callback (AC-M365-142).
 */
