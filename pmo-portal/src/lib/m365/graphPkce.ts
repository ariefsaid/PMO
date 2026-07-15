/**
 * graphPkce — pure PKCE (RFC 7636) parameter generation + Microsoft authorize-URL construction
 * for the server-side auth-code + PKCE bootstrap (ADR-0060 §1, D2).
 *
 * Pure + Deno-global-free, Web Crypto only (`globalThis.crypto`) — the SAME code runs unmodified
 * in a Deno edge function and in Vitest (mirrors `src/lib/auth/verifyCallerJwt.ts` / the sibling
 * `graphTokenCrypto.ts`: pure logic lives here, a future edge function imports it cross-tree).
 * Deliberately does NOT use `node:crypto`.
 *
 * Scope: parameter/URL construction ONLY. The token EXCHANGE (POSTing `code` + `code_verifier` to
 * Microsoft with the confidential-client secret) is the held Phase-1 exchange edge function — this
 * module reads no secret and makes no network call.
 */

const VERIFIER_BYTES = 64; // → 86 base64url chars after encoding, within the RFC 7636 43-128 range
const AUTHORIZE_BASE = 'https://login.microsoftonline.com';

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a high-entropy RFC 7636 `code_verifier` (unreserved charset, 43-128 chars). */
export function generateCodeVerifier(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES));
  return base64UrlEncode(bytes);
}

/** Compute the S256 `code_challenge`: base64url(SHA-256(verifier)), no padding. */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export interface AuthorizeUrlParams {
  tenant: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}

/**
 * Build the Microsoft identity platform v2.0 authorize URL for the PKCE auth-code flow. Pure
 * string construction — no secret, no network call. The `scopes` MUST be able to include
 * `offline_access` for a durable refresh token (ADR-0060 §1/§5).
 */
export function buildAuthorizeUrl(params: AuthorizeUrlParams): string {
  const url = new URL(`${AUTHORIZE_BASE}/${params.tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
