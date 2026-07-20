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
// Valid Microsoft tenant identifiers: a GUID, the keywords common/organizations/consumers, or a
// verified domain (e.g. contoso.onmicrosoft.com). All match [A-Za-z0-9._-]. Anything else could
// smuggle path/query segments into the authorize URL (security-audit Minor 1, 2026-07-14).
// The charset alone accepts '.' and '..' — M3 (Luna) tightens that here: dot-segments ('..' anywhere)
// and all-dot values ('.', '..', '...') are rejected while keeping every legitimate tenant valid.
const TENANT_RE = /^[A-Za-z0-9._-]+$/;
const TENANT_DOTSEGMENT_RE = /\.\./; // two consecutive dots anywhere
const TENANT_ALLDOTS_RE = /^[.]+$/; // one or more dots and nothing else

/**
 * M3 (Luna): the shared tenant validator. True for a GUID, common/organizations/consumers, or an
 * ASCII/punycode verified domain (e.g. contoso.onmicrosoft.com); false for anything carrying path /
 * query / whitespace metacharacters, dot-segments ('..'), or all-dot values ('.'). Reused by every
 * authorize/token/revoke URL construction site (buildAuthorizeUrl + the callback/refresh/revoke
 * handlers) so a DB- or env-sourced tenant can NEVER redirect a secret-bearing body via path
 * confusion (the host stays pinned — this closes path-confusion, not arbitrary-host SSRF).
 */
export function isValidTenant(tenant: unknown): tenant is string {
  return (
    typeof tenant === 'string' &&
    tenant.length > 0 &&
    TENANT_RE.test(tenant) &&
    !TENANT_DOTSEGMENT_RE.test(tenant) &&
    !TENANT_ALLDOTS_RE.test(tenant)
  );
}

/**
 * M3 (Luna): throw on an invalid tenant. Used by buildAuthorizeUrl (initiate) where a bad tenant is
 * a misconfiguration best surfaced as a hard failure rather than a silent bad URL. The token/revoke
 * handlers use {@link isValidTenant} directly so they can route a bad DB value to their own
 * error-handling (best-effort revoke must NOT block the authoritative local delete).
 */
export function validateTenant(tenant: string): void {
  if (!isValidTenant(tenant)) {
    throw new Error(
      'graphPkce: invalid tenant identifier (expected a GUID, common/organizations/consumers, or a verified domain; dot-segments and all-dot values are rejected)',
    );
  }
}

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
  // Defense-in-depth: the tenant is interpolated into the URL *path* (query params are encoded by
  // searchParams). Validate its shape and encode it so it cannot alter the path/query even if a
  // future caller passes an unexpected value. Host stays pinned to login.microsoftonline.com.
  // M3 (Luna): validateTenant also rejects dot-segments ('..') and all-dot values.
  validateTenant(params.tenant);
  const url = new URL(`${AUTHORIZE_BASE}/${encodeURIComponent(params.tenant)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}
