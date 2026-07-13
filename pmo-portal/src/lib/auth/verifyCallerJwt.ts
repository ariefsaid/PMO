/**
 * verifyCallerJwt — the ONE shared local caller-JWT verifier for edge functions (ADR-0057).
 *
 * Verifies a caller JWT's signature + standard claims against the project JWKS *locally* (no
 * `auth.getUser` round-trip to GoTrue). Pure + Deno-global-free → imported cross-tree by the Deno edge
 * functions (via `../../../pmo-portal/src/lib/auth/verifyCallerJwt.ts`, `jose` mapped in their
 * `deno.json`) and unit-tested here in Vitest — the same "pure logic lives in `src/lib/`, the function
 * is a thin wrapper" split as `src/lib/invite/inviteHandler.ts`.
 *
 * Boundaries:
 *   - RLS remains the enforcement authority (ADR-0016). This replaces only the *gate*; every
 *     subsequent data access still runs under the caller JWT + RLS (or a policy-checked service call).
 *   - Local verification proves the token is cryptographically valid + unexpired. It does NOT prove the
 *     user is un-banned / still exists right now. Functions that escalate to service_role after auth
 *     MUST keep a live check (ADR-0057 §Decision-3); functions whose data path is caller-JWT+RLS may
 *     rely on local verification alone.
 *   - The algorithm is pinned by the caller (default ES256 — prod signs with ECC P-256) to block
 *     alg-confusion: a token is only accepted if its header alg is in the allow-list.
 *   - Any signature / expiry / issuer / audience / algorithm failure collapses to a single typed 401
 *     (`INVALID_TOKEN`) — no distinguishing oracle is leaked to the caller.
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

export class JwtVerifyError extends Error {
  constructor(
    public code: 'MISSING_TOKEN' | 'INVALID_TOKEN',
    public status: number,
  ) {
    super(code);
    this.name = 'JwtVerifyError';
  }
}

export interface VerifiedCaller {
  sub: string;
  claims: JWTPayload;
}

/** A JWKS key resolver — `createRemoteJWKSet` (prod) or `createLocalJWKSet` (tests) both satisfy this. */
export type JwksResolver = JWTVerifyGetKey;

/** Build a caching, rate-limited remote JWKS resolver for a project. Call once at module scope. */
export function jwksFromUrl(jwksUrl: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUrl));
}

/** Strip a case-insensitive `Bearer ` prefix; return null if the header is absent or malformed. */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1] : null;
}

export async function verifyCallerJwt(
  token: string | null | undefined,
  jwks: JwksResolver,
  opts: { issuer: string; audience?: string; algorithms?: string[] },
): Promise<VerifiedCaller> {
  if (!token) throw new JwtVerifyError('MISSING_TOKEN', 401);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: opts.issuer,
      audience: opts.audience ?? 'authenticated',
      algorithms: opts.algorithms ?? ['ES256'], // prod signs ES256 (ECC P-256); pin to block alg-confusion
    });
    if (!payload.sub) throw new JwtVerifyError('INVALID_TOKEN', 401);
    return { sub: payload.sub, claims: payload };
  } catch (err) {
    if (err instanceof JwtVerifyError) throw err;
    throw new JwtVerifyError('INVALID_TOKEN', 401);
  }
}
