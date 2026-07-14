# ADR-0060 — Microsoft Graph token custody: server-side confidential-client refresh-token store

- **Status:** Accepted (owner ratified 2026-07-14 — Option 2, "highest care", industry best practice).
  **Sub-decisions D1/D2 confirmed by owner 2026-07-14:** encryption = app-layer AES-256-GCM (§3);
  bootstrap = server-side authorization-code + PKCE (§1).
- **Date:** 2026-07-14
- **Deciders:** Owner, Director
- **Related:** ADR-0058 §Decision 6 (this resolves it), ADR-0059 (per-client app → per-client tokens),
  ADR-0047 (siloed topology → per-client blast-radius; vault-`AS` secrets), ADR-0001 (org_id seam),
  ADR-0049 (forced-RLS append-only-by-omission pattern), ADR-0019 (security-definer RPC boundary),
  ADR-0076/0071 (audit_events / error_events). **Vision:** `docs/microsoft-365-integration.md` §4/§5.
- **Scope:** how PMO obtains, stores, refreshes, uses, and revokes the long-lived Microsoft Graph
  **refresh token** (and derived access tokens) needed for on-behalf-of Graph calls (OneDrive, Teams,
  Calendar, Planner). NOT the SSO login (that uses only the ID token; unaffected). Implemented in Phase 0.

## Context

Supabase's `azure` provider returns a `provider_token` (access token, ~1h) and a
`provider_refresh_token` at sign-in but **persists/refreshes neither** (ADR-0058 §6). Every Graph *data*
feature — especially the high-value **offline/background** ones (scheduled Teams alerts, calendar sync,
milestone webhooks) — needs durable, renewable Graph access when the user is *not* present. That is only
achievable by PMO owning the token lifecycle **server-side** (Option 2). The owner directed the
highest-care, industry-convention implementation. Refresh tokens are bearer credentials to a client's
Microsoft data: mishandling is a serious breach, so the controls below are binding, not aspirational.

## Decision — the binding controls

**1. Confidential-client, server-only custody.** The refresh token is held and exercised **exclusively
server-side** in an edge function acting as an OAuth *confidential client* (holds the app secret). The
refresh token **never** transits or persists in the browser, `localStorage`, or any client-readable
surface. **Bootstrap flow (D2, owner-confirmed 2026-07-14): a dedicated server-side
authorization-code + PKCE exchange** for Graph scopes (separate from the SSO login) so the refresh token
is captured server-side and never touches the client. (Rejected: one-time capture of Supabase's
`provider_refresh_token` — it couples Graph consent to the login moment, inherits SSO scopes, and risks
the token transiting the client.)

**2. Graph calls are proxied, never client-direct.** Browser → PMO edge function → Graph. Access and
refresh tokens stay server-side; the client receives only the *resulting data*. No Microsoft token is
ever handed to the front-end.

**3. Encrypted at rest — envelope encryption, key outside the table.** Tokens are stored **only**
encrypted. **Mechanism (D1, owner-confirmed 2026-07-14): app-layer AES-256-GCM in the edge function**,
with the key-encryption key from a managed secret store (Supabase secrets / cloud KMS / the 1Password
vault-`AS` pattern) — **never in the repo**, and rotatable. No plaintext token column ever exists.
(Rejected: Supabase Vault (pgsodium) — its `create_secret`/`decrypted_secrets` model fits a few *named*
secrets, not *per-user/per-connection row* token columns; the edge function needs plaintext to call
Graph anyway, so co-locating the crypto boundary there minimizes plaintext transit, and a DB compromise
without the function's KEK yields only ciphertext. Vault stays viable if a future need favors
Postgres-native TCE.) The stored `key_id` is the KEK **reference**, never the key.

**4. Dedicated, locked-down table.** A new `ms_graph_connections` table (encrypted token columns +
metadata: scopes granted, expiry, tenant id, user/org linkage), **`org_id`-scoped** (column-default +
stamp trigger, ADR-0001) with **RLS enabled + FORCED and no client-readable policy** — reachable only by
`service_role` / security-definer inside edge functions (the append-only-by-omission pattern of
`platform_operators`, ADR-0049). `authenticated`/`anon` get zero access.

**5. Least-privilege incremental consent.** Request the **minimum Graph scopes per feature, at point of
use** (files vs Teams vs calendar consented separately); request `offline_access` only where a durable
refresh token is genuinely required. Narrow scopes are both a security control and an enterprise-consent
conversion lever.

**6. Refresh-token rotation + reuse/failure handling.** Persist the **newest** rotated refresh token on
every refresh. On `invalid_grant` / revocation / expiry, mark the connection **stale** and drive a
**re-consent** — never silently retry-loop. Unexpected refresh-token reuse is treated as a security event
(logged, connection invalidated). Honor Continuous Access Evaluation (CAE) claims where returned.

**7. Revocation & lifecycle.** Support explicit user/admin **disconnect** (delete the stored token +
best-effort revoke at Microsoft). Tokens are **deleted on user offboard / org disable / feature
disentitlement** — tying into the Entra-offboard feature and the ADR-0049 entitlement switch.

**8. Audit without secret leakage.** Log token issuance / refresh / use / revoke to `audit_events` /
`error_events` with **metadata only** (connection id, scope set, outcome) — **never** the token value,
and never a token in an error string or log line.

**9. Blast-radius contained by topology.** Under siloed deployment (ADR-0047) each client's tokens live
**only in that client's Supabase project**, with a per-project KEK — natural per-tenant isolation and
minimal blast radius. (Under a future pooled model, per-row `org_id` scoping + per-tenant key derivation
becomes the isolation boundary — the seam already anticipates it.)

**10. Transport & secret hygiene.** HTTPS only; the app client secret and the KEK live in
vault-`AS` / Supabase secrets, on a **rotation schedule**, held solely by the edge function.

## Consequences

- **Positive:** the only design that supports offline/background Graph actions (the high-value features)
  while meeting enterprise security expectations. Isolation, least-privilege, encryption-at-rest, audit,
  and revocation are all first-class. Fits existing repo patterns (forced-RLS token tables, edge-function
  confidential clients, vault-`AS` secrets, org_id seam).
- **Cost / negative:** real infrastructure — an edge-function Graph proxy, envelope encryption + key
  management (enable Supabase Vault or ship app-layer AES-GCM), and ongoing key/secret rotation ops. More
  moving parts than the client-side (MSAL) alternative that was rejected.
- **Mandatory gate:** the `security-auditor` reviews this surface (STRIDE on the token store, the proxy,
  and consent flow) **before** any Graph data feature ships. pgTAP proves the RLS lockdown (zero
  `authenticated` access to `ms_graph_connections`), mirroring the `platform_operators` proofs.

## Phase-0 follow-ups (before OneDrive linking, vision doc Phase 1)

- ~~Choose encryption mechanism~~ **DONE (D1, 2026-07-14): app-layer AES-256-GCM (§3).**
- ~~Choose bootstrap flow~~ **DONE (D2, 2026-07-14): server-side auth-code + PKCE (§1).**
- ~~Author the `ms_graph_connections` migration + pgTAP~~ **AUTHORED (Phase-0 DB slice, `0096`/`0142`/`0143`);
  DB-deferred pending the owner's local `supabase test db` pass.**
- Implement the Phase-1 exchange edge function (PKCE bootstrap + AES-256-GCM encrypt/decrypt + Graph
  proxy) — needs live Entra secrets + the KEK provisioned in secrets.
- Wire audit_events hooks; define the re-consent UX for the stale-connection path.
- `security-auditor` sign-off before exposing.
