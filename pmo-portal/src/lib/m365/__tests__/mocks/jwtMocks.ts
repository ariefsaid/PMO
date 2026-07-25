// jwtMocks.ts — test utilities for creating mock ES256 JWTs + JWKS (for Vitest).
// Uses `jose` (same lib verifyCallerJwt uses) to mint valid/invalid test tokens. The JWKS is
// exposed as a `data:` URL so createRemoteJWKSet resolves it without a network fetch.

import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet } from 'jose';

export interface MockJwks {
  resolver: ReturnType<typeof createRemoteJWKSet>;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export async function createMockJwks(): Promise<MockJwks> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }))}`;
  const resolver = createRemoteJWKSet(new URL(jwksUrl));
  return { resolver, publicKey, privateKey };
}

/** An HS256 "JWKS" to prove alg-confusion is blocked (the verifier pins ES256). */
export async function createMockHs256Jwks(): Promise<MockJwks> {
  const key = await globalThis.crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await exportJWK(key);
  const jwksUrl = `data:application/json,${encodeURIComponent(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', use: 'sig' }] }))}`;
  const resolver = createRemoteJWKSet(new URL(jwksUrl));
  return { resolver, publicKey: key, privateKey: key };
}

export interface MockJwtOptions {
  exp?: number; // unix seconds
  alg?: string; // defaults to ES256
}

export async function createMockJwt(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  opts: MockJwtOptions = {},
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...payload, iat: now, nbf: now })
    .setProtectedHeader({ alg: opts.alg ?? 'ES256', kid: 'test-key' })
    .setExpirationTime(opts.exp ?? now + 3600)
    .setIssuedAt(now)
    .setIssuer('https://test.supabase.co/auth/v1')
    .setAudience('authenticated')
    .sign(privateKey);
}
