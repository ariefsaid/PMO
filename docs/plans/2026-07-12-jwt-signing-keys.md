# Implementation plan — Asymmetric JWT signing keys + local edge verification

- **Date:** 2026-07-12
- **Issue:** PMO jwt-signing-keys — move edge-function caller-JWT verification off the per-request
  `auth.getUser` round-trip and onto asymmetric signing keys + local JWKS verification.
- **Author:** Director (eng-planner phase, Claude Opus 4.8)
- **ADR:** `docs/adr/0057-asymmetric-jwt-signing-keys-and-local-edge-verification.md` (binding — read first)
- **Depends-on ADRs (controlling on conflict):** ADR-0016 (`can()` UX-only, RLS is authority),
  ADR-0039 (edge deputy pattern), ADR-0002 (anon key public), NFR-AR-SEC-002 (service_role only for auth).
- **Format model:** `docs/plans/2026-07-05-agent-experience-layer.md`.

## Status / preconditions

**BLOCKED on an owner action before any function-code task can be integration-verified** (ADR-0057
§Sequencing step 1): asymmetric signing keys must be enabled on the local stack (`config.toml`
`signing_keys_path`, needs the Supabase CLI — absent in the web sandbox) and on the cloud project
(dashboard, standby→active). Legacy HS256 exposes no JWKS to verify against, so Task 2's integration
proof cannot run until this is done.

**Unblocked now:** Task 1 (the pure helper + unit tests) is fully offline-verifiable against an
ephemeral keypair and does not require signing keys to be live.

## Traceability

| AC | Title | Owning layer | File |
|---|---|---|---|
| AC-JWT-001 | Valid token → `{sub, claims}` | Unit (Vitest) | `pmo-portal/src/lib/agent/verifyCallerJwt.test.ts` |
| AC-JWT-002 | Bad signature → typed `INVALID_TOKEN` | Unit | same |
| AC-JWT-003 | Expired token → typed `INVALID_TOKEN` | Unit | same |
| AC-JWT-004 | Wrong issuer/audience → typed error | Unit | same |
| AC-JWT-005 | `compose-view` rejects absent/garbage bearer with typed 401 (parity with `getUser` path) | E2E (curated) | `pmo-portal/e2e/AC-JWT-005-compose-view-auth.spec.ts` |

---

## Task 1 — Shared pure verifier + unit tests (UNBLOCKED, do first)

**1a. Add `jose`.** In `pmo-portal/`: `npm i jose@^6` (registry-reachable; version 6.2.3 confirmed
2026-07-12). Commit `package.json` + `package-lock.json`.

**1b. Write the helper** `supabase/functions/_shared/verifyCallerJwt.ts` — pure, no Deno globals, so it
imports cleanly into Vitest (the `errorLog.ts` pattern). Drop-in:

```ts
/**
 * verifyCallerJwt — the ONE shared local caller-JWT verifier for edge functions (ADR-0057).
 * Verifies a caller JWT's signature + standard claims against the project JWKS *locally* (no
 * auth.getUser round-trip). Pure + Deno-global-free → unit-tested from pmo-portal/src/lib/agent/
 * (mirrors errorLog.ts / inviteHandler.ts). RLS remains the enforcement authority (ADR-0016);
 * this only replaces the *gate*. NOTE: local verify does NOT prove the user is un-banned right now
 * — callers that escalate to service_role must keep a live check (ADR-0057 §Decision-3).
 */
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

export class JwtVerifyError extends Error {
  constructor(public code: 'MISSING_TOKEN' | 'INVALID_TOKEN', public status: number) {
    super(code);
    this.name = 'JwtVerifyError';
  }
}

export interface VerifiedCaller {
  sub: string;
  claims: JWTPayload;
}

// Accepts a JWKSet resolver so tests inject an ephemeral keypair; prod builds one from the URL.
export type JwksResolver = Parameters<typeof jwtVerify>[1];

export function jwksFromUrl(jwksUrl: string): JwksResolver {
  return createRemoteJWKSet(new URL(jwksUrl));
}

export async function verifyCallerJwt(
  token: string | null | undefined,
  jwks: JwksResolver,
  opts: { issuer: string; audience?: string },
): Promise<VerifiedCaller> {
  if (!token) throw new JwtVerifyError('MISSING_TOKEN', 401);
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: opts.issuer,
      audience: opts.audience ?? 'authenticated',
    });
    if (!payload.sub) throw new JwtVerifyError('INVALID_TOKEN', 401);
    return { sub: payload.sub, claims: payload };
  } catch (err) {
    if (err instanceof JwtVerifyError) throw err;
    throw new JwtVerifyError('INVALID_TOKEN', 401); // signature/expiry/issuer/audience → single typed 401
  }
}

/** Strip "Bearer " (case-insensitive); null if absent/malformed. */
export function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1] : null;
}
```

**1c. Write unit tests** `pmo-portal/src/lib/agent/verifyCallerJwt.test.ts`, importing via
`../../../../supabase/functions/_shared/verifyCallerJwt` (the established cross-tree import). Use `jose`'s
`generateKeyPair('RS256')` + `SignJWT` + `exportJWK`/`createLocalJWKSet` to mint an ephemeral key in-test:
- AC-JWT-001: token signed by the test key, correct issuer/aud → returns `{ sub, claims }`.
- AC-JWT-002: token signed by a *different* key → `JwtVerifyError('INVALID_TOKEN')`.
- AC-JWT-003: token with `exp` in the past → `INVALID_TOKEN`.
- AC-JWT-004: wrong `iss` and wrong `aud` (two cases) → `INVALID_TOKEN`.
- Plus `bearerToken`: `"Bearer x"`→`"x"`, `"bearer x"`→`"x"`, `null`/`"x"`→`null`; and
  `verifyCallerJwt(null, …)` → `JwtVerifyError('MISSING_TOKEN')`.

**1d. Verify (offline):** from `pmo-portal/` → `npm run typecheck && npx vitest run src/lib/agent/verifyCallerJwt.test.ts`.
**Gate before PR:** full `npm run verify` (typecheck && lint:ci && test && build) per CLAUDE.md.

**Reviewers (loop step 5):** spec-reviewer, code-quality-reviewer, **security-auditor** (verify the
"single typed 401 on any failure" collapse leaks no oracle, and that `issuer`/`audience` are always
pinned — never optional-away).

---

## Task 2 — Pilot: switch `compose-view` to local verification (BLOCKED on owner step 1)

**2a.** In `supabase/functions/compose-view/index.ts`, replace the `auth.getUser(jwt)` gate with
`verifyCallerJwt(bearerToken(req.headers.get('Authorization')), jwks, { issuer })`, where `jwks =
jwksFromUrl(\`${SUPABASE_URL}/auth/v1/.well-known/jwks.json\`)` is built **once at module scope**
(`createRemoteJWKSet` caches + rate-limits key fetches internally). Keep the **caller-JWT client** for
the actual `compose` reads (RLS unchanged — ADR-0016). Map `JwtVerifyError.status`/`.code` to the
existing typed-401 JSON body so the response contract is byte-for-byte unchanged.

**2b.** Rationale for `compose-view` as the pilot (ADR-0057 §Decision-3): its data access runs under the
caller JWT + RLS and it does **not** escalate to service_role, so the banned-user staleness window is
absorbed by RLS. Lowest blast radius of the four.

**2c. Verify:** local stack booted with signing keys live (owner step 1 done) →
`scripts/with-db-lock.sh npx playwright test e2e/AC-JWT-005-compose-view-auth.spec.ts` proves the
absent/garbage-bearer 401 parity and a valid-token happy path. Full `npm run verify` before PR.

**Reviewers:** all three, **security-auditor mandatory** (auth-path change).

---

## Task 3 — Extend per policy (BLOCKED; sequence after Task 2 merges)

Function-by-function, each its own small PR + security-auditor pass, honoring ADR-0057 §Decision-3:

- `adapter-dispatch` — caller-JWT + RLS path → local-verify (same shape as `compose-view`).
- `agent-chat` — currently uses **service_role** solely for `getUser`. Switch to local-verify + a
  targeted live check ONLY where it escalates; removing the service_role-for-auth call also tightens
  NFR-AR-SEC-002 (service_role no longer touched on the pre-auth path).
- `admin-invite-user` — escalates to service_role for issuance. **Keep a live check** (retain `getUser`
  for the caller, or local-verify + `profiles` ban/role lookup) so a just-banned admin cannot issue
  within the token window. Security-auditor decides which.

**Never** big-bang all four. Each function's live-check choice is recorded in its PR description.

---

## Out of scope (separate future decisions)

- **`@supabase/server`** (`withSupabase`) — public beta as of 2026-07-12; revisit at GA. The
  `verifyCallerJwt` helper is the manual equivalent of its gate and is a clean drop-in later.
- **Publishable/secret API-key migration** — related but independent; can follow Level 1 anytime.
