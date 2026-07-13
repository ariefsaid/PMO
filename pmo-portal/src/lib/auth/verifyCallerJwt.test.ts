/**
 * Tests for the shared local caller-JWT verifier (`_shared/verifyCallerJwt.ts`, ADR-0057).
 * Offline: mints an ephemeral ES256 keypair per test and verifies against its local JWKS — no live
 * Supabase stack / JWKS endpoint needed. Proves the gate the edge functions rely on instead of the
 * `auth.getUser` round-trip: valid → {sub, claims}; every failure mode → a single typed 401.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT, type JWK } from 'jose';
import { verifyCallerJwt, bearerToken, JwtVerifyError, type JwksResolver } from './verifyCallerJwt';

const ISS = 'https://proj.supabase.co/auth/v1';
const AUD = 'authenticated';
const KID = 'test-kid';

async function keyedJwks(alg: 'ES256' | 'RS256'): Promise<{ jwks: JwksResolver; privateKey: CryptoKey }> {
  const { publicKey, privateKey } = await generateKeyPair(alg, { extractable: true });
  const jwk = (await exportJWK(publicKey)) as JWK;
  jwk.kid = KID;
  jwk.alg = alg;
  jwk.use = 'sig';
  return { jwks: createLocalJWKSet({ keys: [jwk] }), privateKey };
}

async function sign(
  privateKey: CryptoKey,
  alg: 'ES256' | 'RS256',
  claims: Record<string, unknown>,
  overrides: { iss?: string; aud?: string; exp?: string | number } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg, kid: KID })
    .setIssuedAt()
    .setIssuer(overrides.iss ?? ISS)
    .setAudience(overrides.aud ?? AUD);
  jwt.setExpirationTime(overrides.exp ?? '1h');
  return jwt.sign(privateKey);
}

describe('verifyCallerJwt', () => {
  it('AC-JWT-001: a validly signed, unexpired token returns { sub, claims }', async () => {
    const { jwks, privateKey } = await keyedJwks('ES256');
    const token = await sign(privateKey, 'ES256', { sub: 'user-123', role: 'authenticated' });
    const result = await verifyCallerJwt(token, jwks, { issuer: ISS, audience: AUD });
    expect(result.sub).toBe('user-123');
    expect(result.claims.role).toBe('authenticated');
  });

  it('AC-JWT-002: a token signed by a different key → INVALID_TOKEN', async () => {
    const { jwks } = await keyedJwks('ES256'); // trusted set
    const { privateKey: attackerKey } = await keyedJwks('ES256'); // different keypair
    const token = await sign(attackerKey, 'ES256', { sub: 'user-123' });
    await expect(verifyCallerJwt(token, jwks, { issuer: ISS })).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
      status: 401,
    });
  });

  it('AC-JWT-003: an expired token → INVALID_TOKEN', async () => {
    const { jwks, privateKey } = await keyedJwks('ES256');
    const token = await sign(privateKey, 'ES256', { sub: 'user-123' }, { exp: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifyCallerJwt(token, jwks, { issuer: ISS })).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('AC-JWT-004: wrong issuer → INVALID_TOKEN', async () => {
    const { jwks, privateKey } = await keyedJwks('ES256');
    const token = await sign(privateKey, 'ES256', { sub: 'user-123' }, { iss: 'https://evil.example/auth/v1' });
    await expect(verifyCallerJwt(token, jwks, { issuer: ISS })).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('AC-JWT-004: wrong audience → INVALID_TOKEN', async () => {
    const { jwks, privateKey } = await keyedJwks('ES256');
    const token = await sign(privateKey, 'ES256', { sub: 'user-123' }, { aud: 'some-other-service' });
    await expect(verifyCallerJwt(token, jwks, { issuer: ISS, audience: AUD })).rejects.toMatchObject({
      code: 'INVALID_TOKEN',
    });
  });

  it('AC-JWT-002 (alg-confusion): an RS256 token is rejected when ES256 is pinned', async () => {
    // Attacker presents a validly-signed RS256 token whose public key is even in the JWKS; pinning
    // algorithms:['ES256'] must still reject it (defense against algorithm-substitution).
    const { jwks, privateKey } = await keyedJwks('RS256');
    const token = await sign(privateKey, 'RS256', { sub: 'user-123' });
    await expect(
      verifyCallerJwt(token, jwks, { issuer: ISS, algorithms: ['ES256'] }),
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('a missing token → MISSING_TOKEN (no crypto attempted)', async () => {
    const { jwks } = await keyedJwks('ES256');
    await expect(verifyCallerJwt(null, jwks, { issuer: ISS })).rejects.toMatchObject({
      code: 'MISSING_TOKEN',
      status: 401,
    });
    await expect(verifyCallerJwt('', jwks, { issuer: ISS })).rejects.toBeInstanceOf(JwtVerifyError);
  });

  it('a token with no sub claim → INVALID_TOKEN', async () => {
    const { jwks, privateKey } = await keyedJwks('ES256');
    const token = await sign(privateKey, 'ES256', {}); // no sub
    await expect(verifyCallerJwt(token, jwks, { issuer: ISS })).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});

describe('bearerToken', () => {
  it('strips a case-insensitive Bearer prefix', () => {
    expect(bearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(bearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for absent or malformed headers', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('abc.def.ghi')).toBeNull(); // no Bearer prefix
    expect(bearerToken('Basic abc')).toBeNull();
  });
});
