// initiate.ts — `initiate_connect` handler: generate PKCE, store the single-use state, return the
// Microsoft authorize URL. A pure function taking INJECTED deps (ADR-0039): the caller-JWT client,
// service client, and resolved env. No Deno.env, no client construction.

import type { HandlerDeps, HandlerResult, InitiateConnectResponse } from './types.ts';
import { M365HandlerError, errorResult } from './types.ts';
import { authorizeAdminEntitled } from './auth.ts';
import { storePkceState } from './stateStore.ts';
import { generateCodeVerifier, codeChallengeS256, buildAuthorizeUrl } from './pkce.ts';

/** Scopes for Phase-1 OneDrive doc linking (Files.Read) + offline_access for a durable refresh token. */
export const M365_PHASE1_SCOPES = ['Files.Read', 'offline_access'];

/**
 * AC-M365-101/102: authorize (Admin + entitled) → generate PKCE → store state (single-use, 10-min
 * TTL) → build the allowlisted Microsoft authorize URL. Returns { authorizeUrl, state }; the FE
 * navigates the user there. The tenant/redirect_uri come ONLY from env (never caller input), so a
 * malicious tenant/redirect cannot be smuggled (AC-M365-141, enforced in buildAuthorizeUrl).
 */
export async function handleInitiateConnect(deps: HandlerDeps): Promise<HandlerResult> {
  const { env, serviceClient, callerClient, userId, now } = deps;
  const nowFn = now ?? (() => new Date());

  if (!callerClient) {
    return { status: 500, body: { error: 'INTERNAL_ERROR', message: 'caller client missing' } };
  }

  let orgId: string;
  try {
    ({ orgId } = await authorizeAdminEntitled({ callerClient, userId }));
  } catch (err) {
    if (err instanceof M365HandlerError) return errorResult(err);
    throw err;
  }

  // PKCE (RFC 7636): verifier + S256 challenge + 128-bit state token.
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);
  const state = newStateToken(nowFn);

  await storePkceState(serviceClient, { orgId, userId, codeVerifier, state, scopes: M365_PHASE1_SCOPES }, nowFn);

  const authorizeUrl = buildAuthorizeUrl({
    tenant: env.m365TenantId,
    clientId: env.m365ClientId,
    redirectUri: env.m365RedirectUri,
    scopes: M365_PHASE1_SCOPES,
    state,
    codeChallenge,
  });

  const body: InitiateConnectResponse = { authorizeUrl, state };
  return { status: 200, body };
}

/**
 * 128-bit CSRF state token, base64url-stripped to URL-safe chars (AC-M365-142). Bound to the
 * caller via the stored m365_pkce_states row; single-use (deleted on callback consume).
 */
function newStateToken(nowFn: () => Date): string {
  void nowFn; // clock kept in signature for determinism if later needed; entropy is crypto-sourced
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 43);
}
