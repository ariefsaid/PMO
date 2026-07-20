# Microsoft 365 integration — Phase 0 (shared foundation) — spec

- **Status:** Draft for Director/owner review (authored 2026-07-14, eng-planner).
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
  primitive), §4 (Phase 0), §5 (open decisions).
- **Scope:** the shared foundation that unblocks every later M365 feature — **(1)** the Graph token
  store table + lockdown + schema invariants (ADR-0060), **(2)** the two-switch entitlement/config
  surface (Operator entitlement key + org-Admin activation card, connect **held** as a stub), and
  **(3)** a provisioning-model requirement recording the invite-first-vs-JIT open question. It does
  **not** build the live OAuth token exchange, the Graph proxy, or any real Graph data call — those
  are Phase 1+ (see "Out of scope / held").

---

## 1. Context

Supabase's `azure` provider *authenticates* a Microsoft user (SSO, shipped) but persists/refreshes no
Graph token (ADR-0058 §6). Durable, offline/background Graph access requires PMO to own the token
lifecycle server-side (ADR-0060 — Option 2, ratified). Before any user-visible M365 feature, three
invariants must exist so features don't each re-invent them: a **hardened token store**, the
**two-switch entitlement/config** pair (Operator entitles ⇄ Admin activates, ADR-0049), and a decided
**provisioning** posture. Phase 0 lays exactly this foundation and nothing more; the live OAuth
connect action is deliberately **held** pending two owner/Director sub-decisions (§6) and a
`security-auditor` gate (ADR-0060 "Mandatory gate").

The build reuses shipped patterns verbatim: the forced-RLS append-only-by-omission table
(`platform_operators`, `supabase/migrations/0064`), the `org_features` CHECK registry +
`operator_toggle_feature` entitlement switch (`0070`), the org_id seam
(`0074`/`0089`/`0087`), `audit_events` (`0076`), and the FE entitlement resolver
`useFeature`/`FeatureGate` (`pmo-portal/src/auth/useFeature.tsx`) reading `org_features` rows.

---

## 2. Non-functional requirements — the ten binding token-custody controls (ADR-0060)

These are **binding design invariants** on the `ms_graph_connections` store and everything that will
touch it. Phase 0 encodes them **structurally** (the table shape, RLS, grants make several impossible
to violate); the behaviors that require the not-yet-built edge function (proxy, exchange, rotation,
revoke) are invariants the Phase-0 schema must **not preclude**, verified in Phase 1 under the
`security-auditor` gate. Each maps 1:1 to an ADR-0060 control.

- **NFR-M365-001 (Confidential-client, server-only custody — control 1).** The Microsoft **refresh
  token** shall be held and exercised **exclusively server-side** (an edge function acting as an OAuth
  confidential client) and shall **never** transit or persist in the browser, `localStorage`, or any
  client-readable surface.
- **NFR-M365-002 (Proxied Graph calls — control 2).** All Graph calls shall be proxied
  browser → PMO edge function → Graph; no Microsoft access or refresh token shall ever be returned to
  the front-end (the client receives only resulting data).
- **NFR-M365-003 (Envelope encryption at rest — control 3).** Tokens shall be stored **only**
  encrypted (envelope encryption); the key-encryption key (KEK) shall live **outside** the table
  (Supabase secrets / cloud KMS / 1Password vault-`AS`), **never in the repo**, and be rotatable. No
  plaintext token column shall ever exist.
- **NFR-M365-004 (Dedicated, locked-down table — control 4).** Tokens shall live in a dedicated,
  `org_id`-scoped table with **RLS enabled + FORCED and no client-readable policy**; `authenticated`
  and `anon` shall have **zero** access (reachable only by `service_role` / a security-definer edge
  function). Append-only-by-omission (`platform_operators` pattern).
- **NFR-M365-005 (Least-privilege incremental consent — control 5).** The system shall request the
  **minimum Graph scopes per feature, at point of use** (files vs Teams vs calendar consented
  separately), requesting `offline_access` only where a durable refresh token is genuinely required.
- **NFR-M365-006 (Rotation + reuse/failure handling — control 6).** On every refresh the system shall
  persist the **newest** rotated refresh token; on `invalid_grant` / revocation / expiry it shall mark
  the connection **stale** and drive re-consent (never silent retry-loop); an unexpected refresh-token
  reuse shall be treated as a **security event** (logged, connection invalidated).
- **NFR-M365-007 (Revocation & lifecycle — control 7).** The system shall support explicit user/admin
  **disconnect** (delete the stored token + best-effort revoke at Microsoft), and shall **delete**
  stored tokens on user offboard / org disable / feature disentitlement.
- **NFR-M365-008 (Audit without secret leakage — control 8).** Token issuance / refresh / use / revoke
  shall be logged to `audit_events` / `error_events` with **metadata only** (connection id, scope set,
  outcome) — **never** a token value, and never a token in any error string or log line.
- **NFR-M365-009 (Blast-radius contained by topology — control 9).** Under siloed deployment each
  client's tokens shall live only in that client's Supabase project with a per-project KEK; the
  `org_id` scope + per-tenant key derivation is the isolation boundary the seam anticipates for a
  future pooled model.
- **NFR-M365-010 (Transport & secret hygiene — control 10).** HTTPS only; the app client secret and
  the KEK shall live in vault-`AS` / Supabase secrets on a rotation schedule, held solely by the edge
  function.

---

## 3. Functional requirements

### 3.1 The Graph token store (`ms_graph_connections`)

- **FR-M365-001 (Ubiquitous).** The system shall provide a dedicated table `public.ms_graph_connections`
  that stores, per (org, user), **encrypted** Microsoft Graph token material plus non-secret metadata:
  `org_id` (tenancy seam), `user_id`, `entra_tenant_id`, `entra_user_object_id`, granted `scopes`,
  `refresh_token_ciphertext` (bytea), `access_token_ciphertext` (bytea, nullable),
  `access_token_expires_at`, `refresh_token_expires_at`, `key_id` (KEK **reference**, not the key),
  `status`, `connected_at`, `last_refresh_at`, `updated_at`. (Realises NFR-M365-003 structurally: no
  plaintext token column.)
- **FR-M365-002 (Ubiquitous).** `ms_graph_connections` shall have RLS **enabled and forced** with
  **no policy of any kind** and **no table grant** to `authenticated`/`anon`, so that a client JWT can
  neither read nor write it; only `service_role` / a security-definer edge function reaches it.
  (Realises NFR-M365-004.)
- **FR-M365-003 (State-driven).** While a connection exists, its `status` shall be exactly one of
  `active` / `stale` / `revoked` (CHECK-constrained), supporting the rotation → stale → re-consent and
  the revoke/disconnect lifecycles (NFR-M365-006/007). A row shall be `org_id`-scoped with
  `on delete cascade` from `organizations` (so org disable removes its tokens — NFR-M365-007).
- **FR-M365-004 (Where — forward-compatible seam).** Where a row is inserted, `org_id` shall default
  to `coalesce(auth_org_id(), <seed-org>)` (the ADR-0089/0087 forward-compat default). Because the
  only writer is `service_role` (for which `auth_org_id()` is null), the writing edge function shall
  set `org_id` explicitly from the authenticated user's profile — mirroring the `credits` /
  `org_features` cross-org service-definer exclusion in `0074` (no blanket stamp trigger is attached,
  and none is needed, since there is no authenticated INSERT path).

### 3.2 The two-switch entitlement/config surface (ADR-0049, ADR-0058 §Decision 3)

- **FR-M365-010 (Ubiquitous — Operator entitlement switch).** The `org_features` CHECK registry shall
  include the feature key `m365_integration`, and the FE feature registry
  (`pmo-portal/src/lib/features.ts`) shall include it in `FEATURE_KEYS`, `FEATURE_KEYS_TOGGLEABLE`,
  `FEATURE_ENV_DEFAULT` (**default `false`** — an org sees the integration only once entitled), and
  `FEATURE_LABELS` (`"Microsoft 365 integration"`).
- **FR-M365-011 (Event-driven — Operator entitles).** When an Operator toggles `m365_integration` for
  an org, the existing `operator_toggle_feature(p_org_id, p_key, p_enabled)` RPC shall persist it (no
  new RPC — only the CHECK registry expands); a non-Operator caller shall be denied (42501).
- **FR-M365-012 (Where — org-Admin activation surface).** Where the caller's org is entitled to
  `m365_integration` (`useFeature('m365_integration')` true) **and** the viewer's real JWT role is
  Admin, the Administration → Integrations surface shall render a **Microsoft 365 connection card**;
  otherwise the card shall be hidden. (RLS is the enforcement authority; this gate is UX-only,
  ADR-0016.)
- **FR-M365-013 (State-driven — connect held).** While the live OAuth connect action is held (Phase 0),
  the Microsoft 365 connection card shall show a **"Not connected"** state and a **disabled**
  "Connect Microsoft 365 — available soon" affordance that initiates **no** OAuth flow and **no**
  navigation.

### 3.3 Provisioning model

- **FR-M365-020 (Ubiquitous — decision recorded, current graceful state pinned).** The provisioning
  model (keep **invite-first**, or add **JIT** provisioning: domain→org or Entra-group mapping on
  first SSO) is an **OPEN decision** (§6; vision §5 item 5) and **shall not be decided in Phase 0**.
  Until it is decided, an uninvited Microsoft-authenticated user shall continue to receive the graceful
  **"not provisioned yet"** state (`RequireAuth` `profileErrorKind='not_provisioned'`, the calm
  card + Sign out, no Retry, no auto-created profile — the shipped **AC-MSAUTH-010/011** behavior),
  never a raw profile error and never a signup bypass (`enable_signup=false`, ADR-0058 §Decision 1).

---

## 4. Acceptance criteria (Given/When/Then)

> Each AC is owned by **one** test at the lowest sufficient layer (ADR-0010). AC-id is the leading
> token of the owning test's title/description (traceability §5).

**AC-M365-001 (token-store lockdown — pgTAP).**
Given `ms_graph_connections` and a seeded connection row written as the table owner (the
service_role/edge-fn path),
When an `authenticated` (non-service_role) JWT attempts `SELECT` / `INSERT` / `UPDATE`,
Then RLS is enabled and forced, the table has **zero** policies, and every client attempt is denied
(42501) — no client can read or write a token. *(Owns FR-M365-002, NFR-M365-004.)*

**AC-M365-002 (token-store schema invariants — pgTAP).**
Given `ms_graph_connections`,
When its columns and constraints are inspected,
Then `refresh_token_ciphertext` and `access_token_ciphertext` are `bytea` (ciphertext), **no**
`text`-typed column whose name contains `token` exists (no plaintext at rest), `key_id`/`scopes`
columns are present, and a row with a `status` outside `active|stale|revoked` is rejected (23514).
*(Owns FR-M365-001, FR-M365-003, NFR-M365-003 structurally.)*

**AC-M365-010 (Operator entitlement of `m365_integration` — pgTAP).**
Given the `m365_integration` key in the `org_features` CHECK registry,
When an Operator calls `operator_toggle_feature(org, 'm365_integration', true)`,
Then the row persists `enabled=true`, and a non-Operator calling the same RPC is denied (42501).
*(Owns FR-M365-010, FR-M365-011.)*

**AC-M365-011 (entitlement resolves default-off / on — unit).**
Given `useFeature('m365_integration')`,
When the org has no `org_features` row, Then it resolves `false` (default-off);
When the org has the row `enabled`, Then it resolves `true`. *(Owns FR-M365-010, FE side.)*

**AC-M365-012 (activation card visibility — two-switch gate — unit).**
Given the Microsoft 365 connection card,
When the org is not entitled, Then the card is hidden;
When entitled but the viewer is not Admin, Then the card is hidden;
When entitled **and** Admin, Then the card renders. *(Owns FR-M365-012.)*

**AC-M365-013 (held connect stub — unit).**
Given the rendered Microsoft 365 connection card,
When it is displayed, Then it shows "Not connected" and a **disabled** "Connect Microsoft 365 —
available soon" button that starts no OAuth/navigation. *(Owns FR-M365-013.)*

**AC-M365-020 (graceful not-provisioned state preserved — unit, existing owner).**
Given a valid Microsoft session with no `profiles` row (`profileErrorKind='not_provisioned'`),
When `RequireAuth` renders, Then the calm not-provisioned card + Sign out shows (no Retry, no
auto-provision). *(Owns FR-M365-020; **owning test is the existing AC-MSAUTH-010/011** in
`pmo-portal/src/auth/RequireAuth.test.tsx` — Phase 0 adds no new test, only pins the behavior as a
regression guard and records the open decision.)*

---

## 5. Traceability (AC → owning layer/test, per ADR-0010)

| AC | Satisfies | Owning layer | Owning test (leading AC-id) | Verifiable |
|---|---|---|---|---|
| AC-M365-001 | FR-M365-002, NFR-M365-004 | pgTAP (RLS/tenancy) | `supabase/tests/0154_ms_graph_connections_lockdown.test.sql` | **DB-deferred** |
| AC-M365-002 | FR-M365-001/003, NFR-M365-003 | pgTAP (schema/constraint) | `supabase/tests/0143_ms_graph_connections_schema.test.sql` | **DB-deferred** |
| AC-M365-010 | FR-M365-010/011 | pgTAP (RPC/entitlement) | `supabase/tests/0144_org_features_m365_key.test.sql` | **DB-deferred** |
| AC-M365-011 | FR-M365-010 (FE) | Unit (Vitest/RTL) | `pmo-portal/src/auth/__tests__/useFeature.m365.test.tsx` | **Now** |
| AC-M365-012 | FR-M365-012 | Unit (Vitest/RTL) | `pmo-portal/src/components/integrations/__tests__/M365ConnectionCard.test.tsx` | **Now** |
| AC-M365-013 | FR-M365-013 | Unit (Vitest/RTL) | same file (`M365ConnectionCard.test.tsx`) | **Now** |
| AC-M365-020 | FR-M365-020 | Unit (existing) | `pmo-portal/src/auth/RequireAuth.test.tsx` (AC-MSAUTH-010/011) | **Now** (regression pin) |

**NFR verification schedule.** NFR-M365-003/004 are proven now (structurally) by AC-M365-001/002.
NFR-M365-001/002/005/006/007/008/009/010 govern the not-yet-built edge function (exchange, proxy,
rotation, revoke, audit emission) and are **verified in Phase 1** under the mandatory `security-auditor`
gate (STRIDE on the token store, proxy, consent flow — ADR-0060). They are recorded here so the
Phase-0 schema is designed not to preclude them.

**No e2e in Phase 0 (deliberate).** The connect affordance is an inert stub with no cross-stack
outcome to assert, so no curated Playwright journey is owned here (ADR-0010: e2e only for real
cross-stack journeys). The Operator-entitles → Admin-sees-card → connect journey **graduates to one
e2e in Phase 1** when the live connect ships.

---

## 6. Flagged Phase-0 sub-decisions (owner/Director — do NOT decide in-plan)

Both are ADR-0060 "Phase-0 follow-ups"; the plan surfaces them as decision points with a
recommendation but leaves them owner/Director-owned. Neither blocks the Phase-0 build (the store,
lockdown, and config stub ship regardless; the exchange edge function that consumes the choice is
Phase 1).

- **D1 — Encryption mechanism: Supabase Vault (pgsodium/libsodium) vs app-layer AES-256-GCM in the
  edge function.**
  *Recommendation:* **app-layer AES-256-GCM in the edge function**, KEK from Supabase secrets /
  vault-`AS`. Rationale: (a) Vault's `vault.create_secret`/`decrypted_secrets` model fits a small set
  of **named** secrets (as used by `0082`/`0083`), not **per-user/per-connection row** token columns;
  (b) the edge function needs plaintext to call Graph anyway, so co-locating the crypto boundary there
  minimizes plaintext transit; (c) a DB compromise **without** the function's KEK yields only
  ciphertext. Vault stays viable if the owner prefers Postgres-native TCE and enabling the currently
  commented `config.toml` Vault. **Owner/Director decides.**
- **D2 — Bootstrap flow: dedicated server-side authorization-code + PKCE Graph exchange vs one-time
  capture of Supabase's `provider_refresh_token`.**
  *Recommendation:* **dedicated server-side auth-code + PKCE** (ADR-0060 §1 "target flow"). Rationale:
  (a) the refresh token is captured server-side and never touches the client (NFR-M365-001); (b) it
  requests least-privilege incremental scopes per feature, separate from SSO login scopes
  (NFR-M365-005); (c) it is the durable design. The `provider_refresh_token` capture is faster to
  prototype but couples Graph consent to the login moment, inherits whatever scopes SSO used, and
  risks the token transiting the client. **Owner/Director decides.**

- **D3 (adjacent, recorded not owned here) — Provisioning model** (FR-M365-020): invite-first vs JIT.
  Tradeoffs: invite-first keeps the strict "authentication ≠ authorization" line and the shipped
  graceful not-provisioned UX with zero new attack surface, at the cost of an onboarding step; JIT
  (domain→org or Entra-group mapping on first SSO) is zero-touch onboarding and pairs with the
  Entra-group→role feature (vision §3.1) but widens the enrollment surface and must not become an
  accidental signup bypass. **Open — owner decides in a later issue.**

---

## 7. Out of scope / held (Phase 1+)

- **Live OAuth token exchange / bootstrap** (the auth-code+PKCE or provider-refresh-token capture edge
  function) — held pending D1/D2 and the `security-auditor` gate.
- **Real Graph API calls / the edge-function proxy** (NFR-M365-002) — Phase 1 (OneDrive doc linking).
- **Token rotation, reuse-detection, revoke/disconnect, offboard-deletion runtime** (NFR-M365-006/007)
  — the schema supports them; the runtime is Phase 1.
- **Audit emission** for token issuance/refresh/use/revoke (NFR-M365-008) — the `audit_events` sink
  exists (`0076`); the emit calls live in the Phase-1 edge function.
- **Publisher verification** (ADR-0059) — a business task, weeks of lead time; not a code deliverable.
- **Entra app registration / per-client secret provisioning runbook** (ADR-0059 Option C) — ops task,
  tracked in the ADR-0047 provisioning runbook, not this spec.
- **Any M365 data feature** (docs, Teams, calendar, Planner) — Phases 1–5 of the vision.
