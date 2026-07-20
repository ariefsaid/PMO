# Microsoft 365 integration — Phase 1 (Graph Token Custody Runtime) — spec

- **Status:** Draft for Director/owner review.
- **Controlling ADRs (ACCEPTED, binding):** [ADR-0058](../adr/0058-microsoft-365-integration-architecture.md)
  (integration architecture: auth≠authz, Graph-follows-ADR-0055, two-switch entitlement,
  agent-tier-unchanged, topology-independent, shared token lifecycle),
  [ADR-0059](../adr/0059-entra-app-registration-topology.md) (Entra app topology — Option C default),
  [ADR-0060](../adr/0060-microsoft-graph-token-custody.md) (**the ten binding token-custody controls
  encoded below as NFRs**). **Related:** ADR-0049 (two-switch entitlement / `org_features` /
  `operator_toggle_feature`), ADR-0055/0056 (external adapters + watermarks), ADR-0001 (org_id seam),
  ADR-0019 (security-definer RPC boundary), ADR-0076/0071 (audit_events / error_events),
  ADR-0016 (FE authz UX-only / RLS-as-ceiling), ADR-0010 (test pyramid).
- **Vision:** [`docs/microsoft-365-integration.md`](../microsoft-365-integration.md) §2 (two-switch
  primitive), §3.2 (OneDrive doc linking — the Phase-1 consumer), §4 (Phase 1).
- **Scope:** the **live token-custody edge function** that implements the server-side
  **authorization-code + PKCE bootstrap (ADR-0060 §1 D2)**, **AES-256-GCM envelope encryption
  (ADR-0060 §3 D1)**, **Graph proxy (server-side decrypt → call Graph → return data)**, **refresh
  rotation + stale/revoke handling**, **explicit revoke/disconnect**, and **audit emission** — all
  scoped to the **entitled org's Admin** connecting **their own** `ms_graph_connections` row. This
  spec does **NOT** cover the OneDrive doc-linking UI or any Graph *data* feature; those are
  separate Phase-1+ specs that consume this runtime.

---

## 1. Context

Phase 0 delivered the hardened foundation: the `ms_graph_connections` table (encrypted columns,
forced RLS, zero client policy, status lifecycle, `key_id` KEK reference, unique `(org_id, user_id)`),
the two-switch entitlement/config surface (Operator entitles `m365_integration` via
`operator_toggle_feature`; org-Admin sees the connection card), and the provisioning-model open
question pinned to the shipped graceful not-provisioned state. Phase 1 now builds the **live edge
function runtime** around that store — the OAuth code exchange, the encryption/decryption, the Graph
proxy, refresh rotation, revocation, and audit — so that the OneDrive doc-linking feature (and
every later Graph feature) has a security-audited token layer to consume.

The **binding controls from ADR-0060 are not re-litigated here**; they are encoded as NFRs below and
the `security-auditor` gate (ADR-0060 "Mandatory gate") is **mandatory before this edge function
ships**. The two sub-decisions D1 (encryption) and D2 (bootstrap) were owner-ratified 2026-07-14:
**D1 = app-layer AES-256-GCM in the edge function**, **D2 = server-side auth-code + PKCE**.

---

## 2. Non-functional requirements — the ten binding token-custody controls (ADR-0060)

Each maps 1:1 to an ADR-0060 control. Phase 0 encoded several **structurally** (table shape, RLS,
grants); Phase 1 encodes them **behaviorally** in the edge function. Each NFR names its ADR-0060
control number for traceability.

- **NFR-M365-101 (Confidential-client, server-only custody — control 1).** The Microsoft **refresh
  token** and **access token** shall be held and exercised **exclusively server-side** in the edge
  function. They shall **never** transit or persist in the browser, `localStorage`, or any
  client-readable surface (including response bodies, logs, error messages, or Supabase Realtime).
- **NFR-M365-102 (Proxied Graph calls — control 2).** All Graph calls shall be **proxied**:
  browser → PMO edge function → Microsoft Graph. The client shall receive **only the resulting
  data**; no Microsoft access or refresh token shall ever be returned to the front-end.
- **NFR-M365-103 (Envelope encryption at rest — control 3).** Tokens shall be stored **only
  encrypted** via envelope encryption: AES-256-GCM in the edge function (`graphTokenCrypto.ts`),
  KEK fetched from Supabase secrets / vault-`AS` at function cold-start, referenced by `key_id`
  stored alongside the ciphertext. **No plaintext token column shall ever exist.**
- **NFR-M365-104 (Dedicated, locked-down table — control 4).** The edge function shall write and
  read `ms_graph_connections` **exclusively via `service_role`** (or a security-definer RPC). The
  table's RLS remains **enabled + FORCED with zero policies**; `authenticated`/`anon` have **zero**
  access. The function shall set `org_id` explicitly from the verified caller's profile (mirroring
  `credits`/`org_features` cross-org service-definer exclusion in migration `0074`).
- **NFR-M365-105 (Least-privilege incremental consent — control 5).** The system shall request the
  **minimum Graph scopes per feature, at point of use** (e.g. `Files.Read` + `offline_access` for
  OneDrive doc linking; separate consent for Teams/Calendar/Planner). Scopes shall be stored per
  connection row and re-requested incrementally when a new feature is activated.
- **NFR-M365-106 (Rotation + reuse/failure handling — control 6).** On every refresh the function
  shall persist the **newest rotated refresh token**; on `invalid_grant` / revocation / expiry it
  shall mark the connection **`stale`** and drive **re-consent** (never a silent retry-loop).
  Unexpected refresh-token **reuse** shall be treated as a **security event** (logged to
  `error_events` / `audit_events`, connection invalidated).
- **NFR-M365-107 (Revocation & lifecycle — control 7).** The system shall support explicit
  user/admin **disconnect** (delete stored tokens + best-effort revoke at Microsoft), and shall
  **delete** stored tokens on user offboard / org disable / feature disentitlement (tying into the
  Entra-offboard feature and the ADR-0049 entitlement switch).
- **NFR-M365-108 (Audit without secret leakage — control 8).** Token issuance / refresh / use /
  revoke shall be logged to `audit_events` / `error_events` with **metadata only** (connection id,
  scope set, outcome, actor) — **never** a token value, and never a token in any error string or
  log line.
- **NFR-M365-109 (Blast-radius contained by topology — control 9).** Under siloed deployment each
  client's tokens live only in that client's Supabase project with a per-project KEK; the `org_id`
  scope + per-tenant key derivation is the isolation boundary the seam anticipates for a future
  pooled model.
- **NFR-M365-110 (Transport & secret hygiene — control 10).** HTTPS only; the app client secret
  (`M365_CLIENT_SECRET`) and the KEK shall live in vault-`AS` / Supabase secrets on a **rotation
  schedule**, held solely by the edge function.

---

## 3. Functional requirements

### 3.1 Authorize-URL initiation (PKCE bootstrap — ADR-0060 §1 D2)

- **FR-M365-101 (Event-driven).** When an entitled org's Admin clicks "Connect Microsoft 365" on
  the Integrations card, the FE shall call the edge function `m365-token-custody` with
  `action: 'initiate_connect'`. The function shall:
  - Verify the caller's JWT (local JWKS verification per `adapter-dispatch` precedent), resolve
    their `org_id` and `user_id` from `profiles` (RLS-scoped read under caller JWT, mirrors the
    deputy-auth pattern).
  - Assert the caller's real JWT role is `Admin` **and** the org has `m365_integration` entitlement
    (`useFeature('m365_integration')` true) — FE gate mirrors this (ADR-0016); RLS is enforcement.
  - Generate a **high-entropy PKCE `code_verifier`** via `graphPkce.generateCodeVerifier()` and
    compute its `code_challenge` via `graphPkce.codeChallengeS256()`.
  - Generate a **cryptographically random `state`** (>= 128 bits, base64url) for CSRF protection.
  - **Store server-side** (in a transient, TTL-ed, `service_role`-only store — e.g. a dedicated
    `m365_pkce_states` table with `org_id`, `user_id`, `code_verifier`, `state`, `scopes`,
    `created_at`, `expires_at`; RLS forced, zero client policy) the `code_verifier` and `state`
    keyed to the `org_id` + `user_id`. **Never return the `code_verifier` to the client.**
  - Determine the **Entra tenant identifier** for the authorize URL: for Option C (per-client app in
    vendor tenant) this is the **client's tenant ID** (stored in the per-project config / vault-`AS`
    alongside the client secret); for Option B it is the client's tenant ID. The tenant value is
    validated against `graphPkce.TENANT_RE` (`^[A-Za-z0-9._-]+$`) before interpolation.
  - Build the Microsoft authorize URL via `graphPkce.buildAuthorizeUrl({ tenant, clientId,
    redirectUri, scopes: ['Files.Read', 'offline_access'], state, codeChallenge })`. The `redirectUri`
    is the **allowlisted edge function callback URL** (e.g. `https://<project>.supabase.co/functions/v1/m365-token-custody/callback`),
    configured per-project and pinned in the Entra app registration.
  - Return `{ authorizeUrl, state }` to the FE. The FE redirects the user's browser to
    `authorizeUrl`.

- **FR-M365-102 (State-driven — CSRF guard).** While the OAuth round-trip is in flight, the
  transient `m365_pkce_states` row shall be **single-use** and **short-TTL** (e.g. 10 minutes).
  On callback, the function shall **consume** (delete) the row after verifying `state` matches —
  preventing replay and fixing the CSRF window.

- **FR-M365-103 (Where — open-redirect safe redirect URI).** Where the redirect URI is constructed,
  it shall be a **hard-coded allowlisted value** (per-project env / secret), never derived from
  caller input. The Entra app registration shall have **exactly this URI** in its redirect URI list.

### 3.2 Callback / code exchange (confidential client — ADR-0060 §1 D2)

- **FR-M365-110 (Event-driven).** When Microsoft redirects to the edge function callback endpoint
  (`GET /callback?code=...&state=...`), the function shall:
  - Look up the `m365_pkce_states` row by `state` (service-role read). If not found or expired,
    return a user-facing error page (no token leakage) and log an `error_event` (invalid/expired
    state).
  - Verify the `state` matches the stored value. **Delete the row** (single-use consumption).
  - Retrieve the stored `code_verifier` and `scopes`.
  - **Fetch the confidential-client secret (`M365_CLIENT_SECRET`) from Supabase secrets / vault-`AS`**.
    **Never from the DB, never from the client.** (ADR-0060 §10.)
  - POST to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` with
    `grant_type=authorization_code`, `code`, `code_verifier`, `client_id`, `client_secret`,
    `redirect_uri`. **HTTPS only.** Pin the token endpoint host to `login.microsoftonline.com`.
  - On success: receive `access_token`, `refresh_token`, `expires_in`, `token_type`, `scope`.
  - **Encrypt the refresh token** via `graphTokenCrypto.encryptToken(refresh_token, kekBytes)` →
    `refresh_token_ciphertext` (serialized envelope `iv || ciphertext+tag` via
    `serializeEnvelope`). **Encrypt the access token** similarly → `access_token_ciphertext`.
  - **Upsert** `ms_graph_connections` (service-role write) with:
    - `org_id` (from the PKCE state row's `org_id`), `user_id` (from state row's `user_id`),
    - `entra_tenant_id` (the tenant used in the exchange), `entra_user_object_id` (from the ID
      token `oid` claim if returned, or a subsequent `/me` call),
    - `scopes` (the granted scope array), `refresh_token_ciphertext`, `access_token_ciphertext`,
    - `access_token_expires_at = now() + expires_in seconds`,
    - `refresh_token_expires_at` (Microsoft does not return this; set to a conservative far-future
      sentinel or `null` — the `stale` status handles revocation),
    - `key_id` (the KEK reference, e.g. `kek-v1`), `status = 'active'`,
    - `connected_at = now()`, `last_refresh_at = now()`.
  - **Audit:** call `log_audit('m365.connection.initiated', org_id, actor_id, connection_id,
    jsonb_build_object('scopes', scopes, 'entra_tenant_id', entra_tenant_id))`.
  - Redirect the browser to the FE Integrations page with a success indicator (no tokens in URL).

- **FR-M365-111 (Error handling — no secret leakage).** On any token-exchange failure (network,
  Microsoft error `invalid_grant`, `unauthorized_client`, etc.), the function shall:
  - Log an `error_event` with `fn='m365-token-custody'`, `error_code` (e.g. `TOKEN_EXCHANGE_FAILED`),
    `context_id=state`, `org_id`, and **metadata only** (Microsoft `error`/`error_description`
    sanitized — never the `code`, `code_verifier`, or `client_secret`).
  - Render a user-friendly error page redirecting to the FE with a generic "Connection failed"
    message.

- **FR-M365-112 (State-driven — same-tenant identity binding via trust-on-first-use; owner decision
  2026-07-17).** While a callback presents an id_token whose `oid` claim is being bound to an
  `(org_id, user_id)` connection, the system shall bind the Microsoft USER identity — not just the
  tenant (`tid`, FR-M365-111) — using trust-on-first-use (TOFU) + enforce-on-reconnect:
  - **FIRST connect** (no existing `ms_graph_connections` row, OR a row whose `entra_user_object_id`
    IS NULL): ACCEPT and **PIN** the id_token's `oid` as `entra_user_object_id` (the trust event).
  - **RECONNECT** (an existing row whose `entra_user_object_id` is NON-NULL): the presented `oid`
    MUST equal the pinned value. **On MISMATCH**, the system shall reject **BEFORE any encrypt/upsert**
    (no token stored): emit a sanitized `M365_IDENTITY_MISMATCH` `error_event` (NO token material, NO
    raw oid in any client-facing message), emit an `m365.connection.identity_mismatch` `audit_events`
    row (the forensic trail — oids are public Microsoft identifiers, not secrets), and redirect to
    the FE error page with a generic message.
  - This invariant is **ENFORCED STRUCTURALLY at the DB boundary**: a `BEFORE UPDATE` trigger makes
    `entra_user_object_id` **write-once** (`NULL`→value allowed as TOFU; value→different and
    value→NULL raise errcode `42501`), so identity re-binding is impossible even if a future code
    path forgets the callback pre-check. *(Closes the Luna round-2 HIGH "Same-tenant OAuth user
    binding remains incomplete" — a PMO Admin could otherwise initiate a connect, phish the authorize
    URL to a different person in the SAME Entra tenant, and store the victim's tokens in the
    attacker's connection; `tid` matched so the tenant check passed. SSO-identity binding was
    explicitly NOT taken — it would break connect for email/password PMO users who have no SSO
    principal to bind.)*

  **Residual risk (documented, owner-accepted 2026-07-17):** the FIRST connect remains phishable
  WITHIN the tenant — an attacker who initiates AND completes the first connect can harvest their
  own victim's tokens once. TOFU bounds that exposure to exactly one event; every subsequent
  reconnect is pinned. This is the accepted trade-off for not requiring SSO-identity binding.

### 3.3 Encrypt-at-rest (AES-256-GCM envelope — ADR-0060 §3 D1)

- **FR-M365-120 (Ubiquitous).** The edge function shall use **only** `graphTokenCrypto.encryptToken`
  and `decryptToken` for all token encryption/decryption. The KEK (`keyBytes`) shall be fetched
  **once at cold-start** from `Deno.env.get('M365_TOKEN_KEK')` (Supabase secret) and cached in the
  function's module scope. The `key_id` stored with each row shall be the **KEK reference** (e.g.
  `kek-v1`), **never the key itself**. Key rotation is an ops runbook (update secret, bump `key_id`,
  re-encrypt rows via a maintenance RPC) — not in this spec.

- **FR-M365-121 (State-driven — decrypt path).** When the function needs a plaintext access token
  (Graph proxy, refresh), it shall:
  - Read the row (service-role), extract `refresh_token_ciphertext` / `access_token_ciphertext`
    and `key_id`.
  - Verify the `key_id` matches the currently loaded KEK reference (if rotated, the old KEK must
    still be available for decryption until all rows are re-encrypted; the function may support a
    small KEK map keyed by `key_id`).
  - `deserializeEnvelope(bytea)` → `{ iv, ciphertext }` → `decryptToken(ciphertext, iv, kekBytes)`.
  - **Never log** the plaintext. Use `try/finally` to zero/clear local variables where feasible
    (Deno/JS GC limits apply; the principle is defense-in-depth).

### 3.4 Graph proxy (server-side decrypt → call Graph → return data)

- **FR-M365-130 (Event-driven).** When the FE (or a server-side automation) needs Graph data, it
  calls the edge function `m365-token-custody` with `action: 'graph_proxy'`, `method`, `path`,
  `body?`, `query?`. The function shall:
  - Verify caller JWT, resolve `org_id`, `user_id`, assert Admin role + entitlement (or
    service-role for background automations — separate code path, same token custody).
  - **Lookup the connection** row for `(org_id, user_id)` where `status = 'active'`. If none or
    `stale`/`revoked`, return a typed error (`CONNECTION_STALE`, `CONNECTION_REVOKED`,
    `NOT_CONNECTED`) — the FE drives re-consent.
  - **Decrypt the access token** (FR-M365-121). If `access_token_expires_at > now() + 30s`, use it.
  - Else **refresh** (FR-M365-140) to get a new access token, then use the new one.
  - Call `https://graph.microsoft.com/v1.0{path}` with the access token as `Bearer` auth, passing
    `method`, `query`, `body`. **HTTPS only; host pinned to `graph.microsoft.com`.**
  - Return the Graph response body (or transformed subset) to the caller. **No token in response.**

- **FR-M365-131 (Where — least-privilege scope enforcement).** The proxy shall **only** call Graph
  endpoints consistent with the `scopes` stored on the connection row. If a caller requests a path
  requiring a scope not in the grant, return `SCOPE_INSUFFICIENT` (the FE initiates incremental
  consent per NFR-M365-105).

### 3.5 Refresh + rotation + revoke (lifecycle — ADR-0060 §6/§7)

- **FR-M365-140 (Event-driven — refresh).** When the access token is expired/near-expiry, the
  function shall:
  - Decrypt the stored `refresh_token_ciphertext` (FR-M365-121).
  - POST to Microsoft token endpoint with `grant_type=refresh_token`, `refresh_token`,
    `client_id`, `client_secret` (from secret), `scope` (the originally granted scopes).
  - On success: receive new `access_token`, **new `refresh_token` (rotated)**, `expires_in`.
  - Encrypt **both** new tokens (FR-M365-120). **Upsert** the connection row with the new
    ciphertexts, `access_token_expires_at`, `last_refresh_at = now()`, `status = 'active'`.
  - **Audit:** `log_audit('m365.token.refreshed', org_id, actor_id, connection_id,
    jsonb_build_object('scopes', scopes))`.

- **FR-M365-141 (State-driven — rotation handling).** The function shall **always persist the
  newest refresh token** returned by Microsoft (rotation). The old refresh token is invalidated by
  Microsoft; the function does not retain it.

- **FR-M365-142 (Event-driven — refresh failure → stale).** On refresh failure:
  - `invalid_grant` / `token_revoked` / `expired_token` → update connection `status = 'stale'`,
    `updated_at = now()`. **Audit:** `log_audit('m365.token.refresh_failed', org_id, actor_id,
    connection_id, jsonb_build_object('error', sanitized_error_code))`. **Error event:**
    `recordErrorEvent({ fn: 'm365-token-custody', errorCode: 'REFRESH_FAILED', contextId:
    connection_id, orgId })`.
  - **Never** silently retry. The FE, on `CONNECTION_STALE`, shows "Reconnect Microsoft 365" and
    re-initiates the PKCE flow (FR-M365-101).
  - **Unexpected refresh-token reuse** (Microsoft returns an error indicating the presented
    refresh token was already used) → treat as **security event**: update `status = 'revoked'`,
    `log_audit('m365.token.reuse_detected', ...)` + `error_event` with `SECURITY_EVENT_REUSE`.
    This is a potential token-theft indicator.

- **FR-M365-150 (Event-driven — explicit disconnect).** When an Admin clicks "Disconnect Microsoft
  365" (or an Operator disentitles the org), the function shall:
  - Verify caller (Admin + entitlement, or Operator).
  - **Best-effort revoke at Microsoft:** POST to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/revoke`
    with the decrypted refresh token (if still decryptable) + `client_id` + `client_secret`.
    **Ignore failures** (network, already revoked) — the local delete is the source of truth.
  - **Delete** the `ms_graph_connections` row (service-role). **Audit:** `log_audit('m365.connection.revoked',
    org_id, actor_id, connection_id, jsonb_build_object('reason', 'user_disconnect' | 'admin_disconnect' | 'offboard' | 'disentitled'))`.

- **FR-M365-151 (Event-driven — offboard / disentitlement cascade).** A separate
  `security-definer` RPC (or the existing offboard automation) shall call the disconnect logic for
  all connections in an org when: a user is offboarded (`profiles.status='disabled'`), the org is
  disabled, or `m365_integration` entitlement is toggled off. This ensures NFR-M365-107.

### 3.6 Authorization (entitled Admin, own row, org-scoped — ADR-0016/0001)

- **FR-M365-160 (Ubiquitous — caller verification).** Every edge function entry point shall verify
  the caller's JWT **locally** against the project JWKS (asymmetric ES256, per `adapter-dispatch`
  precedent: `verifyCallerJwt` + `getJwks` cached). Extract `sub` → `userId`.

- **FR-M365-161 (Ubiquitous — org resolution under caller JWT).** Resolve the caller's `org_id`
  via a **caller-JWT-scoped** Supabase client (`anon` key + `Authorization: Bearer <jwt>`) reading
  `profiles.select('org_id').eq('id', userId).single()`. This read is **RLS-gated** by
  `is_active_member()` (mirroring `adapter-dispatch` Recon #4) — a disabled/offboarded caller
  resolves zero rows → 400. **Never use `service_role` for this read.**

- **FR-M365-162 (Ubiquitous — Admin gate).** Assert the caller's **real JWT role** (from the
  verified JWT `role` claim, not impersonated) is `Admin`. Impersonation is view-only + banner
  (ADR-0008) and **cannot** pass this gate.

- **FR-M365-163 (Ubiquitous — entitlement gate).** Assert the resolved `org_id` has
  `m365_integration` enabled in `org_features` (via the `useFeature` resolver / `operator_toggle_feature`
  RPC). This is the **Operator switch** (ADR-0049).

- **FR-M365-164 (Ubiquitous — own-row scoping).** The `ms_graph_connections` table has
  `unique(org_id, user_id)`. The function shall **only** read/write the row where
  `org_id = resolved_org_id` AND `user_id = resolved_user_id` (for user-initiated actions).
  Background automations (Phase 2+) act as `service_role` on behalf of a specific `user_id` —
  still scoped by `org_id`.

- **FR-M365-165 (Where — RLS is enforcement authority).** The FE may hide/disable affordances via
  `can()` / `<CanWrite>` / `usePermission` (ADR-0016 UX-only). **RLS + the zero-policy table +
  service-role-only writes are the enforcement authority.** The FE may be stricter; never looser.

### 3.7 Audit emission (ADR-0060 §8, ADR-0076)

- **FR-M365-170 (Ubiquitous — audit events).** The function shall call `log_audit(...)` (the
  `postgres`-owned security-definer function from migration `0076`) on every success-path token
  lifecycle event:
  - `m365.connection.initiated` (FR-M365-110)
  - `m365.token.refreshed` (FR-M365-140)
  - `m365.token.refresh_failed` (FR-M365-142)
  - `m365.token.reuse_detected` (FR-M365-142 security event)
  - `m365.connection.revoked` (FR-M365-150)
  Each call includes: `org_id`, `actor_id` (the Admin/user), `entity_id` (the connection `id`),
  `detail` (JSONB with `scopes`, `entra_tenant_id`, `error` code — **never token material**).

- **FR-M365-171 (Ubiquitous — error events).** On any error path (exchange failure, refresh failure,
  Graph proxy error, revoke failure), the function shall call `recordErrorEvent(...)` (shared
  `errorEvent.ts` pattern) with `fn='m365-token-custody'`, sanitized `error_code`, `context_id`
  (connection id or state), `org_id`. **Never include tokens, secrets, or `code_verifier` in
  `error_code` or context.**

### 3.8 Threat controls carried from ADR-0060 (explicitly encoded)

- **FR-M365-180 (State-driven — no plaintext token anywhere).** The function shall not log,
  return, embed in error messages, or persist in any table other than `ms_graph_connections`
  (encrypted) any Microsoft access token, refresh token, `code`, `code_verifier`, `client_secret`,
  or KEK. Code review + `security-auditor` gate verify this.

- **FR-M365-181 (Ubiquitous — token store server-only).** `ms_graph_connections` RLS forced + zero
  client policy + service-role-only access (FR-M365-104) makes this structural. The function
  shall not expose any SELECT/INSERT/UPDATE path to a client JWT.

- **FR-M365-182 (Event-driven — CSRF protection on OAuth round-trip).** The `state` parameter
  (cryptographically random, >= 128 bits) is generated server-side, stored in the transient
  `m365_pkce_states` table keyed to the user/org, and **verified + consumed (deleted)** on
  callback (FR-M365-102). This binds the authorization request to the specific user session.

- **FR-M365-183 (Ubiquitous — tenant pinning).** The `tenant` value interpolated into the
  authorize URL and token endpoint URL is validated against `graphPkce.TENANT_RE`
  (`^[A-Za-z0-9._-]+$`) and the host is **pinned to `login.microsoftonline.com`**. The
  `redirect_uri` is an allowlisted constant per project (FR-M365-103).

- **FR-M365-184 (Ubiquitous — open-redirect safe redirect URI).** The `redirect_uri` sent to
  Microsoft is a **hard-coded allowlisted value** (the edge function callback URL), never derived
  from caller input. The Entra app registration contains exactly this URI.

---

## 4. Acceptance criteria (Given/When/Then)

> Each AC is owned by **one** test at the lowest sufficient layer (ADR-0010). AC-id is the leading
> token of the owning test's title/description (traceability §5). The AC namespace continues
> Phase-0 as `AC-M365-1xx`.

### 4.1 PKCE initiate / callback / exchange

**AC-M365-101 (initiate_connect returns authorize URL — Unit).**
Given an entitled org, an Admin caller with a valid JWT, and a mocked `M365_CLIENT_SECRET` +
KEK in the function env,
When the function receives `action: 'initiate_connect'`,
Then it returns `{ authorizeUrl, state }` where `authorizeUrl` is a valid Microsoft v2.0 authorize
URL containing `response_type=code`, `code_challenge_method=S256`, the correct `client_id`,
the allowlisted `redirect_uri`, scopes `Files.Read offline_access`, a valid `state`, and a
`code_challenge` derivable from a stored `code_verifier`; **and** a row is inserted into
`m365_pkce_states` with the `code_verifier`, `state`, `org_id`, `user_id`, `scopes`, TTL.
*(Owns FR-M365-101, FR-M365-102, NFR-M365-101, NFR-M365-105.)*

**AC-M365-102 (initiate_connect denies non-Admin / non-entitled — Unit).**
Given a caller with a valid JWT but role `Project Manager` (or org without `m365_integration`),
When the function receives `action: 'initiate_connect'`,
Then it returns a typed error (`FORBIDDEN` / `NOT_ENTITLED`) with status 403 and **no** PKCE state
is stored. *(Owns FR-M365-162, FR-M365-163.)*

**AC-M365-103 (callback consumes state, exchanges code, stores encrypted tokens — Unit).**
Given a valid `m365_pkce_states` row (matching `state`, unexpired, with `code_verifier` and
`scopes`), a mocked Microsoft token endpoint returning `access_token`, `refresh_token`,
`expires_in=3600`, `scope='Files.Read offline_access'`, and a mocked KEK,
When the function callback receives `code=...&state=...`,
Then it deletes the PKCE state row, encrypts both tokens via `graphTokenCrypto`, upserts
`ms_graph_connections` with `status='active'`, correct ciphertexts, `key_id`, `scopes`,
`entra_tenant_id`, `access_token_expires_at ≈ now+3600s`, `connected_at`, `last_refresh_at`,
and calls `log_audit('m365.connection.initiated', ...)`. *(Owns FR-M365-110, FR-M365-120,
FR-M365-170, NFR-M365-103, NFR-M365-104, NFR-M365-108.)*

**AC-M365-104 (callback rejects replayed/expired state — Unit).**
Given a callback with a `state` that is not in `m365_pkce_states` (expired or already consumed),
When the function processes the callback,
Then it returns a user-facing error (no token leakage), logs an `error_event` with
`error_code='INVALID_STATE'`, and **does not** call the Microsoft token endpoint. *(Owns
FR-M365-102, NFR-M365-108, NFR-M365-110.)*

**AC-M365-105 (token exchange failure → error_event, no partial store — Unit).**
Given a valid PKCE state but Microsoft returns `error=invalid_grant` (or network error),
When the function processes the callback,
Then it logs an `error_event` with sanitized metadata, **does not** insert into
`ms_graph_connections`, and redirects to the FE error page. *(Owns FR-M365-111, NFR-M365-108.)*

**AC-M365-171 (TOFU first-connect pins the oid — Unit).**
Given a pre-existing `ms_graph_connections` row for `(org, user)` whose `entra_user_object_id` IS
NULL (or no row at all), and a callback presenting a valid id_token with `oid = X`,
When the callback processes the exchange,
Then it ACCEPTS, upserts the connection pinning `entra_user_object_id = X`, and emits
`m365.connection.initiated` (no identity-mismatch audit). *(Owns FR-M365-112, NFR-M365-108.)*

**AC-M365-172 (reconnect with the SAME oid succeeds — Unit).**
Given an existing connection whose `entra_user_object_id = X` (non-null), and a callback presenting
`oid = X`,
When the callback processes the exchange,
Then it ACCEPTS, rotates the tokens (upsert), and emits `m365.connection.initiated`. *(Owns
FR-M365-112.)*

**AC-M365-173 (reconnect with a DIFFERENT oid is rejected — Unit).**
Given an existing connection whose `entra_user_object_id = X` (non-null, pinned), and a callback
presenting `oid = Y ≠ X` (a same-tenant consent-phishing indicator),
When the callback processes the exchange,
Then it REJECTS before any encrypt/upsert (no token stored), emits a sanitized
`M365_IDENTITY_MISMATCH` `error_event` (no token material, no raw oid), emits an
`m365.connection.identity_mismatch` `audit_events` row, and redirects to the FE error page with a
message that leaks NO oid and NO token. *(Owns FR-M365-112, NFR-M365-101, NFR-M365-108.)*

**AC-M365-174 (entra_user_object_id is write-once at the DB boundary — pgTAP).**
Given a `ms_graph_connections` row,
When an UPDATE attempts to change `entra_user_object_id` from a non-null value to a different value
(or to NULL),
Then the BEFORE UPDATE trigger raises errcode `42501` (`identity_rebind_forbidden`) and the column
is unchanged; `NULL`→value (TOFU first-write), value→same-value (reconnect), and unrelated column
updates are all ALLOWED. The production reconnect path (`m365_upsert_connection`'s `ON CONFLICT DO
UPDATE`) obeys the same rule. *(Owns FR-M365-112, structural enforcement.)*

### 4.2 Graph proxy + refresh

**AC-M365-110 (graph_proxy returns Graph data, never tokens — Unit).**
Given an active `ms_graph_connections` row with a valid (unexpired) encrypted access token,
a mocked KEK, and a mocked `fetch` to `graph.microsoft.com` returning `{ value: [...] }`,
When the function receives `action: 'graph_proxy', method: 'GET', path: '/me/drive/root/children'`,
Then it decrypts the access token, calls Graph with `Authorization: Bearer <token>`, returns the
Graph response body to the caller, and **the response contains no token material**. *(Owns
FR-M365-130, FR-M365-121, NFR-M365-101, NFR-M365-102.)*

**AC-M365-111 (graph_proxy refreshes expired access token — Unit).**
Given an active connection where `access_token_expires_at < now() + 30s`, a valid encrypted
refresh token, a mocked Microsoft token endpoint returning a **new** `access_token` and **rotated**
`refresh_token`, and a mocked KEK,
When `graph_proxy` is invoked,
Then it refreshes (persists new ciphertexts, updates `access_token_expires_at`,
`last_refresh_at`, `status='active'`), calls Graph with the **new** access token, returns data,
and calls `log_audit('m365.token.refreshed', ...)`. *(Owns FR-M365-140, FR-M365-141,
NFR-M365-106, NFR-M365-108.)*

**AC-M365-112 (refresh failure → stale + audit + error_event — Unit).**
Given an active connection where refresh returns `invalid_grant`,
When `graph_proxy` (or explicit refresh) is invoked,
Then the connection `status` becomes `'stale'`, `log_audit('m365.token.refresh_failed', ...)` is
called, `recordErrorEvent('REFRESH_FAILED', ...)` is called, and the caller receives
`CONNECTION_STALE`. *(Owns FR-M365-142, NFR-M365-106, NFR-M365-108.)*

**AC-M365-113 (refresh-token reuse detected → revoked + security event — Unit).**
Given an active connection where Microsoft returns an error indicating the presented refresh token
was already used (e.g. `invalid_grant` with a reuse-specific sub-code, or the function detects
the stored refresh token differs from the one just used),
When refresh is attempted,
Then the connection `status` becomes `'revoked'`, `log_audit('m365.token.reuse_detected', ...)` +
`recordErrorEvent('SECURITY_EVENT_REUSE', ...)` are called. *(Owns FR-M365-142 security event,
NFR-M365-106.)*

**AC-M365-114 (graph_proxy enforces scope — Unit).**
Given an active connection granted only `Files.Read`, when `graph_proxy` is asked to call
`/me/events` (requires `Calendars.Read`),
Then it returns `SCOPE_INSUFFICIENT` without calling Graph. *(Owns FR-M365-131, NFR-M365-105.)*

### 4.3 Revoke / disconnect / lifecycle

**AC-M365-120 (explicit disconnect deletes row, best-effort revoke, audits — Unit).**
Given an active connection, an Admin caller,
When the function receives `action: 'disconnect'`,
Then it attempts a POST to Microsoft revoke endpoint with the decrypted refresh token (ignoring
failure), **deletes** the `ms_graph_connections` row, and calls
`log_audit('m365.connection.revoked', ..., jsonb_build_object('reason','user_disconnect'))`.
*(Owns FR-M365-150, NFR-M365-107, NFR-M365-108.)*

**AC-M365-121 (offboard/disentitlement cascade deletes tokens — pgTAP).**
Given an org with active `ms_graph_connections` rows, when `operator_toggle_feature(org,
'm365_integration', false)` is called (or a user is offboarded via `admin_set_user_status`),
Then a security-definer RPC deletes all connections for that org/user and audits each with
`reason='disentitled'` / `'offboard'`. *(Owns FR-M365-151, NFR-M365-107.)*

### 4.4 Authorization gates

**AC-M365-130 (caller JWT verification + org resolution — Unit).**
Given a valid/invalid/expired JWT, when the function's verification helper runs, it returns the
`sub` on success or throws a typed `JwtVerifyError` with status 401 on any signature/expiry/issuer/
audience/alg failure. The org resolution read uses the caller's JWT (RLS-scoped) and returns
`org_id` for an active member, 400 for a disabled/offboarded caller. *(Owns FR-M365-160,
FR-M365-161.)*

**AC-M365-131 (Admin gate — Unit).**
Given a verified caller with role `Project Manager`, when any mutating action is attempted,
the function returns 403 `FORBIDDEN`. *(Owns FR-M365-162.)*

**AC-M365-132 (Entitlement gate — Unit).**
Given a verified Admin caller whose org does **not** have `m365_integration` enabled,
when any action is attempted, the function returns 403 `NOT_ENTITLED`. *(Owns FR-M365-163.)*

**AC-M365-133 (Own-row scoping — pgTAP).**
Given two orgs A and B each with a connected user, when Org A's Admin calls the function,
the function only reads/writes the row where `org_id = A` and `user_id = caller`. Cross-org
access is impossible (service-role write sets `org_id` explicitly from resolved profile).
*(Owns FR-M365-164, FR-M365-165, NFR-M365-104, NFR-M365-109.)*

### 4.5 Threat controls

**AC-M365-140 (no plaintext in logs/errors — Unit + security-auditor review).**
Given any function execution path (success, error, refresh, revoke), when the function logs
(`console.log`, `console.error`, `recordErrorEvent`, `log_audit`), the logged payload contains
**no** access token, refresh token, `code`, `code_verifier`, `client_secret`, or KEK. *(Owns
NFR-M365-101, NFR-M365-103, NFR-M365-108, NFR-M365-110.)*

**AC-M365-141 (tenant pinning + redirect URI allowlist — Unit).**
Given a malicious `tenant` parameter attempting path traversal (e.g. `common/../evil`),
`graphPkce.buildAuthorizeUrl` throws. Given a callback with a non-allowlisted `redirect_uri`,
the token exchange is not attempted. *(Owns FR-M365-183, FR-M365-184.)*

**AC-M365-142 (CSRF state single-use — Unit).**
Given a valid PKCE state row, when the callback is processed once, the row is deleted. A second
callback with the same `state` is rejected per AC-M365-104. *(Owns FR-M365-102, FR-M365-182.)*

---

## 5. Traceability (AC → owning layer/test, per ADR-0010)

| AC | Satisfies | Owning layer | Owning test (leading AC-id) | Verifiable |
|---|---|---|---|---|
| AC-M365-101 | FR-M365-101/102, NFR-101/105 | Unit (Vitest, mocked fetch/crypto) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` | **Now** |
| AC-M365-102 | FR-M365-162/163 | Unit | same file | **Now** |
| AC-M365-103 | FR-M365-110/120/170, NFR-103/104/108 | Unit (mocked token endpoint + KEK) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts` | **Now** |
| AC-M365-104 | FR-M365-102, NFR-108/110 | Unit | same file | **Now** |
| AC-M365-105 | FR-M365-111, NFR-108 | Unit | same file | **Now** |
| AC-M365-110 | FR-M365-130/121, NFR-101/102 | Unit (mocked fetch + decrypt) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.proxy.test.ts` | **Now** |
| AC-M365-111 | FR-M365-140/141, NFR-106/108 | Unit (mocked refresh response) | same file | **Now** |
| AC-M365-112 | FR-M365-142, NFR-106/108 | Unit | same file | **Now** |
| AC-M365-113 | FR-M365-142 (security event) | Unit | same file | **Now** |
| AC-M365-114 | FR-M365-131, NFR-105 | Unit | same file | **Now** |
| AC-M365-120 | FR-M365-150, NFR-107/108 | Unit (mocked revoke) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.lifecycle.test.ts` | **Now** |
| AC-M365-121 | FR-M365-151, NFR-107 | pgTAP (RPC contract) | `supabase/tests/015x_m365_offboard_cascade.test.sql` | **DB-deferred** |
| AC-M365-130 | FR-M365-160/161 | Unit (verifyCallerJwt + caller-scoped read) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.auth.test.ts` | **Now** |
| AC-M365-131 | FR-M365-162 | Unit | same file | **Now** |
| AC-M365-132 | FR-M365-163 | Unit | same file | **Now** |
| AC-M365-133 | FR-M365-164/165, NFR-104/109 | pgTAP (RLS + service-role write path) | `supabase/tests/015y_ms_graph_connections_org_scope.test.sql` | **DB-deferred** |
| AC-M365-140 | NFR-101/103/108/110 | Unit (log capture) + **security-auditor review** | `pmo-portal/src/lib/m365/__tests__/tokenCustody.secrets.test.ts` | **Now + Gate** |
| AC-M365-141 | FR-M365-183/184 | Unit (graphPkce + callback validation) | `pmo-portal/src/lib/m365/__tests__/graphPkce.security.test.ts` | **Now** |
| AC-M365-142 | FR-M365-102/182 | Unit (state consume) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.initiate.test.ts` | **Now** |
| AC-M365-171 | FR-M365-112, NFR-108 | Unit (mocked token endpoint + existing-row SELECT) | `pmo-portal/src/lib/m365/__tests__/tokenCustody.callback.test.ts` | **Now** |
| AC-M365-172 | FR-M365-112 | Unit | same file | **Now** |
| AC-M365-173 | FR-M365-112, NFR-101/108 | Unit | same file | **Now** |
| AC-M365-174 | FR-M365-112 (structural) | pgTAP (trigger) | `supabase/tests/0153_m365_connection_oid_write_once.test.sql` | **DB** |

**NFR verification schedule.** NFR-M365-101 through -110 are **proven at the unit layer** for the
edge function logic (mocked crypto, fetch, DB) **and** structurally by the Phase-0 schema (RLS,
grants, column types). The **live integration** (real Microsoft token endpoint, real Graph call,
real KEK from Supabase secrets) is verified by the **mandatory `security-auditor` gate** (STRIDE on
the token store, the proxy, and the consent flow — ADR-0060) before any Graph data feature ships.
No curated Playwright e2e is owned here (ADR-0010: e2e only for real cross-stack journeys); the
OneDrive doc-linking feature (Phase 1 data feature) owns the cross-stack e2e that exercises the
live proxy end-to-end.

---

## 6. Non-Goals (explicitly out of scope)

- **OneDrive doc-linking UI** (the "Documents" tab, linking `driveItem` refs to `project_documents`,
  the browse/preview surface) — separate Phase-1 spec that **consumes** this runtime via
  `graph_proxy`.
- **Teams, Outlook/Calendar, Planner** features — Phase 2+.
- **Entra group → PMO role provisioning** — vision §3.1, later.
- **Publisher verification** — business task (ADR-0059), weeks of lead time; onboarding uses admin
  consent meanwhile.
- **Per-client Entra app registration runbook** — ops task (ADR-0047 provisioning runbook), not
  code.
- **KEK rotation automation** — ops runbook; the schema supports `key_id` for multi-KEK coexistence
  during rotation.
- **Background/scheduled Graph sync** (watermark reconciliation, change feed) — ADR-0055 adapter
  pattern, Phase 2+.
- **FE connection card "Connect" button wiring** — the FE stub from Phase 0 (FR-M365-013) is wired
  to call `initiate_connect` here; the card's *visual* polish is a separate UI issue.

---

## 7. Dependencies / Owner-gated inputs (must be resolved before the edge function can run live)

| Dependency | Source | Status | Owner action |
|---|---|---|---|
| **KEK (`M365_TOKEN_KEK`)** — 32-byte base64url key for AES-256-GCM | Supabase secrets / vault-`AS` | **Required** | Provision per-project (siloed) or per-tenant (pooled future); store in Supabase Dashboard → Edge Functions → Secrets |
| **`M365_CLIENT_SECRET`** — the per-client Entra app secret (Option C) | vault-`AS` / Supabase secrets | **Required** | Register per-client app in `gordi.id` (ADR-0059 Option C), add redirect URI, store secret |
| **`M365_CLIENT_ID`** — the per-client Entra app client ID | Supabase secrets / env | **Required** | Same as above |
| **`M365_TENANT_ID`** — the client's Entra tenant ID (for Option C authorize URL) | Supabase secrets / env | **Required** | Captured during per-client onboarding |
| **`M365_REDIRECT_URI`** — the allowlisted callback URL (e.g. `https://<project>.supabase.co/functions/v1/m365-token-custody/callback`) | Supabase secrets / env | **Required** | Must match Entra app registration exactly |
| **Entra delegated scopes** — `Files.Read` + `offline_access` (minimum for OneDrive linking) | Microsoft Graph permissions | **Required** | Configure on the per-client app registration; admin consent granted by client IT |
| **Edge function deploy** — `supabase/functions/m365-token-custody/` with the above secrets | Supabase CLI | **Required** | `supabase functions deploy m365-token-custody --project-ref <ref>` |
| **`security-auditor` sign-off** | STRIDE review on token store, proxy, consent flow | **Mandatory gate** (ADR-0060) | Director schedules after unit tests pass, before live deploy |

---

## 8. Error code taxonomy (function response shape)

All error responses follow the repo's `AppError` / edge-function convention (see `adapter-dispatch`):
`{ error: <CODE>, message: <human-readable> }` with HTTP status mapping:

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | JWT verification failed (sig/exp/iss/aud/alg) |
| `FORBIDDEN` | 403 | Caller not Admin |
| `NOT_ENTITLED` | 403 | Org lacks `m365_integration` entitlement |
| `BAD_REQUEST` | 400 | Malformed body, missing params, org not resolvable |
| `INVALID_STATE` | 400 | PKCE state missing/expired/replayed |
| `TOKEN_EXCHANGE_FAILED` | 502 | Microsoft token endpoint error (sanitized) |
| `NOT_CONNECTED` | 404 | No active connection for caller |
| `CONNECTION_STALE` | 409 | Refresh failed → re-consent required |
| `CONNECTION_REVOKED` | 410 | Connection explicitly revoked |
| `SCOPE_INSUFFICIENT` | 403 | Requested Graph path needs scope not in grant |
| `GRAPH_ERROR` | 502 | Graph API error (sanitized) |
| `INTERNAL_ERROR` | 500 | Unexpected (logged to `error_events`) |

**Sanitization rule (NFR-M365-108/110):** Microsoft `error_description` may contain tenant-specific
detail; the function shall map known `error` codes to the above taxonomy and **never** pass
Microsoft's raw `error_description` to the client. Log the raw error to `error_events` (server-side
only).

**Observability codes (`error_events.error_code` — server-side only, NOT the wire `error` field
above):** distinct from the wire taxonomy, the `error_events.error_code` column carries a
server-side observability namespace. New codes are prefixed `M365_*` so a grep/filter is
unambiguous. `M365_IDENTITY_MISMATCH` — the TOFU / enforce-on-reconnect mismatch (FR-M365-112 /
AC-M365-173): a reconnect whose id_token `oid` differs from the pinned `entra_user_object_id`
(same-tenant consent-phishing indicator). Sanitized: NO token material, NO raw oid — the forensic
trail (stored vs presented oid) lives in the paired `m365.connection.identity_mismatch` audit row.

---

## 9. Implementation notes (for the `eng-planner` plan + `implementer`)

- **Edge function layout:** `supabase/functions/m365-token-custody/` with `index.ts` (router),
  `initiate.ts`, `callback.ts`, `proxy.ts`, `refresh.ts`, `revoke.ts`, `auth.ts` (verifyCallerJwt +
  org resolution, mirrors `adapter-dispatch` + `verifyCallerJwt.ts`), `crypto.ts` (re-exports
  `graphTokenCrypto`), `pkce.ts` (re-exports `graphPkce`), `stateStore.ts` (`m365_pkce_states`
  CRUD via service-role), `audit.ts` (log_audit + recordErrorEvent wrappers).
- **Cross-tree imports:** The edge function imports `graphPkce` and `graphTokenCrypto` from
  `../../../pmo-portal/src/lib/m365/` (relative path from `supabase/functions/m365-token-custody/`).
  This mirrors the existing pattern — pure logic in `pmo-portal/src/lib/`, consumed by edge
  functions. **No code duplication.**
- **`m365_pkce_states` table:** New migration (Phase 1 DB slice). Columns: `id uuid pk`,
  `org_id uuid not null`, `user_id uuid not null`, `code_verifier text not null`, `state text not
  null unique`, `scopes text[] not null`, `created_at timestamptz not null default now()`,
  `expires_at timestamptz not null`. RLS enabled + forced, **zero policies**, service-role only.
  TTL enforced by `expires_at` (e.g. `created_at + interval '10 minutes'`) and a nightly cleanup
  cron (or `pg_cron`).
- **KEK loading:** At module load, `const KEK_BYTES = base64url.decode(Deno.env.get('M365_TOKEN_KEK')!)`
  (throw if missing). Support a `KEK_MAP: Record<string, Uint8Array>` for rotation coexistence
  (keyed by `key_id`).
- **CORS:** The function is called from the FE (same origin via Supabase Functions domain) —
  `corsHeaders` from `_shared/cors.ts` (mirror `adapter-dispatch`).
- **Structured logging:** `console.log` with JSON payloads (fn, action, connection_id, org_id,
  outcome) — matches the repo's `logStructuredError` / observability floor.
- **Test strategy:** Unit tests (Vitest) mock `fetch`, `globalThis.crypto`, `Deno.env`, and the
  Supabase service-role client (via a test double). pgTAP tests for the new `m365_pkce_states`
  table lockdown and the offboard cascade RPC. The `security-auditor` reviews the **deployed**
  function (code + secrets config + live token flow) before the OneDrive feature merges.

---

*SPEC-DONE*