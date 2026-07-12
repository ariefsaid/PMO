# ADR-0057 — Asymmetric JWT signing keys + local JWKS verification in edge functions

- **Status:** Proposed (Director, 2026-07-12) — **owner action required to enable (see §Sequencing)**
- **Date:** 2026-07-12
- **Deciders:** Director (eng-planner phase); **owner sign-off required** (prod dashboard action + auth-path change)
- **Related:** ADR-0002 (singleton browser client / anon key public by design),
  ADR-0016 (`can()` UX-only, **RLS is the enforcement authority**), ADR-0039 (untrusted-output boundary /
  edge-function deputy pattern), NFR-AR-SEC-002 (service_role used ONLY for `auth.getUser`),
  spec `docs/specs/jwt-signing-keys.spec.md`, plan `docs/plans/2026-07-12-jwt-signing-keys.md`.
- **Scope:** how PMO's Supabase edge functions verify caller JWTs. Two separable layers, decided together
  so the team sequences them one way. **Explicitly NOT in scope:** the `@supabase/server` package
  (public beta as of 2026-07-12 — a later, separate decision) and the publishable/secret API-key
  migration (related but independent; can follow).

## Context

Supabase offers two JWT systems:

1. **Legacy (symmetric, HS256).** One shared **JWT secret** both *signs* and *verifies* tokens. Every
   verifier must hold the secret — anything that can verify can also forge. Rotating the secret
   invalidates every live session, so in practice it is never rotated.
2. **Asymmetric signing keys (new).** A **private** key signs (held only by Supabase Auth,
   non-extractable); a **public** key verifies, published as a **JWKS** endpoint (safe to distribute).
   Supports zero-downtime rotation (standby → active, old key still served via JWKS) and **local**
   signature verification with no round-trip to the Auth server.

PMO's edge functions today verify the caller JWT by calling `auth.getUser(jwt)`, which is a **network
round-trip to GoTrue on every request**. Four functions do this:

- `admin-invite-user` — caller-JWT (anon) client → `getUser`, then deputy-auth (`authorizeInvite`) before any service_role call.
- `agent-chat` — **service_role** client used ONLY for `getUser` (NFR-AR-SEC-002), then a caller-JWT client for business reads.
- `compose-view` — caller-JWT client → `getUser`.
- `adapter-dispatch` — caller-JWT client → `getUser`.

There is **no shared verification helper** — each function hand-rolls header parsing + `getUser`. This
ADR decides (a) whether to adopt asymmetric signing keys, and (b) whether/how to switch the hot-path
verification from `getUser` to local JWKS verification.

## Decision

**1. Adopt asymmetric JWT signing keys (Level 1).** Enable an asymmetric signing key on both the local
dev stack (`config.toml` → `signing_keys_path`) and the cloud project (dashboard). This is valuable on
its own merits — independent of Level 2, the API-key migration, and `@supabase/server`:
- **No shared verification secret** → removes forge capability from every verifier.
- **Zero-downtime rotation** → the secret becomes rotatable without nuking live sessions.
- **Prerequisite** for local verification and for the new-key model.

Enabling asymmetric signing keys is **backward-compatible with the existing `getUser` calls** — the
client library resolves the key via JWKS transparently, so Level 1 can ship with **zero function-code
change** and Level 1's security/rotation wins bank immediately.

**2. Introduce ONE shared local-verification helper (Level 2), rolled out pilot-first.** Add
`supabase/functions/_shared/verifyCallerJwt.ts` — a pure, Vitest-testable helper (via `jose`, mirroring
the `errorLog.ts` / `inviteHandler.ts` "pure logic in a shared file, unit-tested from
`pmo-portal/src/lib/agent/`" pattern) that verifies a JWT's signature + claims against the project JWKS
**locally**, returning `{ sub, claims }` or throwing a typed error. It replaces the `getUser` round-trip
on the hot path **only where the live-user check is not required** (see the tradeoff below). Rollout:
**pilot `compose-view` first**, gate on the security-auditor, then extend function-by-function.

**3. The `getUser` live-user check is a per-function decision, not a blanket swap.** `auth.getUser()`
also confirms the user **still exists / is not banned right now** (a live GoTrue/DB check). Local JWKS
verification only proves the token is cryptographically valid and unexpired — a **banned or deleted user
remains valid until token expiry** (≤ `jwt_expiry`, currently 3600s). Therefore:
- Functions whose subsequent data access runs **under the caller's JWT + RLS** (`compose-view`,
  `adapter-dispatch`) may switch to local verification — RLS re-checks authority on every row, and a
  revoked user's session is independently killed by GoTrue regardless.
- Functions that **escalate to service_role after auth** (`admin-invite-user`, `agent-chat`) keep an
  explicit live check (either retain `getUser`, or local-verify + a targeted `profiles`/ban lookup)
  so a just-banned admin cannot drive a privileged action within the token window. The security-auditor
  signs off the choice per function.

## Consequences

- **RLS remains the enforcement authority (ADR-0016).** Local verification is a UX/latency
  optimization on the *gate*; it never becomes the sole authority for data access. A verification bug
  degrades to a `401`, never to silent over-permission.
- **Latency + resilience win** on the hot path: authed functions stop paying a GoTrue round-trip per
  call, and verification survives a transient Auth-server blip.
- **One dependency added** (`jose`) to `pmo-portal/package.json` (for the Vitest unit tests) and to the
  Deno import surface (for the functions). Small, audited, dual-runtime.
- **Explicit staleness window** for local-only-verified functions: a banned user's token stays valid
  until expiry. Documented, bounded by `jwt_expiry`, and mitigated by keeping a live check on the
  service_role-escalating functions.
- **Reversible.** Level 1 is a config/dashboard toggle. Level 2 is additive (a new helper + per-function
  swap); reverting a function to `getUser` is a one-line change. No schema, no data migration.
- **Sequencing is forced** (see below) — Level 2 cannot be end-to-end verified until Level 1 is enabled,
  because there is no JWKS to verify against under legacy HS256.

## Sequencing (binding order of operations)

1. **[OWNER] Enable asymmetric signing keys.** Local: generate a signing key file and set
   `signing_keys_path` in `supabase/config.toml` (requires the Supabase CLI, **not present in the
   web/CI sandbox** — run locally). Cloud/prod: Supabase dashboard → Auth → Signing Keys → create +
   promote to active (standby-first). **This is a production infra action reserved to the owner
   (CLAUDE.md branch-flow rule); the Director does not perform it.**
2. **[DIRECTOR/loop] Build the shared `verifyCallerJwt` helper + Vitest unit tests** (offline-verifiable
   against an ephemeral keypair). No function edits.
3. **[DIRECTOR/loop] Pilot `compose-view`** on local verification behind the normal issue loop
   (spec-reviewer + code-quality-reviewer + **security-auditor**), verify on the booted local stack,
   PR → `dev`.
4. **[DIRECTOR/loop] Extend** function-by-function per the §Decision-3 live-check policy; never big-bang
   the four together.

Until step 1 is done by the owner, Level 2 work is limited to the (fully unit-testable) helper — the
integration proof waits on the JWKS being live.
