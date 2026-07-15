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
