# M365 Phase-1 token-custody — review battery (2026-07-15)

Reviewers: security-auditor + spec-reviewer + code-quality-reviewer (pi/zai glm-5.1), Director-verified.
Verdicts: security **SHIP-WITH-FIXES** (2 HIGH, 1 MED, 5 LOW) · spec **APPROVE-with-1-fix** · quality **APPROVE-WITH-FIXES**.
Fix disposition tracked in docs/backlog.md M365 entry. Mandatory: HIGH-1 (token tenant/user binding), HIGH-2 (cascade wiring).

---

# 🔒 Security Audit — M365 Phase-1 Token-Custody Edge Function

**Scope:** `supabase/functions/m365-token-custody/*` + migrations `0098/0099/0100` + pgTAP `0145–0148` + `pmo-portal/src/lib/m365/*` · branch `m365-impl` · ADR-0060 mandatory gate, pre-deploy code review.

I read every handler, the router, both migrations' lockdown, the cascade/audit RPCs, the Phase-0 crypto/PKCE helpers, the JWT verifier, and confirmed the pgTAP proofs. Thinking like an attacker throughout.

---

## ✅ Controls that HOLD (verified, not theater)

- **Server-only custody / no client token leakage** — grep-confirmed. Handlers log only sanitized codes (`callback.ts:72-73` `tokenData.error` only, never `error_description`; `index.ts:138` logs `err.name` not message; `audit.ts:38` action only). Proxy returns Graph `data` only (`proxy.ts:111`); callback is a 302 with `?m365_connected=true`/`?m365_error=` only — **no token in URL or body**. `code_verifier` is never returned to the FE (stored server-side, `initiate.ts` returns only `{authorizeUrl, state}`).
- **Encryption at rest** — `graphTokenCrypto` is sound AES-256-GCM (12-byte IV, 16-byte tag, 32-byte key enforced `graphTokenCrypto.ts:21-23`, malformed-envelope rejected `:73`). KEK from `M365_TOKEN_KEK` env only (`index.ts:61`), resolved via `resolveKek`, never DB/client/logged. `key_id='kek-v1'` is a reference, `resolveKek` throws on unknown id (fails closed).
- **Token-store lockdown** — `ms_graph_connections` (0096) + `m365_pkce_states` (0098) are both `enable + force row level security`, **zero policies**, `revoke all from authenticated, anon`. pgTAP `0145` proves authenticated SELECT/INSERT/UPDATE all → `42501`. Service-role/SD-RPC only. ✓ mirrors 0096.
- **Audit path** — `audit.ts:25` routes through `audit_m365_event` SD wrapper (0100, `m365.*` allowlist, service_role-granted, authenticated/anon denied — proven `0148`), **not** `log_audit` directly. Detail carries scopes/tenant/reason only — no token material. ✓
- **AuthZ** — `userId` always from verified JWT `sub` (`index.ts:128`), never request body. Org resolved under caller-JWT RLS read of `profiles`; role read from `profiles.role` (the DB source of truth via `auth_role()` 0002 — **immune to JWT-role spoofing**, correctly stricter than FR-M365-162's wording). Admin + `m365_integration` entitlement gated (`auth.ts:33-50`). Own-row scoped `eq('org_id',orgId).eq('user_id',userId)`; cross-org impossible (pgTAP `0146` FK + unique).
- **PKCE/CSRF** — 256-bit state, server-stored, the callback consumes the state row and uses **no client-supplied identity** (callback path has `userId:''`, derives org/user from the state row written under the verified JWT). ✓ the specific check you flagged **passes**.
- **Callback binds user via state row** — `callback.ts:42` → `consumePkceState` → `pkce.orgId/userId` (from the initiate-time verified row). No caller JWT trusted on the 302. ✓
- **SSRF (proxy)** — host pinned `https://graph.microsoft.com/v1.0` (`proxy.ts:13,91`); `new URL(base+path)` can't escape host; scope-prefix gate further constrains to `/me/drive`,`/drives`,`/sites`. Token endpoint pinned `login.microsoftonline.com`. Secret + redirect_uri from env only.
- **Refresh rotation + reuse** — rotated RT always persisted (`refresh.ts:75-95`); `invalid_grant`→`stale`; reuse→`revoked`+security event.

---

## 🔴 Findings

### HIGH-1 — Returned tokens' tenant is never validated → OAuth consent-phishing / code-injection
**Location:** `callback.ts:84-108` (upsert), `callback.ts:55` (token endpoint), `initiate.ts:12` (scopes). No `tid`/`id_token` extraction anywhere (grep-confirmed).

**The gap:** The callback exchanges `code`+`code_verifier` and upserts the result to `(pkce.orgId, pkce.userId)` with `entra_tenant_id: env.m365TenantId` — but it **never verifies the issued tokens actually belong to the expected tenant/user**. The state row binds the harvest to the *initiator's* PMO account; nothing binds the *consenting Microsoft user* to that initiator.

**Exploit (consent phishing / OAuth code injection):**
1. Attacker (any Admin in an entitled PMO org) calls `initiate_connect` → gets `authorizeUrl` + `state`. The `code_verifier` is stored server-side bound to **(attacker_org, attacker_user)**.
2. Attacker phishes the `authorizeUrl` to a victim.
3. Victim approves Microsoft consent → Microsoft issues a `code` bound to the attacker's `code_challenge` (the victim traversed *the attacker's* authorize URL) and 302s the victim's browser to `/callback?code=<victim_code>&state=<attacker_state>`.
4. Callback consumes attacker's state → redeems `victim_code` with the attacker's stored `code_verifier` (matches!) → receives **the victim's** access+refresh tokens → encrypts → upserts to **(attacker_org, attacker_user)** with `entra_tenant_id=env`.
5. Attacker calls `graph_proxy` → decrypts the **victim's** tokens → reads the victim's OneDrive. **Cross-account data breach.**

**Why it's live:** `graphPkce.TENANT_RE` explicitly permits `common`/`organizations` (`graphPkce.ts:21`). If `M365_TENANT_ID` is configured `common`/`organizations` (multi-tenant — a supported, easily-chosen config), Microsoft issues tokens for *any* tenant and **nothing** server-side catches the mismatch. Even in the *designed* single-tenant silo (ADR-0059 Option C), an **in-tenant** variant works: a colleague in the same Entra tenant is phished and their tokens land in the attacker's PMO connection (Microsoft's single-tenant gate only checks tenant membership, not "is this the right user for this PMO connection"). The PKCE/state CSRF defense does **not** stop this — it prevents injecting an attacker's code into a *victim's* flow, not harvesting a victim's code into an *attacker's* flow.

**Fix (mandatory before exposing any multi-tenant config; strongly recommended for single-tenant too):** bind the issued token to the expected tenant. Decode the access-token JWT payload (or add `openid profile` to `M365_PHASE1_SCOPES` to get an `id_token`) and assert `tid === env.m365TenantId` **before** encrypt/upsert; on mismatch → `TOKEN_EXCHANGE_FAILED` + error_event, no store. Store the *real* `tid`/`oid` in the row (also fixes the observability gap that `entra_tenant_id` is currently the env value, not the token's). This makes cross-tenant consent-phishing impossible regardless of config. (In-tenant phishing is then bounded by Microsoft's consent UX + publisher verification — the latter is an acknowledged Non-Goal §6.)

---

### HIGH-2 — Offboard / disentitlement cascade is NOT wired → NFR-M365-107 unmet
**Location:** `0099_m365_disconnect_cascade.sql` (RPC exists + `0147` tests it in isolation) but **`operator_toggle_feature` (0070) and `admin_set_user_status` (0065) contain zero `m365` references** (grep-confirmed), and there is **no trigger** anywhere referencing the cascade.

**The gap:** ADR-0060 §7 / NFR-M365-107 / FR-M365-151 require tokens to be **deleted on user offboard, org disable, and entitlement toggle-off**. The `m365_disconnect_cascade` RPC is correct and its guard is sound (`auth_role()`/`auth_org_id()` are SECURITY DEFINER reading `profiles` — Operator-or-Admin-in-org enforced, cross-org blocked), but **nothing invokes it**. The migration *comment* claims it's "Called by operator_toggle_feature / admin_set_user_status" — that is aspirational, not wired.

**Exploit:** An offboarded user (`admin_set_user_status → disabled`) or a disentitled org (`operator_toggle_feature('m365_integration', false)`) **retains live encrypted refresh tokens** in `ms_graph_connections` indefinitely. A disabled user's stale-but-valid refresh token remains in the DB (and still redeemable at Microsoft for ~90 days), violating least-privilege / data-minimization and the explicit retention contract. AC-M365-121 is only half-proven (the RPC contract works; the lifecycle trigger does not exist).

**Fix:** Wire the cascade — either a `BEFORE UPDATE` trigger on `profiles` (status→disabled) and on `org_features` (`m365_integration`→false) calling `m365_disconnect_cascade`, or explicit calls inside `admin_set_user_status` / `operator_toggle_feature`. Add a pgTAP proving the *trigger* fires (not just a direct RPC call). Until wired, NFR-M365-107 is not satisfied by the shipped surface — must resolve, or explicitly owner-defer with the gap tracked, before ship.

---

### MEDIUM-1 — `consumePkceState` is non-atomic (TOCTOU) → single-use guarantee breaks under concurrency
**Location:** `stateStore.ts:54-70` — `select(...).eq('state').single()` → check expiry → `delete().eq('id')` is a **read-then-delete**, not one statement.

**Exploit:** Two concurrent callbacks carrying the same `state` (double-submit, a racing replay, or an attacker who obtained the callback URL via Referer/open-redirect) both pass the SELECT before either DELETEs — both proceed to exchange. OAuth `code` is single-use at Microsoft so this doesn't mint two token-sets (the second exchange `invalid_grant`s), but the **CSRF single-use invariant (AC-M365-142) is demonstrably broken under concurrency**, and the window muddies reuse-detection semantics.

**Fix:** Make consume atomic in one round-trip — `delete from m365_pkce_states where state = $1 returning *`, then evaluate expiry on the returned row; return null if no row returned or it's expired. This makes single-use race-free. (The `state UNIQUE` constraint already prevents double-insert.)

---

### LOW-1 — Tenant interpolated into token/revoke URLs without re-validation (SSRF defense-in-depth, sensitive payload)
**Location:** `refresh.ts:47` and `revoke.ts:55` build `` `${TOKEN_ENDPOINT}/${connection.entra_tenant_id}/...` `` from a **DB column with no format CHECK** (`0096:20` `entra_tenant_id text not null` — no `TENANT_RE`). `callback.ts:55` interpolates `env.m365TenantId` likewise without `TENANT_RE` (only `buildAuthorizeUrl` validates the tenant).

**Exploit:** Not reachable today (the only writer is the callback, which stamps the env value), so this is defense-in-depth — *but* these requests carry `client_secret` + the plaintext `refresh_token` in the body. If any future write path (or a tampered row) sets `entra_tenant_id` to e.g. `common/../../evil.host`, the refresh/revoke POST would redirect that secret-bearing body to an attacker host.

**Fix:** Re-validate `TENANT_RE` at every token/revoke URL construction site (callback + refresh + revoke), and add a `CHECK (entra_tenant_id ~ '^[A-Za-z0-9._-]+$')` on the column. Cheap, closes the class.

### LOW-2 — `p_reason` not allowlisted in cascade (audit integrity)
**Location:** `0099_m365_disconnect_cascade.sql:14` — `p_reason text` is caller-supplied and placed into audit `detail` via `jsonb_build_object` (no injection, but no allowlist).

**Exploit:** A malicious Admin/Operator can write a misleading `reason` (e.g. log `offboard` while the event was a disentitlement), corrupting the audit trail's semantic integrity.

**Fix:** `if p_reason not in ('disentitled','offboard','org_disabled') then raise exception…`.

### LOW-3 — Refresh reuse-detection heuristic is fragile
**Location:** `refresh.ts:166-170` — `isReuseError` triggers only on `invalid_grant` whose `error_description` includes the literal `'reuse'`.

**Exploit/impact:** Microsoft's reuse signal often surfaces as `invalid_grant` with AADSTS codes whose descriptions vary; the substring match will miss many real reuse events. **Not a hole** — the safe-state fallback (`isInvalidGrant` → `stale`, forced re-consent) invalidates the connection regardless — so worst case is a missed `SECURITY_EVENT_REUSE` classification, not token survival. Spec explicitly defers hash-based detection.

**Fix (later phase):** hash/store the last-presented RT and compare; treat any mismatch on a still-valid token as reuse.

### LOW-4 — Non-`invalid_grant` refresh errors silently leave the row `active`
**Location:** `refresh.ts` `classifyRefreshFailure` — only handles reuse and `invalid_grant`; `invalid_client`/`invalid_request`/network→`UNKNOWN`/`temporarily_unavailable` fall through doing **nothing**. `refreshAccessToken` returns `false` → proxy returns `CONNECTION_STALE`, but the **row status stays `active`** and no error_event is recorded.

**Impact:** Transient errors self-heal on retry (fine), but a persistent config failure (`invalid_client` = bad/rotated `M365_CLIENT_SECRET`) leaves the connection perpetually `active`-but-unusable with no error_event — an ops blind spot, not a security hole.

**Fix:** record an error_event for the unhandled branch; consider marking `stale` after N consecutive non-transient failures.

### LOW-5 — Proxy scope gate is path-prefix-only, ignores method-vs-scope
**Location:** `proxy.ts:149-155` — `scopeCoversPath` checks only that the path family matches a held scope; a `Files.Read`-only connection is allowed to `POST /me/drive/...`.

**Impact:** Graph authoritatively 403s the write (the proxy never elevates), so this is contained — but the "scope enforcement" claim (AC-M365-114) is coarser than it reads. `path.startsWith('/me/drive')` is also a string prefix (`/me/driveEvil` passes → Graph 404).

**Fix:** gate write methods (`POST/PATCH/PUT/DELETE`) on a write scope (`Files.ReadWrite*`); optionally `path.startsWith('/me/drive/')`.

---

## Verdict: **SHIP-WITH-FIXES**

The custody *model* is sound: AES-256-GCM envelope, forced-RLS zero-policy store, server-only tokens, JWT+RLS authz, SD audit wrapper, PKCE, host pinning, no leakage in logs/responses/errors. **No Critical in the designed single-tenant silo config.** Two Highs are genuine gaps against ADR-0060 controls and must close before this surface is exposed:

- **HIGH-1 (tenant validation)** — block on any multi-tenant deploy; strongly recommended for single-tenant (in-tenant consent-phishing has no server-side mitigation today).
- **HIGH-2 (cascade wiring)** — NFR-M365-107 is not achieved by the shipped migrations; wire it (or explicitly owner-defer with tracking).

MEDIUM-1 (atomic consume) and the Low hardening items can land as the immediate fast-follow; none require re-architecting. Recommend: address HIGH-1 + HIGH-2 + MEDIUM-1, re-run the unit secrets test (`tokenCustody.secrets.test.ts`) with the new tenant-assertion, then clear to expose the first Graph *data* feature.

SECURITY-DONE

---

I've read all the code and tests independently. Vitest reproduced green (9 files / 60 tests). Here is my spec review.

---

# Spec Review — M365 Phase-1 Token Custody

**Contract:** `docs/specs/m365-phase1-graph-token-custody.spec.md` · **Plan:** `docs/plans/2026-07-15-m365-phase1-token-custody.md` · **Branch:** `m365-impl` · **Diff base:** `b3b6a2d4`

## Verification method (no trust)
- Ran `npx vitest run src/lib/m365/__tests__` myself → **9 files / 60 tests pass** (reproduced, not trusted).
- Read every edge-fn module, all 3 migrations, all 4 pgTAP tests, all 9 Vitest files + mocks.
- pgTAP 0145–0148: DB-deferred per notes; verified by **code inspection** of the test bodies against the migrations (sound). CI re-run pending.
- Independently grepped the cascade-wiring claim (see AC-M365-121 below).

## Strengths
- **ADR-0039 done right.** `index.ts` is the *only* Deno.env/I/O site; every handler (`initiate/callback/proxy/refresh/revoke/auth/stateStore/audit`) is a pure function taking injected `HandlerDeps`. Genuinely unit-testable.
- **Real crypto in tests.** `m365MockDeps.ts` uses a real 32-byte test KEK so `graphTokenCrypto` envelope actually encrypts/decrypts — tests assert real ciphertext shapes, not mocked returns.
- **Strong secrets hygiene (AC-M365-140).** `tokenCustody.secrets.test.ts:5` forbids 7 substrings and asserts their absence across `console.*`, response bodies, *and* headers on every error path.
- **Correct PKCE/CSRF.** Single-use state (`consumePkceState` deletes on read, `stateStore.ts:54`), 10-min TTL, ≥256-bit URL-safe state token (`initiate.ts:57`), tenant regex pinning.
- **`audit_m365_event` wrapper (0100) is defense-in-depth done well.** `m365.*` action allowlist means the broad `service_role` grant can't forge other domains' audit; `revoke all from public` + service_role-only execute; 0148 proves all three properties.

## Issues

### Critical
None.

### Important
**1. AC-M365-121 / FR-M365-151 — cascade RPC exists but is never wired to its triggers.**
The RPC `m365_disconnect_cascade` is defined (`supabase/migrations/0099_m365_disconnect_cascade.sql:10`) and the pgTAP 0147 proves the *RPC contract* (deletes + audits, org-scoped). **But nothing invokes it.** Verified: `grep -rn m365_disconnect_cascade supabase/` returns only `0099` (def) and `0147` (test). `operator_toggle_feature` (`0070_org_features.sql`) and `admin_set_user_status` (`0065_admin_set_user_status.sql`) contain **zero** m365/cascade references.

AC-M365-121's When/Then is explicit: *"when `operator_toggle_feature(org, 'm365_integration', false)` is called (or a user is offboarded via `admin_set_user_status`), Then a security-definer RPC deletes all connections…"* — that end-to-end behavior is **not implemented**. Today, disentitling an org or offboarding a user **leaves the encrypted tokens in place** (NFR-M365-107 unmet as an automated guarantee). The plan's traceability scoped this AC as "RPC contract" only, but the **spec's AC text** is the contract for a spec-review and it requires the trigger wiring.
→ Fix: add the call (or a trigger on `org_features`/`profiles.status`) in `0070`/`0065`, or get the owner to explicitly re-scope AC-M365-121. Building block is sound, so this is contained — hence Important, not Critical.

### Minor
**2. `entra_user_object_id` never populated on callback.** `callback.ts:95` upsert sets `entra_tenant_id`, `scopes`, ciphertexts, `key_id`, `status`, `connected_at`, `last_refresh_at` — but **omits `entra_user_object_id`**, which FR-M365-110 requires (from the id_token `oid` claim or a `/me` call). **AC-M365-103 does not list it**, so no AC fails — but it's an FR deviation worth wiring (Graph's `id_token` carries `oid`).

**3. `graphTokenCrypto.ts` edited despite "MUST NOT be edited."** `pmo-portal/src/lib/m365/graphTokenCrypto.ts:39,66` add `as BufferSource` casts; the re-export comment in `crypto.ts:5` still says it's untouched and "MUST NOT be edited." The edit is a **zero-runtime-change** type cast for Deno 2.7's stricter WebCrypto typing (legit dual-runtime need) — functionally benign, but the security-auditor should formally acknowledge the touch to a security-audited file (and the stale comment updated).

**4. `action: 'refresh'` routes to a hardcoded `/me/drive` GET** (`index.ts:118-124`) instead of a dedicated refresh handler. No AC owns a standalone refresh action (FR-M365-140 is exercised via proxy auto-refresh, covered by AC-M365-111), so **no AC gap** — just flagging the oddity; the comment explains the intent.

## Per-AC coverage table

| AC | Layer | Owning test | Result | Evidence / note |
|----|-------|-------------|--------|-----------------|
| 101 | Unit + pgTAP | `tokenCustody.initiate.test.ts` (AC-M365-101) + `0145` | ✅ | authorize URL (host/tenant/scope/redirect/challenge) + PKCE row stored |
| 102 | Unit | `tokenCustody.initiate.test.ts` (AC-M365-102) + `auth.test.ts` | ✅ | FORBIDDEN / NOT_ENTITLED, no state stored |
| 103 | Unit | `tokenCustody.callback.test.ts` (AC-M365-103) | ✅ | exchange→encrypt both→upsert active→audit; (Minor 2: no `entra_user_object_id`, not in AC) |
| 104 | Unit | `tokenCustody.callback.test.ts` (AC-M365-104) | ✅ | INVALID_STATE, no exchange, error_event |
| 105 | Unit | `tokenCustody.callback.test.ts` (AC-M365-105) | ✅ | TOKEN_EXCHANGE_FAILED, no partial store |
| 110 | Unit | `tokenCustody.proxy.test.ts` (AC-M365-110) | ✅ | decrypt→Graph Bearer, no token echo |
| 111 | Unit | `tokenCustody.proxy.test.ts` (AC-M365-111) | ✅ | rotated pair persisted, `m365.token.refreshed` |
| 112 | Unit | `tokenCustody.proxy.test.ts` (AC-M365-112) | ✅ | stale + refresh_failed + REFRESH_FAILED |
| 113 | Unit | `tokenCustody.proxy.test.ts` (AC-M365-113) | ✅ | revoked + reuse_detected + SECURITY_EVENT_REUSE |
| 114 | Unit | `tokenCustody.proxy.test.ts` (AC-M365-114) | ✅ | `/me/events` → SCOPE_INSUFFICIENT; matrix test |
| 120 | Unit | `tokenCustody.lifecycle.test.ts` (AC-M365-120) | ✅ | best-effort revoke (ignored failure) + delete + audit |
| **121** | **pgTAP** | `0147` | ⚠️ **PARTIAL** | RPC contract proven; **trigger wiring missing** (Issue 1) |
| 130 | Unit | `tokenCustody.auth.test.ts` (AC-M365-130) | ✅ | valid/expired/HS256-alg-confusion + org resolve |
| 131 | Unit | `tokenCustody.auth.test.ts` (AC-M365-131) | ✅ | non-Admin → FORBIDDEN |
| 132 | Unit | `tokenCustody.auth.test.ts` (AC-M365-132) | ✅ | no entitlement → NOT_ENTITLED |
| 133 | pgTAP | `0146` | ✅ | unique(org,user) 23505, FK 23503, org-scoped |
| 140 | Unit + Gate | `tokenCustody.secrets.test.ts` | ✅ unit / ⏳ gate | unit green; **security-auditor gate pending** (expected/owner-gated) |
| 141 | Unit | `graphPkce.security.test.ts` (AC-M365-141) | ✅ | traversal/query rejected; redirect URI from env only |
| 142 | Unit + pgTAP | initiate consume + pkce.security + `0145` | ✅ | delete-on-consume; UNIQUE constraint; URL-safe ≥32 chars |
| 170 | pgTAP | `0148` | ✅ | service_role grant, `m365.*` allowlist 22023, auth/anon 42501 |

**Tally:** 18 of 20 ACs fully met at the stated layer; AC-M365-121 partial (wiring); AC-M365-140 unit-met with the mandatory security-auditor gate still to run (expected). No missing requirements, no extra/unrequested scope, no secret leakage, no over-engineering.

## Assessment: **APPROVE-WITH-FIXES**
The token-custody runtime is spec-faithful and well-built. The single substantive fix before merge is **AC-M365-121 trigger wiring** (Issue 1) — wire `operator_toggle_feature`/`admin_set_user_status` to `m365_disconnect_cascade` (or a trigger), or get the owner to formally re-scope the AC. The three Minor items (entra `oid`, graphTokenCrypto comment/ack, refresh-route) are non-blocking cleanups. AC-M365-140's security-auditor gate remains a mandatory, owner-scheduled step per ADR-0060 (not a defect).

SPEC-DONE

---

# Code-Quality Review — M365 Phase-1 token-custody edge fn + tests

**Scope reviewed:** `git diff b3b6a2d4..HEAD` across the 12 edge-fn modules, 3 migrations, 4 pgTAP tests, and 8 Vitest files (~2,650 lines). Read every file end-to-end.

## Strengths

- **Exemplary DI seam (ADR-0039).** Verified by grep: *every* `Deno.env` / `createClient` / `Deno.serve` / `globalThis.Deno` reference outside `index.ts` is in a comment. `index.ts` is genuinely the sole env-reading + client-construction site; handlers read only `deps.fetch ?? fetch` and `deps.now ?? (() => new Date())`. The seam is the minimum viable shape (one structural `M365SupabaseLike` + `HandlerDeps`), **not over-abstracted**, and the `globalThis.Deno` guard prevents a bare-`Deno` global leaking into the Node import graph. Clean.
- **Single-responsibility decomposition.** Each module is one concern: `auth.ts` (gates), `stateStore.ts` (PKCE CRUD), `crypto.ts`/`pkce.ts` (re-exports + KEK resolver), `audit.ts` (RPC wrappers), one handler per action. Importable and testable independently.
- **Tests assert real behavior, not inflation.** `m365MockDeps.ts` ships a *real* test KEK so `graphTokenCrypto` AES-GCM actually runs — `tokenCustody.proxy.test.ts` proves decrypt by asserting the Graph call carries `Bearer ACCESS-TOKEN`/`Bearer NEW-ACCESS-TOKEN`. `tokenCustody.auth.test.ts` mints *real* ES256 JWTs via `jose` + a `data:`-URL JWKS and proves alg-confusion (HS256) is blocked. `tokenCustody.secrets.test.ts` captures console + scans every response body for forbidden substrings. These are behavior oracles, not number-inflaters.
- **DB hot paths are indexed (Part B DoD met).** `m365_pkce_states.state` is `unique` (covers the `consumePkceState` `.eq('state')` lookup); `ms_graph_connections` has `unique(org_id,user_id)` (covers proxy's `.eq('org_id').eq('user_id')` + cascade's single-user delete) and `ms_graph_connections_org_idx` (covers the all-org cascade). No `select *` over unbounded sets in a loop; refresh re-read is 1 row by PK.
- **Migrations/RLS are tight and pgTAP-proven.** 0098 mirrors the 0096 "RLS on + forced + zero policies + revoke all" lockdown; 0145 proves authenticated SELECT/INSERT/UPDATE all throw `42501` and the `state` unique constraint exists. 0100's `audit_m365_event` allowlist (`m365.*` only) is proven by 0148.

## Issues

### Critical
None.

### Important

**1. `index.ts:95-103` — the `refresh` action is a footgun: it doesn't refresh and makes an unwanted Graph call.**
A caller POSTing `{action:'refresh'}` is routed to `handleGraphProxy({path:'/me/drive'})`. Consequences: (a) if the cached access token has >30s life, **no refresh happens** — the contract implied by `RefreshRequest` is silently violated; (b) the handler issues a real Graph `/me/drive` call the caller never asked for and **returns drive metadata** in the body; (c) the type system advertises an action whose behavior contradicts its name. The `scopeCoversPath` check will also 403 a bare refresh against `/me/drive` only by luck (drive *is* covered).
*Fix:* either implement a true refresh (loop `refreshAccessToken` over the caller's connection and return `{success:true}`/`CONNECTION_STALE`), or — if Phase-1 genuinely doesn't need it — drop `RefreshRequest` and return `400 BAD_REQUEST "action 'refresh' not supported in Phase 1"` instead of impersonating a Graph call. Don't ship an action that does the wrong thing silently.

### Minor

**2. `proxy.ts:71→82` — scope check runs *after* token decrypt + possible refresh.** `scopeCoversPath`'s own comment says "we fail earlier with a clear code," but the order is status → `loadFreshAccessToken` (decrypt + maybe a Microsoft refresh round-trip) → scope. A scope-insufficient request needlessly decrypts and may burn a refresh. Hoist the `scopeCoversPath` check to between the status gates (line 65) and `loadFreshAccessToken`.

**3. `refresh.ts:112` — `classifyRefreshFailure` uses the real clock, not the injected `nowFn`.** The success path (line 80) uses `deps.now`, but both failure updates (`revoked` line 118, `stale` line 139) stamp `updated_at` with `new Date()`, so failure-path timestamps are non-deterministic. Thread `nowFn` into `classifyRefreshFailure` (it currently takes only `serviceClient`).

**4. `proxy.ts:127-131` — extra DB round-trip after every refresh.** `loadFreshAccessToken` calls `refreshAccessToken` (which writes the row) then immediately re-`select`s it to get the fresh ciphertext. `refreshAccessToken` could return the new `{accessEnvelope, keyId}` it just encrypted, letting the proxy decrypt directly and skip the re-read (also closes a small TOCTOU window). Negligible at Phase-1 scale; note for later.

**5. `refresh.ts:88, 130, 143` + `callback.ts`/`proxy.ts` — error_events `error_code` taxonomy drift.** `recordM365Error` is typed `errorCode: string` (free-form for the observability table), and refresh invents `DECRYPT_FAILED` / `REFRESH_FAILED` / `SECURITY_EVENT_REUSE` — none in the `M365ErrorCode` union — while callback/proxy reuse HTTP-taxonomy codes (`INVALID_STATE`, `TOKEN_EXCHANGE_FAILED`, `GRAPH_ERROR`). The `error_events` column ends up with two mixed namespaces. Either declare the observability codes as a named union alongside `M365ErrorCode` or prefix them (e.g. `M365_REFRESH_FAILED`) so a `grep`/filter is unambiguous.

**6. `initiate.ts:28-31` + `proxy.ts:37-40` + `revoke.ts:31-34` — repeated authorize-or-result boilerplate (3×).** The identical 5-line `try { ({orgId} = await authorizeAdminEntitled(...)) } catch { if M365HandlerError return errorResult(err); throw err }` block. Extract `resolveOrgOrResult(deps): Promise<string | HandlerResult>` into `auth.ts`. DRY + guarantees consistent gate mapping.

**7. Dead flexibility (YAGNI).**
- `index.ts:151-153` `callbackDeps(req, env)` takes `req` then `void req;` — drop the param.
- `initiate.ts:55-61` `newStateToken(nowFn)` takes `nowFn` then `void nowFn` ("kept if later needed") — remove the param; entropy is crypto-sourced and the clock is irrelevant here.

**8. `0099_m365_disconnect_cascade.sql:64` — dead `v_deleted` assignment.** `get diagnostics v_deleted = row_count;` in the all-orgs branch is never read (only the single-user branch at line 50 reads it). Remove, or use it to audit a count.

**9. PKCE states are never swept.** `m365_pkce_states` rows are deleted on consume (incl. consume-after-expiry), but a row created and *abandoned* (user closes the tab) is never cleaned up — there's no TTL sweep. At Phase-1 volume it's noise; add a scheduled `delete where expires_at < now()` (or a `pg_cron` job) before this table grows unbounded.

**10. `proxy.ts:73-79` — refresh-failure surfaces `CONNECTION_STALE` even for a *reuse* (security) revocation.** After `refreshAccessToken` marks the row `revoked` on reuse-detection, `loadFreshAccessToken` swallows the throw and the proxy returns `409 CONNECTION_STALE`. The DB is correct and the *next* call returns `CONNECTION_REVOKED`, but on the triggering call a security event is masked as a benign "please reconnect." Consider re-reading the row status on refresh failure and mapping revoked→`CONNECTION_REVOKED` (the `AC-M365-113` test would then assert 410, which is more truthful).

## Assessment

**APPROVE-WITH-FIXES.** The architecture is the strongest part: a genuinely clean ADR-0039 DI seam (verified — no Deno/env leakage, not over-abstracted), tight single-responsibility modules, real-crypto/real-JWT tests that assert behavior, and properly-indexed migrations with lockdown RLS proven by pgTAP. None of the issues are Critical and there are no scaling/cliff defects. **Fix #1 (the `refresh` action footgun) before merge** — it's a small, isolated change and shipping a named action that silently does something else is the kind of thing that erodes trust in the API surface. The Minors (#2–#10) are polish: do the cheap ones (#2 scope ordering, #3 clock, #7 dead params, #8 dead var) in the same PR; queue #4/#5/#9/#10 as follow-ups.

QUALITY-DONE

---

# Luna (gpt-5.6-luna:max) deep review — DB round (0101/0102/0149), 2026-07-16
Verdict: BLOCK. Director-verified C1/H3/H4 real. Triage → backlog M365 entry.

Subagent async grouped result intercom delivery was not acknowledged for '/var/folders/6q/rvc4t63n3ps7g5w5ckgl59qm0000gp/T/pi-subagents-uid-502/async-subagent-results/117bf319-7240-4cb6-a876-6516a935174d.json'.
# Verdict: **BLOCK**

The focused pgTAP passes **14/14**, and the full suite reportedly passes **167 files / 1,359 tests**. Those tests do not prove NFR-M365-107 end-to-end.

## Critical

### C1. Pending OAuth callback resurrects tokens after offboard/disentitlement

**Locations:**  
`0101_m365_cascade_triggers.sql:45-61,152-173`  
`0098_m365_pkce_states.sql:10-16`  
`supabase/functions/m365-token-custody/callback.ts:47-52,119-139`

**Scenario:** An Admin starts OAuth. Before the callback completes, the user is disabled or M365 is disentitled. The trigger deletes existing connections, but the PKCE state remains valid. The callback then consumes that state and upserts a new active connection without checking current profile status or entitlement.

This leaves a refresh token after the lifecycle event explicitly requiring deletion.

**Fix:**  
- Cascade-delete pending PKCE states for the user/org.  
- Recheck status and entitlement immediately before upsert.  
- Enforce the invariant at the `ms_graph_connections` INSERT/UPDATE boundary with row locking/serialization; callback-only checks remain TOCTOU-vulnerable.

## High

### H1. No org-disable path exists

**Locations:**  
`0001_init_schema.sql:30-34`  
`0099_m365_disconnect_cascade.sql:5`  
`0101_m365_cascade_triggers.sql:134-191`

`organizations` has no status/disabled field, RPC, or trigger. `org_disabled` is merely allowlisted as a reason; no production path invokes it.

Hard-deleting an organization removes local rows through FK cascades (`0096:17-19`), but that is not an org-disable lifecycle, emits no M365 audit, and performs no Microsoft revoke.

**Fix:** Define an org-disable state/RPC and invoke the same audited cascade before/within the state transition.

### H2. `operator_toggle_feature(..., false)` can INSERT without firing a trigger

**Locations:**  
`0070_org_features.sql:88-91`  
`0101_m365_cascade_triggers.sql:152-179,181-190`

Existing `true` rows correctly use `UPDATE`, but an absent row uses `INSERT enabled=false`. There is no INSERT trigger. Deleting an already-disabled row also intentionally skips the cascade.

**Scenario:** A stale connection exists due to a callback race, legacy data, or service-role write. An operator toggles M365 off with no feature row; the row is inserted disabled and the token survives.

**Fix:** Handle `AFTER INSERT` with `enabled=false`, and cascade on deletion of any M365 row. Add tests for absent-row → false and false-row deletion.

### H3. Direct feature-row mutation can evade the cascade

**Locations:**  
`0070_org_features.sql:44-46`  
`0075_explicit_api_grants.sql:118-121`  
`0101_m365_cascade_triggers.sql:152-161`

Operators have direct UPDATE privileges despite comments claiming the RPC is the sole write path.

An operator can rename an enabled row from `m365_integration` to `crm`, or move it to another `org_id`. The trigger checks `NEW.feature_key` and therefore returns without deleting connections from the old M365 org.

**Fix:** Make `feature_key` and `org_id` immutable, or remove direct client DML and permit only the RPC. Also cascade based on the old M365 row whenever its entitlement identity is lost.

### H4. `TRUNCATE org_features` bypasses row triggers

**Location:** `0075_explicit_api_grants.sql:118-121`

`anon` and `authenticated` are granted `TRUNCATE`. PostgreSQL RLS and row-level DELETE triggers do not protect TRUNCATE. A SQL-capable role can truncate the table, remove every entitlement row, and leave every M365 connection untouched.

The current REST surface may not expose arbitrary TRUNCATE, but this is an unsafe database privilege and a future RPC/SQL path would immediately bypass NFR-M365-107.

**Fix:** Revoke TRUNCATE, and preferably all direct feature-table DML, from client roles.

### H5. Token table does not enforce the user/org relationship

**Locations:**  
`0096_ms_graph_connections.sql:17-19,33`  
`0101_m365_cascade_triggers.sql:45-47,129`  
`0149_m365_cascade_triggers.test.sql:25-26,121-122`

`ms_graph_connections` has separate FKs to `organizations` and `profiles`, but no composite relationship enforcing that both belong to the same org.

The test itself inserts an Org-A connection for User C, whose profile belongs to Org B. If such a row exists, offboarding User C in Org B calls the core with Org B and leaves the Org-A row behind.

**Fix:** Add a composite `(user_id, org_id)` FK backed by a unique profile key, or make the offboard delete user-scoped independent of org. Correct the test fixture.

### H6. Explicit disconnect reports success when local deletion fails

**Location:**  
`supabase/functions/m365-token-custody/revoke.ts:59-70`

The delete result is ignored. A database/API error can leave the encrypted row present, then the function writes a revoked audit event and returns HTTP 200.

**Fix:** Inspect the delete error; do not emit success audit or return 200 unless deletion succeeded. Return a retryable failure and record an error event.

## Medium

### M1. Profile/org hard-delete paths bypass M365 auditing

**Locations:**  
`0001_init_schema.sql:50-52`  
`0002_rls.sql:47-49`  
`0096_ms_graph_connections.sql:17-19`  
`0101_m365_cascade_triggers.sql:134-138`

Profile deletion and `auth.users` deletion remove connection rows through FK cascades, so local token deletion normally occurs. However, no `m365.connection.revoked` audit event or Microsoft best-effort revoke occurs. Organization hard-delete has the same issue.

**Fix:** Prefer status-based offboarding; otherwise add audited delete handling or an explicit deletion RPC.

### M2. Cascade auditing is not concurrency-safe

**Location:**  
`0101_m365_cascade_triggers.sql:55-61`

The core audits rows in a SELECT loop, then deletes them separately. Concurrent cascades can both audit the same connection. A connection inserted between the SELECT and DELETE can be deleted without an audit event.

**Fix:** Delete with `RETURNING`, audit only returned rows, and serialize lifecycle transitions with row/advisory locks.

### M3. Tenant CHECK accepts `.` and `..`; runtime paths are not revalidated

**Locations:**  
`0102_m365_db_hardening.sql:17-19`  
`pmo-portal/src/lib/m365/graphPkce.ts:20,58-61`  
`refresh.ts:46-57`  
`revoke.ts:46`

The regex accepts valid GUIDs, `common`, `organizations`, `consumers`, and ASCII/punycode domains. It rejects slash, query, percent, whitespace, and newline payloads.

However, `.` and `..` also pass. URL normalization turns `.../../oauth2/...` into the parent path. The host remains pinned, so this is path confusion rather than arbitrary-host SSRF. Refresh/revoke also interpolate the DB value without runtime validation.

**Fix:** Reject `.` and `..`, validate exact tenant forms, and use a shared runtime validator before every token/revoke URL construction. Add tests for dot segments and malformed values.

Note: Phase 1 intentionally requires a concrete tenant GUID; although aliases are regex-valid, the callback rejects them because it compares `claims.tid` to the configured value.

### M4. `0149` does not prove the real offboard path

**Locations:**  
`0149_m365_cascade_triggers.test.sql:5-6,57,83-88,125-129,170-182`  
`0065_admin_set_user_status.sql:20-89`

The profile test updates `profiles` as superuser rather than calling `admin_set_user_status`. The operator feature UPDATE and DELETE paths are realistic, but the test does not cover:

- `admin_set_user_status → profiles` trigger;
- absent-row false INSERT;
- feature key/org mutation;
- TRUNCATE;
- profile/auth-user deletion;
- pending callback resurrection;
- org disable;
- `actor_id` correctness.

Also, `RESET ROLE` does not clear the transaction-local JWT claims, so the later public-RPC reason test is not a clean production-role test.

**Fix:** Add realistic Admin RPC coverage and negative-path tests.

## Low

### L1. PKCE sweep is unindexed and unbounded

**Locations:**  
`0102_m365_db_hardening.sql:31-39`  
`0098_m365_pkce_states.sql:15-21`

The function is safe and idempotent, but `expires_at` has no index and the DELETE is unbatched. An entitled Admin can create many abandoned states, causing periodic sequential scans and large deletes.

**Fix:** Add an `expires_at` index, batch cleanup, and rate-limit initiation.

### L2. System cascades have null audit actors

**Locations:**  
`0101_m365_cascade_triggers.sql:129,161,173`  
`0076_audit_events.sql:48-52`

`auth.uid()` is null for service-role/system actions. This does not suppress deletion; the trigger is guard-free, and `actor_id` is explicitly nullable for system events. It does reduce repudiation detail. The test does not assert actor identity on the authenticated operator path.

Also, `0080_service_role_grants.sql:20-28` means `service_role` can execute the supposedly internal core despite `REVOKE ... FROM PUBLIC`; this is acceptable for a trusted root role but the comments are technically inaccurate.

### L3. Entitlement helper semantics are inconsistent

**Locations:**  
`0070_org_features.sql:48-66`  
`supabase/functions/m365-token-custody/auth.ts:52-60`

`org_has_feature()` treats an absent row as enabled, while the M365 edge function treats an absent M365 row as not entitled. Current M365 authorization uses the latter, so this is not an active bypass, but future RLS enforcement using `org_has_feature('m365_integration')` could incorrectly admit default-off organizations.

## Explicit checks

- **`operator_toggle_feature`:** existing row `true → false` is an UPDATE and the trigger fires. Absent row `→ false` is an INSERT and does not.
- **`auth.uid()` null:** attribution loss only; no cascade suppression.
- **SECURITY DEFINER/search path:** new functions pin `search_path`; table/function references are schema-qualified. No search-path hijack or recursion issue found.
- **`pg_cron`:** fixed command, no parameters/secrets, public EXECUTE revoked, and cleanup is idempotent. Main risk is scale/performance.
- **`user_disconnect`:** current edge disconnect does **not** call `m365_disconnect_cascade`; it directly deletes through `service_role` and audits `reason='user_disconnect'`. Therefore dropping that reason from the DB core allowlist is not a current regression. A future direct RPC caller using it would receive `22023`.

**Final verdict: BLOCK.** NFR-M365-107 remains bypassable through pending OAuth callbacks, feature mutation/INSERT/TRUNCATE paths, inconsistent org/user rows, and the absent org-disable lifecycle.

LUNA-REVIEW-DONE

---

# Luna RE-VERIFY (round 2, gpt-5.6-luna:max) — 2026-07-16
Verdict: BLOCK. Luna EMPIRICALLY REPRODUCED the concurrent race locally (profile=disabled connections=1).
Deterministic fixes all landed; the residual is an MVCC TOCTOU in the unlocked write-guard.

# Part 1 — Finding closure

I read the prior Luna review first. I also verified the live database:

- `service_role` INSERT for disabled user: rejected `42501`.
- `service_role` UPDATE for disabled user: rejected `42501`.
- Active/entitled `service_role` UPDATE: succeeds.
- Concurrent callback/lifecycle probes reproduced **disabled/disentitled state with one connection remaining**.

| Finding | Status | Evidence |
|---|---|---|
| C1(a) PKCE purge | **CLOSED in isolation** | `_core` purges by user/org: `supabase/migrations/0103_m365_cascade_hardening.sql:76-89`; atomic consume: `stateStore.ts:55-68`. It does not prevent the concurrent race below after the callback already consumed state. |
| C1(b) write guard | **PARTIALLY CLOSED** | Trigger genuinely covers INSERT/UPDATE and fires for `service_role`: `0103_m365_cascade_hardening.sql:106-133`. However, checks at `:113-120` take no lock. A concurrent INSERT can pass on the old lifecycle state. |
| C1(c) callback error handling | **PARTIALLY CLOSED** | Pre-check and rejected-upsert handling are correct: `callback.ts:118-184`. The mocked race test `tokenCustody.callback.test.ts:241-268` is not a real concurrent database race. |
| H2 absent-row INSERT / disabled-row DELETE | **PARTIALLY CLOSED** | INSERT and broadened DELETE exist: `0103_m365_cascade_hardening.sql:145-194`; tested at `0149:153-218`. But `false → false` UPDATE does not cascade (`:153-162`), so stale rows can remain after a race or legacy state. |
| H3 feature identity mutation | **CLOSED** | Immutable trigger: `0103_m365_cascade_hardening.sql:203-221`; upsert changes only mutable columns: `0070_org_features.sql:88-91`; tests: `0149:221-239`. |
| H5(i) user-only cleanup | **CLOSED in code** | Single-user deletion uses `where user_id = p_user_id`: `0103_m365_cascade_hardening.sql:62-78`. |
| H5(ii) composite FK | **CLOSED in code** | `(user_id, org_id)` FK with `ON DELETE CASCADE`: `0103_m365_cascade_hardening.sql:230-236`. Profile org changes fail with `23503`; profile deletion cascades the connection. |
| H5(iii) buggy fixture | **CLOSED** | All seeded connection/profile orgs now agree: `0149_m365_cascade_triggers.test.sql:56-66`. The test does not directly assert a mismatched insert fails. |
| H6 revoke deletion error | **CLOSED for the reported failure** | Delete errors now return `503`, record an error event, and skip success audit: `revoke.ts:67-97`; tests: `tokenCustody.hardening.test.ts:65-106`. |
| M2 audit/delete race | **CLOSED** | `DELETE ... RETURNING` audits only rows actually deleted: `0103_m365_cascade_hardening.sql:70-87`. |
| M3 tenant validation | **CLOSED for the reported path-confusion issue** | Tightened DB check: `0103_m365_cascade_hardening.sql:245-255`; shared runtime validation: `graphPkce.ts:34-56`; callback/refresh/revoke validation: `callback.ts:55-65`, `refresh.ts:52-61`, `revoke.ts:47-55`. |
| M4 lifecycle-test gap | **PARTIALLY CLOSED** | Real RPC paths and actor assertions now exist: `0149:79-132`. Trigger disabling is transactional and intentionally simulates legacy data (`:157-162`, `:207-210`), but the test still does not prove concurrent races or the service-role callback path. |
| L1 PKCE sweep | **PARTIALLY CLOSED** | Expiry index added: `0103_m365_cascade_hardening.sql:258-260`. Cleanup remains one unbatched `DELETE`, and initiation is not rate-limited: `0102_m365_db_hardening.sql:34-39`, `initiate.ts:40-50`. |

## Remaining C1 write paths

Sequentially, the guard blocks callback/service-role writes for disabled users and disentitled orgs. However, **a normal concurrent callback path can still create a connection after lifecycle disablement**.

The deliberately out-of-scope `TRUNCATE org_features` path also remains able to leave existing connections behind (`0075_explicit_api_grants.sql:118-121`).

# Part 2 — New or remaining defects

## Critical

### C1-RACE — write guard is TOCTOU-vulnerable

**Scenario**

1. Callback transaction inserts a new connection while profile is active and entitlement is true.
2. The guard reads the old values and leaves the insert uncommitted.
3. `admin_set_user_status` disables the user, or `operator_toggle_feature` disables M365.
4. The AFTER trigger deletes rows visible to its snapshot, but cannot see the callback’s uncommitted new row.
5. Lifecycle transaction commits; callback commits afterward.

Observed locally:

- `profile=disabled connections=1`
- `feature=false connections=1`

**Evidence:** `0103_m365_cascade_hardening.sql:113-122`; lifecycle deletes at `:153-170`; callback upsert at `callback.ts:151-184`.

**Fix:** Lock the profile row and entitlement row in the write guard with `FOR UPDATE`, using the same lock ordering as lifecycle updates, or use a shared transaction-scoped advisory lock. Add a real concurrent integration test. Also make disabled/false lifecycle cleanup idempotent on repeated writes.

## High

### Same-tenant OAuth user binding remains incomplete

The callback validates only `tid`; it never compares `claims.oid` with the expected Microsoft identity for the PMO user.

A PMO Admin can initiate a flow, send the authorize URL to another user in the same Entra tenant, and store that victim’s tokens in the attacker’s PMO connection. `tid` matches, so the new check passes.

**Evidence:** `callback.ts:92-105`, `callback.ts:151-158`; state binds only to PMO user/org in `initiate.ts:20-50`.

**Fix:** Bind the callback to a previously verified Entra object ID, and validate the ID token issuer, audience, signature, `tid`, and `oid`.

### Conditional migration deployment failure

The composite FK and tightened tenant CHECK validate existing rows immediately:

**Evidence:** `0103_m365_cascade_hardening.sql:230-236`, `:245-252`.

A legacy mis-org connection or legacy `..` tenant value causes migration 0103 to abort, leaving all hardening unapplied.

**Fix:** Add a preflight/data-reconciliation step before adding constraints, or explicitly gate deployment on zero violating rows.

## Medium

### Refresh ignores write-guard failures

`refreshAccessToken` ignores the result of the token-row UPDATE, then audits success and returns `true`.

**Evidence:** `refresh.ts:98-118`; stale/revoked updates also ignore errors at `:133-170`.

During a lifecycle race, refresh can report `m365.token.refreshed` even though the update was rejected or the row disappeared.

**Fix:** Check update errors and affected-row identity. Emit lifecycle/error outcomes only after persistence succeeds.

### User-only cascade deletes are unindexed

The new user-only deletes use `user_id`, but existing indexes lead with `org_id`.

**Evidence:** deletes at `0103_m365_cascade_hardening.sql:70-78`; indexes only at `0096_ms_graph_connections.sql:38` and `0098_m365_pkce_states.sql:21`.

**Fix:** Add indexes on `ms_graph_connections(user_id)` and `m365_pkce_states(user_id)`.

### Repeated disabled/false state does not repair stale rows

- Profile trigger fires only on transition to disabled: `0101_m365_cascade_triggers.sql:134-138`.
- Feature trigger fires only `true → false`: `0103_m365_cascade_hardening.sql:153-162`.

If a stale row survives a race, repeating “disable” or “toggle false” does not remove it.

**Fix:** Cascade whenever the final state is disabled/false, or add a repair/scrub path.

## Low

- Revoke treats a concurrent zero-row DELETE as success because it checks only `deleteError`, not returned row identity: `revoke.ts:72-97`. Use `DELETE ... RETURNING`.
- PKCE sweep is indexed but still unbatched and initiation is unrate-limited: `0102_m365_db_hardening.sql:34-39`.
- `isValidTenant` accepts aliases/domains, while callback requires an exact concrete tenant GUID: `graphPkce.ts:17-41`, `callback.ts:99-105`. This fails closed but can reject valid misconfigured deployments.
- Trigger functions retain public EXECUTE privilege, though PostgreSQL rejects direct scalar invocation of trigger functions. Revoke for least-privilege hygiene.

## Requested checks

- **(a)** Active refresh/revoke flows work. Mid-lifecycle UPDATEs correctly fail closed, but refresh mishandles the error.
- **(b)** Profile org moves fail with FK violation; no orphan is created. Profile deletion cascades connections. Default `ON UPDATE NO ACTION` is appropriate.
- **(c)** `operator_toggle_feature` leaves identity columns unchanged; no false immutability failure.
- **(d)** Enable INSERT does not cascade; no recursion. The concurrency race remains.
- **(e)** Test trigger disable/enable is transactional, but intentionally bypasses production behavior and does not prove a real race.
- **(f)** Fixture entitlement additions do not weaken prior assertions; lockdown grants remain revoked.
- **(g)** The guarded public RPC remains org-safe for Admins: `0101_m365_cascade_triggers.sql:92-103`. Operators are intentionally cross-org. The user-only cleanup can delete a legacy mis-org row, by design.
- **(h)** Added functions are SECURITY DEFINER with `search_path=public`; no exploitable search-path or privilege issue found.

Out-of-scope residuals remain as requested: no org-disable lifecycle (`0001_init_schema.sql:30-34`), TRUNCATE bypass, and `org_has_feature` default-enabled absence semantics. Profile/auth hard deletes also still remove connections without M365 audit/revoke.

# Final verdict

**BLOCK.** The deterministic fixes are present, but NFR-M365-107 is still bypassable through a real concurrent callback/lifecycle race. Add lifecycle/write serialization, repair stale-state transitions, handle refresh persistence errors, and re-run the DB gate.

LUNA-REVERIFY-DONE

---

# Luna ROUND 3 (gpt-5.6-luna:max) — 2026-07-16
Verdict: BLOCK. **C1 token-resurrection CONFIRMED CLOSED** (both callback-first AND lifecycle-first verified).
Residual: (HIGH) preflight regex escaping bug can abort 0103 so the hardening never installs;
(MED) REPRODUCED refresh/lifecycle deadlock — the Director's 'deadlock-free' claim was WRONG:
an UPDATE locks the child connection tuple BEFORE its BEFORE-trigger reaches the parent, while the
cascade goes parent->child. Liveness/DoS, not a token bypass. (MED) no one-time scrub for
already-stale rows. (LOW) probe proves less than claimed.

## Part 1 — C1-RACE

**Verdict: CLOSED for token-custody safety.** The original callback/lifecycle TOCTOU no longer leaves a committed token.

Evidence:

- Callback-first probe: user and feature modes both returned **0 surviving connections**.
- Lifecycle-first probe: callback failed with `user_not_active` / `org_not_entitled`; connection count remained **0**.
- pgTAP: **168 files / 1,381 tests passed**.
- Unit tests: **10 files / 81 tests passed**.

Reasoning:

- Callback-first: `FOR UPDATE` locks `profiles`, then `org_features`; lifecycle waits, then its cascade sees and deletes the committed row.
- Lifecycle-first: the guard waits and, under READ COMMITTED, rechecks the committed disabled/disentitled value and rejects.
- Missing rows are safe: the guard rejects before the connection write.
- Savepoints, subtransactions, and stronger isolation can abort or roll back the write; none create a committed unsafe row.

However, the migration’s **“deadlock-free” claim is false**. I reproduced a real deadlock for existing-connection updates:

1. Lifecycle transaction holds the profile/feature row.
2. Refresh `UPDATE ms_graph_connections` locks the connection tuple, then the BEFORE trigger waits for the parent row.
3. Lifecycle AFTER-trigger cascade tries to delete the connection and waits for the refresh transaction.

Both user-disable and feature-disable variants produced PostgreSQL `deadlock detected`. The lifecycle committed and the connection count was 0, so this is a liveness/DoS defect, not a token-resurrection bypass.

## Part 2 — Closure table

| Finding | Status | Evidence |
|---|---|---|
| Migration preflight HIGH | **NOT CLOSED** | `0103:249-253` uses `~ '\\.\\.'`; with `standard_conforming_strings=on`, `foo..bar` is not matched. The new CHECK rejects it, so migration can still abort before hardening applies. |
| Refresh persistence MEDIUM | **CLOSED for success path** | `refresh.ts:105-126` checks both error and returned row before success audit. Tests cover rejection and zero-row updates. |
| User-scoped delete indexes MEDIUM | **CLOSED** | `0104:179-180`; live indexes exist and `EXPLAIN` uses them. |
| Stale-state repair MEDIUM | **PARTIAL** | Repeated disabled/false writes repair stale rows; AC-M365-161/162 pass. But no one-time migration scrub removes already-stale rows if no later lifecycle write occurs. |
| Revoke zero-row LOW | **CLOSED** | `revoke.ts:73-100` uses `DELETE ... RETURNING`; zero-row deletion is not reported as success. |
| Batched sweep LOW | **PARTIAL** | `LIMIT 1000 / SKIP LOCKED` bounds statements, but the loop remains one transaction; deleted-row locks persist until function return. |
| Trigger EXECUTE LOW | **CLOSED for client roles** | Public execute is revoked (`0104:217-220`). Live ACL retains only `postgres`/`service_role`, both trusted. |

## Part 3 — New or residual findings

### High — migration preflight still permits deployment failure

**Location:** `supabase/migrations/0103_m365_cascade_hardening.sql:249-253`

`foo..bar` was accepted by the old 0102 constraint, is rejected by the new constraint, but survives the preflight. This can abort 0103 before the composite FK and write guard are installed.

**Fix:** use `~ '\.\.'` or `E'\\.\\.'`; add a populated-upgrade test for `foo..bar`.

### Medium — real refresh/lifecycle deadlock

**Locations:** `0104_m365_race_lock.sql:70-85`, `0104:146-165`, `refresh.ts:105-117`

The guard locks parent rows only after an UPDATE has locked the child connection row. The lifecycle cascade takes the reverse path.

**Fix:** perform connection mutations through a transaction/RPC that locks `profiles → org_features` before touching the connection row, or redesign the cascade lock protocol and add a two-session deadlock regression test.

### Medium — pre-existing stale rows are not scrubbed

The idempotent triggers repair only when a profile or feature row is subsequently updated. A stale token for an already-disabled user or already-false entitlement can remain indefinitely.

**Fix:** add a transactional migration/deployment reconciliation for disabled users and disentitled/missing entitlements, with audit or quarantine handling.

### Low — cascade work on unrelated updates

`0104:123-127` and `0104:146-165` run cleanup on every update whose final state is disabled/false. This is safe and indexed, but can cause unnecessary per-profile work or full-org scans.

**Fix:** restrict triggers to relevant columns or provide a separate periodic repair scrub.

### Low — race probe proves less than claimed

- It drives direct `postgres` SQL, not the real RPC/auth path.
- It only tests callback-first INSERT.
- `sleep 2` is not a synchronization guarantee.
- A/B process exit codes are ignored.
- `COUNT = 0` does not prove both statements succeeded.
- The documented wrapped invocation deadlocks recursively because `with-db-lock.sh` does not set `PMO_DB_LOCK_HELD`; I reproduced the timeout.

**Fix:** make the wrapper cooperative, assert process success and final lifecycle state, and use explicit readiness/lock synchronization.

The preflight intentionally deletes rows violating the new FK/check; no conforming rows are targeted, and failed DDL rolls the deletes back. But successful deployment irreversibly deletes ciphertext without audit or quarantine.

The same-tenant `oid` binding remains owner-pending and is excluded as requested. H4 grants, org-disable lifecycle, absence semantics, and hard-delete audit gaps are also excluded.

## Final verdict

**BLOCK**

C1 token resurrection is closed, but the migration can still fail to install the protection, and the new lock protocol has a reproducible production-path deadlock. No Critical finding; High findings remain.

LUNA-ROUND3-DONE

---

# Luna ROUND 4 (gpt-5.6-luna:max) — 2026-07-17
## Verdict: **SHIP-WITH-FIXES** — the BLOCK is CLEARED.
No new High/Critical on the public edge surface; disabled-user + disentitled-org RPC bypass attempts
rejected LIVE with 42501. All round-3 findings closed. Residual = 3 MED + 3 LOW (below).

## Part 1 — Round-3 closure

| Finding | Closed? | Evidence |
|---|---|---|
| C1 token resurrection | **Yes, intended paths** | Locked guard: `0104_m365_race_lock.sql:107-120`; callback RPC: `callback.ts:159-173`; refresh/status RPCs: `refresh.ts:109-126,155-194`. Live race probes passed both interleavings for user and feature targets, with zero surviving rows. |
| 0103 preflight escaping | **Yes for `foo..bar`; test proof partial** | Correct regexes: `0103_m365_cascade_hardening.sql:270-279,304-311`. `0151:53-101` proves buggy regex=false, fixed regex=true, deletion, audit, and successful CHECK creation. It replays the relevant upgrade sequence rather than applying the complete migration to a legacy populated database. |
| Refresh/lifecycle deadlock | **Yes for matching production edge paths; not globally** | All callback/refresh/status mutations use parent-first RPCs. Live deadlock probe: legacy mode reproduced the deadlock; fixed mode had no deadlock for both targets. Remaining exceptions are Part-2 findings below. |
| Already-stale scrub | **Yes** | Transactional `DELETE ... RETURNING` scrub with per-row audit: `0105_m365_lock_order_and_reconcile.sql:182-205`. 0103 preflight mis-org and bad-tenant deletes are also audited: `0103:259-279`. Re-running cleanly is idempotent. |
| Trigger column scoping | **Yes** | Profile trigger is `UPDATE OF status` with final-state repair: `0104:143-148`. Feature trigger is `UPDATE OF enabled`: `0104:199-206`. `0150:106-165` proves both self-repair paths and no false cleanup on enable. |
| Refresh success persistence | **Yes** | RPC error and returned ID are checked before success audit: `refresh.ts:109-136`. |
| User indexes / revoke zero-row handling / trigger EXECUTE lockdown | **Yes** | Indexes: `0104:213-214`; revoke `DELETE ... RETURNING`: `revoke.ts:73-100`; trigger EXECUTE revocation: `0104:251-254`. |
| Probe honesty | **Mostly** | Exit codes and final counts are asserted: `m365-race-probe.sh:165-197`; deadlock outcomes are checked: `m365-deadlock-probe.sh:140-150`. Recursive wrapper locking is fixed at `with-db-lock.sh:55-59` and worked live. The probes explicitly remain direct-SQL probes, not full OAuth/JWT HTTP tests; `q()` still suppresses some diagnostic errors. |

All executable regexes in 0103/0104/0105 are correctly escaped under `standard_conforming_strings=on`; 0104 and 0105 contain no executable regexes.

## Part 2 — New findings

### MEDIUM — RPC connection identity is not bound

**Location:** `supabase/migrations/0105_m365_lock_order_and_reconcile.sql:115-130,154-165`

`m365_refresh_connection` and `m365_set_connection_status` lock parents using `p_org_id/p_user_id`, but update solely with `where id = p_connection_id`.

**Verified live:**

- A connection belonging to Org A/User A was updated successfully while passing Org B/User B parameters.
- A mismatched call can deadlock: lifecycle holds User A’s profile and waits for the connection; the RPC locks User B’s profile, locks the child, then the guard waits for User A. PostgreSQL reported `deadlock detected`.

**Fix:** Add `org_id = p_org_id AND user_id = p_user_id` to both UPDATE predicates, reject mismatches, and add mismatch/deadlock regression tests.

### MEDIUM — `service_role` retains direct child-first DML

**Locations:** `supabase/migrations/0080_service_role_grants.sql:20-28`; `0104_m365_race_lock.sql:81-97`

The current edge code has no direct INSERT/UPDATE path:

- callback → `m365_upsert_connection`
- refresh/status → `m365_refresh_connection` / `m365_set_connection_status`
- revoke performs only direct DELETE: `revoke.ts:73-78`

However, live catalog inspection confirms `service_role` still has INSERT/UPDATE/DELETE on `ms_graph_connections`. A future or stray service-role UPDATE can reproduce the old child→parent deadlock. Direct DELETE does not form the same cycle because the guard is only INSERT/UPDATE-scoped.

**Fix:** Remove direct service-role INSERT/UPDATE/DELETE access and provide a parent-first delete RPC; retain only narrowly required reads.

### MEDIUM — Status RPC failures ignore returned-row identity

**Locations:** `refresh.ts:155-180,188-213`; RPC contract `0105:161-165`

The handler checks `markError` but ignores `data`. A zero-row status RPC returns `NULL`, yet the code still audits `stale` or `revoked`.

**Impact:** A reuse event can be recorded without actually marking the row revoked; a transient persistence error can leave the row active.

**Fix:** Require both `!markError` and a non-null returned connection ID before emitting the state-success audit. Retry or fail closed when revocation persistence fails.

### LOW — 0103 preflight overmatches leading-dot values

**Locations:** `0103_m365_cascade_hardening.sql:270-275` vs `:304-311`

`entra_tenant_id ~ '^[.]+'` matches `.foo`, but the installed CHECK accepts `.foo`. Live evaluation confirmed:

- preflight matches `.foo`
- final CHECK accepts `.foo`

This can delete a legacy row that the final schema considers valid.

**Fix:** Change the preflight predicate to `^[.]+$`, or tighten the final CHECK/runtime validator consistently.

### LOW — Tests do not enforce the new RPC call shape

**Location:** `pmo-portal/src/lib/m365/__tests__/m365MockDeps.ts:108-165`

The mock preserves ciphertext, IDs, errors, and behavioral assertions, so existing test intent is retained. But it synthesizes writes and does not require the production code to call the lock-order RPC. A regression to direct `.from(...).update()` could leave unit tests green.

**Fix:** Add explicit assertions for `m365_upsert_connection`, `m365_refresh_connection`, and `m365_set_connection_status`, or make direct connection writes fail in the mock.

### LOW — `0151` is not a full populated-upgrade test

**Location:** `supabase/tests/0151_m365_lock_order_reconcile.test.sql:58-101,190-205`

It accurately proves the `foo..bar` failure sequence and scrub predicate, but manually replays migration logic after the hardened schema already exists. It does not apply 0103/0105 to a pre-hardening populated database.

**Fix:** Add a migration-upgrade fixture that seeds legacy rows before applying the migrations.

### Scrub assessment

The 0105 scrub is stale-only, transactional, per-row audited, and idempotent. It cannot delete a conforming active+entitled connection. The only deletion mismatch is the leading-dot preflight issue above.

### `with-db-lock.sh`

No finding. `PMO_DB_LOCK_HELD=1` is child-only and advisory. Scripts that ignore it are unaffected; the M365 probes honor it. The documented wrapped invocation worked live.

## Final verdict

**SHIP-WITH-FIXES**

No new High/Critical finding was verified on the current public edge surface. The disabled-user and disentitled-org RPC bypass attempts were rejected live with `42501`. The same-tenant Microsoft `oid` binding remains owner-pending and is excluded as instructed.

The RPC identity binding, service-role direct-DML seam, and status-result handling should be fixed before claiming the lock-order redesign is universally safe.

LUNA-ROUND4-DONE
