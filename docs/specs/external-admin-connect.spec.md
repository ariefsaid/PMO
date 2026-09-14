# Spec — External-system admin-connect layer (ClickUp + ERPNext, org-Admin self-serve)

> **HISTORICAL FOR ENABLEMENT SEMANTICS.** This spec predates the completed integration-enablement
> implementation. For current enablement, default-ON kill-switch behavior, project-scoped task ownership,
> and atomic connect, use ADR-0061 and `docs/specs/integration-enablement-model.spec.md`.

- **Date:** 2026-07-14
- **Author:** eng-planner (Design+Plan phase, `docs/director-playbook.md` §2 step 3)
- **Scope source:** `docs/plans/2026-07-13-clickup-admin-integration-flow.md` (THE SCOPE, framing D1–D5,
  phased plan §5, security §6, §11 discussion outcome + #315 alignment)
- **Locked owner decisions (binding — do not re-litigate):** `docs/decisions.md` **OD-INT-1..5**
- **Depends-on ADRs:** ADR-0055 (external adapters/SoT), ADR-0016 (`can()` UX-only + RLS authority),
  ADR-0019 (server-enforced privileged writes via security-definer RPC), ADR-0017 (repository seam),
  ADR-0018 (soft-archive), ADR-0057 (`verifyCallerJwt` local JWKS verification). New ADR for this layer:
  ADR-0065 (`docs/adr/0065-external-admin-connect.md`).
- **Builds on (merged):** #315 ERPNext P2 → `supabase/migrations/0096_erpnext_seam_tables.sql`
  (`external_org_bindings` + `external_command_outbox` + `external_ref_lineage` + 2 SECURITY DEFINER RPCs);
  `pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts` (the credential-resolution SEAM);
  `supabase/functions/erpnext-onboard/index.ts` (consumption pattern); Vault precedent mig `0082` + `0094`;
  `pmo-portal/src/components/integrations/IntegrationsView.tsx` (the read-only panel to extend).
- **Plan:** `docs/plans/2026-07-14-external-admin-connect.md`. **ADR:** `docs/adr/0065-external-admin-connect.md`.
- **Addendum (2026-09-14, #650):** §7 below — ERPNext activation at Company selection. Plan:
  `docs/plans/2026-09-14-erpnext-activation.md`.

## 1. Overview + job stories

The sync engine already exists (`adapter-dispatch` / `clickup-webhook` / `clickup-sweep` /
`erpnext-onboard` / `erpnext-sweep`, ADR-0055). What is **missing** is the operator/admin **connection**
layer that lets an **org Admin self-serve** the external-system connect from the app, instead of the
current operator-CLI-only path. This spec formalizes that layer as **one tier-generic Connect flow**
serving ClickUp (P1) and ERPNext (P2) — shared `external_org_bindings` + Vault `secret_ref` + one
Connect endpoint + one admin UI card — tier-specific only in (a) credential shape, (b) the validation
call, (c) link granularity (ClickUp → **List** per project · ERPNext → **Company/module** per org).

**Job stories (from scope §1):**
- *When I'm an org admin, I want to connect our org's ClickUp (or ERPNext) with one credential, so PMO
  becomes a two-way sync with that system without a platform operator doing it for me.*
- *When I'm a PM/admin on a PMO project, I want to link it to a ClickUp List, so tasks sync both ways for
  that project (pull existing ClickUp tasks in, push PMO task changes out).*
- *When I'm an admin, I want to see the connection's health (connected / last sync / errors) and be able
  to unlink a project or disconnect the org — with reversibility and an audit trail.*

**Scope fences (binding — Do-NOT, from the brief):**
- No **Phase 0 live-smoke** build task (needs owner-provided REAL ClickUp/ERPNext credentials). It is an
  **OWNER-GATED validation checklist** the plan references; code is built against provisional wire shapes
  + mocked in tests (mirrors the shipped P1 stance, `clickup-webhook` "PROVISIONAL wire shape").
- No **OAuth** (ClickUp OAuth app = later upgrade, OD-INT-2).
- No **multi-List-per-project** or **custom-field mapping** beyond status/member (scope §10).
- No redesign of the shell / design system / existing sync engine — this layer **refactors** the 4 edge
  fns' **credential resolution** to per-org Vault `secret_ref`, it does not rewrite the engine.
- No deletion of the existing **env-based** credential resolver — the Vault variant is **ADDITIVE** (env
  stays as a migration fallback).

## 2. IDs & conventions

- Requirements: **EARS** (ubiquitous / event-driven `When…` / state-driven `While…` / optional `Where…` /
  conditional `While…when…`), IDs `FR-EAC-###` (functional) / `NFR-EAC-###` (non-functional).
- Acceptance criteria: **Given/When/Then**, IDs `AC-EAC-###`. Each AC names its **OWNING test layer**
  (ADR-0010): Unit (Vitest/RTL, mocked) for logic/components; pgTAP (`supabase test db`) for RLS/tenancy/
  role read+write; E2E (Playwright, one curated journey) for the cross-stack connect→link→sync flow.
- `can()` is **UX-only** (ADR-0016); **RLS + the security-definer RPC / role-gated edge fn** are the
  enforcement authority (ADR-0019). Every privileged write (connect/link/disconnect) has a server gate
  + a pgTAP proof.
- Repository seam (ADR-0017): FE → typed repository (`src/lib/integrations/*` via `functions.invoke`) →
  Supabase edge fns. **org_id never leaves the client** (RLS + column defaults/triggers stamp it).

## 3. Requirements (EARS)

### Connect (org-level)

- **FR-EAC-001** — The system SHALL let an org **Admin** connect the org's ClickUp workspace (or ERPNext
  instance) from the Administration → Integrations panel by entering the tier's v1 credential
  (OD-INT-1, OD-INT-2). *(Ubiquitous.)*
- **FR-EAC-002** — When an admin submits the connect credential, the system SHALL **validate** it
  against the external system (ClickUp `GET /v2/user` for the personal-token tier; ERPNext
  `GET /api/method/frappe.auth.get_logged_user` for the `apiKey:apiSecret` tier — valid only on a 2xx whose
  `message` is a non-empty string other than `Guest`; ⚑ #647: the earlier wording `User/<self>` was implemented
  as `User/<apiKey>`, a document Frappe never has, and rejected every live credential) **before** storing
  anything (OD-INT-2). *(Event-driven.)*
- **FR-EAC-003** — On successful validation, the system SHALL store the credential exactly once via
  `vault.create_secret(value, name)` and persist **only** the resulting Vault `secret_ref` (the name) on
  a `external_org_bindings` row for `(org_id, external_tier='clickup'|'erpnext')`; the credential value
  SHALL never be persisted in a DB column and never returned to the client (OD-INT-3). *(Event-driven.)*
  > ⚑ **#650 annotation (2026-09-14) — true as written, but the row it describes is INCOMPLETE for
  > ERPNext.** The row is written by `create_vault_secret_for_org` (mig `0180`), whose `insert` supplies a
  > literal `site_url = ''`. The `siteUrl` the admin typed — SSRF/HTTPS-validated moments earlier by
  > `external-connect` — is then discarded. Nothing in this requirement ever promised `site_url` would be
  > persisted, and nothing persisted it. **FR-EAC-101 adds that promise**; this line is unchanged.

- **FR-EAC-004** — The connect endpoint SHALL run under the caller's JWT, verify it locally
  (`verifyCallerJwt`, ADR-0057), and re-enforce that the caller is an **Admin** of the token's org **or**
  a platform Operator (`is_operator()`) BEFORE any Vault write or binding insert — a non-Admin, non-Operator
  caller is rejected with `403` and no side effect (OD-INT-1, ADR-0019). *(State-driven.)*
- **FR-EAC-005** — The connect endpoint SHALL stamp `connected_by = auth.uid()`, `connected_at = now()`,
  `status = 'active'`, and_SET ownership in `external_domain_ownership` for the tier's owned domains
  (ClickUp → `tasks`; ERPNext → `companies`/`procurement`), reusing the existing
  `operator_set_domain_ownership` semantics but gated on Admin/Operator (not the service-role CLI path).
  *(Event-driven.)*
- **FR-EAC-006** — The system SHALL emit an **audit event** (`log_audit`, mig `0076`) for connect with
  `action='integration.connect'`, `org_id`, `actor=auth.uid()`, `tier` (NFR-EAC-OBS-001). *(Event-driven.)*
- **FR-EAC-007** — An org MAY be connected to at most **one** ClickUp binding and **one** ERPNext binding
  (enforced by `external_org_bindings` unique `(org_id, external_tier)`). A re-connect of an existing tier
  SHALL **rotate** the Vault secret (new `secret_ref`, revoke the old) rather than create a second row.
  *(Event-driven.)*

### Disconnect (org-level)

- **FR-EAC-008** — When an admin disconnects the org's tier binding, the system SHALL (a) mark the
  `external_org_bindings` row `status='disconnected'`, `disconnected_at=now()` (soft-archive, ADR-0018;
  tombstones FK-linked rows, no hard delete), (b) revoke the Vault secret (`vault.delete_secret` by name),
  and (c) emit an audit event `action='integration.disconnect'`. No further sync SHALL read that tier's
  credential (the credential-resolution seam fails closed — NFR-EAC-SEC-003). *(Event-driven.)*
  > ⚑ **#650 annotation (2026-09-14) — the shipped disconnect does (a)(b)(c) and stops there, and the
  > sweep does not read `status`.** `erpnext-sweep`'s `listEmployingOrgsLive` selects every `erpnext`
  > binding and filters on `activated_at` alone; `org_has_active_erpnext_binding` (mig `0160`) likewise
  > tests `activated_at is not null` only. A disconnected ERPNext org therefore still satisfies both
  > employ predicates. Today it fails later and noisily (the Vault secret is gone), so the outcome is
  > fail-closed *by accident*, not by design. **FR-EAC-108 makes disconnect clear the stamps** so the
  > predicates go false at the moment of disconnect.

- **FR-EAC-009** — Disconnect SHALL be role-gated identically to connect (FR-EAC-004) and SHALL require a
  `ConfirmDialog` confirmation in the UI (destructive-write primitive). *(State-driven.)*

### Project link / unlink (ClickUp List; ERPNext Company/module)

- **FR-EAC-010** — When an admin/PM links a PMO project to a ClickUp List, the system SHALL let the caller
  pick the workspace's List from a picker populated by `clickup-lists` (which resolves the org's Vault
  `secret_ref` → ClickUp client → `GET /v2/space`/`folder`/`list`) and choose a **direction** at link time:
  `push-seed` (PMO is source into an empty List) **or** `pull-adopt` (adopt the List's tasks into PMO);
  the **mixed** case (List non-empty + PMO has tasks) is rejected, mirroring `clickup-onboard` (OD-INT-4,
  D4). *(Event-driven.)*
- **FR-EAC-011** — The link endpoint SHALL write an `external_project_bindings` row (ClickUp tier) — or,
  for ERPNext, a Company/module binding — under the caller's org, role-gated Admin/PM (ClickUp list
  link is a delivery write per ADR-0016 `task`/`project` matrix); server re-enforces the role on the
  verified JWT. *(Event-driven.)*
- **FR-EAC-012** — When an admin/PM unlinks a project, the system SHALL soft-drop the binding
  (`disconnected_at`/`archived_at`, keep read-model rows tombstoned per the existing delete-aware dispatch)
  and emit an audit event `action='integration.unlink'`. A linked project whose List was deleted
  externally is surfaced as an error in the health surface, not auto-unlinked. *(Event-driven.)*
- **FR-EAC-013** — ERPNext link granularity is **Company/module per org** (not per project): connecting
  the org binds the ERPNext instance URL + resolved Company defaults (mig `0096` `config` jsonb already
  carries `company`/`default_*`). The admin UI surfaces the **already-connected** ERPNext binding's
  Company; this spec adds only the **connect/disconnect + health** affordance for ERPNext (link CRUD is
  the merged #315 scope). *(State-driven.)*
  > ⚑ **#650 annotation (2026-09-14) — "connecting the org binds the ERPNext instance URL + resolved
  > Company defaults" describes an intent that no shipped code performed.** The URL was not persisted
  > (see FR-EAC-003's annotation) and the Company defaults (`default_payable_account`,
  > `default_cash_account`, `default_bank_account`, `default_expense_account`, `cost_center`) were resolved
  > only by the former `activateBinding` helper, which had **no production call site** — only its own
  > Vitest. Every binding that carried those keys was written by `supabase/seed.sql`, an e2e helper, or
  > operator SQL, so on a real self-serve connect a Payment Entry would post with
  > `paid_from`/`paid_to` undefined. **FR-EAC-104/106 give that intent a call site:** activation is the
  > `activate_external_binding` RPC (migration 0216), invoked by `external-set-company` — which is also
  > the sole consumer of the handshake/defaults helpers in
  > `pmo-portal/src/lib/adapterSeam/erpnext/binding.ts` (the dead `activateBinding` twin was deleted in
  > the review follow-up).

### Credential resolution (per-org Vault, refactor of the 4 edge fns)

- **FR-EAC-014** — The 4 edge fns (`adapter-dispatch`, `clickup-sweep`, `clickup-webhook`, and the
  ERPNext resolver swapped behind `erpnext/credentials.ts`) SHALL resolve the per-org credential from
  Vault via a **locked-down security-definer reader** keyed by `external_org_bindings.secret_ref`, failing
  CLOSED (`config-rejected`) when the secret is missing/blank (OD-INT-3, precedent mig `0082`/`0094`).
  *(Ubiquitous.)*
- **FR-EAC-015** — The existing **env-based** credential resolver (`erpnext/credentials.ts`
  `resolveErpCredentials(secretRef, getEnv)`) SHALL be retained as a **fallback** during migration: a
  binding whose `secret_ref` resolves to no Vault secret falls back to the `<PREFIX>_KEY`/`<PREFIX>_SECRET`
  env pair; if neither resolves, fail closed. *(State-driven.)*
- **FR-EAC-016** — ClickUp SHALL **adopt** `external_org_bindings` for the org connection (today it uses
  `external_domain_ownership` + a single global `CLICKUP_API_TOKEN`); the global `CLICKUP_API_TOKEN` SHALL
  remain as a fallback for orgs not yet migrated onto a per-org Vault `secret_ref` (OD-INT-4). *(Conditional:
  while an org has an `external_org_bindings` row for `external_tier='clickup'`, use per-org Vault; else
  fall back to the global token.)*

### Health + observability

- **FR-EAC-017** — The Integrations panel SHALL surface, per employed tier: connection **status**
  (active/disconnected), **connected_by**, **connected_at**, **last sync** (sweep/webhook last-run from
  `external_sync_watermarks`), and a count of outbox rows in a non-confirmed terminal state
  (`pending`/`failed`/`quarantined`/`held`) as an **errors** indicator (OD-INT-4 health card). *(Event-driven.)*
- **FR-EAC-018** — The health surface SHALL be **read-only** (no write affordance) except the connect/
  disconnect/link/unlink controls already role-gated; non-Admin viewers see the card without controls
  (ADR-0016: FE may be stricter than RLS). *(State-driven.)*

### Non-functional

- **NFR-EAC-SEC-001** — The credential value SHALL NEVER appear in any API response, log line, or DB
  column. Vault write is the only ingress; the security-definer reader is the only egress; the FE
  repository layer never receives a `secret_ref` value (it invokes the edge fn which stores it server-side).
- **NFR-EAC-SEC-002** — Every privileged write (connect, reconnect-rotate, disconnect, link, unlink) is a
  **role-gated edge fn** (caller JWT verified locally + Admin/Operator check) or a **security-definer
  RPC**, with a **pgTAP proof** of the role/tenancy gate (ADR-0019). The FE `can('manage','integration')`
  is UX-only (ADR-0016).
- **NFR-EAC-SEC-003** — Credential resolution **fails closed**: a disconnected org (no active binding, or
  Vault secret revoked) can NEVER reach an external system with the global or another org's credential.
- **NFR-EAC-OBS-001** — All privileged writes + the Vault read tenant scope are audited via `log_audit`
  (mig `0076`) with `action='integration.{connect,disconnect,reconnect,link,unlink}'`, `org_id`,
  `actor`, `tier`.
- **NFR-EAC-REV-001** — Reversibility (ADR-0006/0018): `supabase db reset` reverts all schema; manual
  rollback drops functions before tables in reverse order. Disconnect is a soft-archive (no hard delete).
  Unlink keeps tombstoned read-model rows (existing delete-aware dispatch contract).
- **NFR-EAC-CONTRACT-001** — This layer adds NO new external-system vocabulary above the existing adapter
  contract; it only (a) routes credential resolution through Vault `secret_ref` and (b) adds the connect/
  link admin surface. The sync engine behavior for an org without a Vault binding is byte-for-byte the
  pre-change system (the env/global fallback preserves it).

## 4. Acceptance criteria (Given/When/Then) + owning test layer

> Owning layer per ADR-0010. **RLS/role gates → pgTAP** (`supabase test db`). **Mapping/validation
> logic → Unit** (Vitest, mocked). **Cross-stack connect→link→sync journey → ONE curated Playwright
> e2e** (`e2e/AC-EAC-###-<slug>.spec.ts`). AC-id tagging: the owning test names its `AC-EAC-###` in its
> title/description.

### Connect

- **AC-EAC-001 — validate-before-store** *(Unit, `pmo-portal/src/lib/integrations/validateCredential.test.ts`)*
  - **Given** the `clickup-connect` handler with an injected ClickUp client that returns 401 for a bad
    token and 200 for a valid one,
  - **When** an Admin submits a bad ClickUp personal token,
  - **Then** the handler returns `422 config-rejected`, performs **no** `vault.create_secret`, and inserts
    **no** `external_org_bindings` row.

- **AC-EAC-002 — valid token stores secret_ref only** *(Unit, `pmo-portal/src/lib/integrations/clickupConnect.test.ts`)*
  - **Given** the `clickup-connect` handler with an injected ClickUp client returning 200 + an injected
    Vault writer that records the `(value, name)` it was called with,
  - **When** an Admin submits a valid token for org `O`,
  - **Then** `vault.create_secret` is called exactly once with the raw token and a name derived from
    `(org_id, tier)`, and the handler inserts an `external_org_bindings` row whose `secret_ref` equals that
    Vault name and contains **no** field carrying the raw token.

- **AC-EAC-003 — admin-JWT role gate allows Admin** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** an org `O` with an active **Admin** user `A` and a persistent `external_org_bindings` table,
  - **When** the connect RPC/edge fn runs under user `A`'s verified JWT,
  - **Then** the role gate passes, the binding row is inserted with `org_id=O`, `connected_by=A`,
    `status='active'`, and the `secret_ref` is set server-side (RLS denies a direct client INSERT).

- **AC-EAC-004 — admin-JWT role gate denies non-Admin** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** an org `O` with an active **Engineer** (non-Admin, non-Operator) user `E`,
  - **When** `E` calls the connect endpoint under `E`'s verified JWT,
  - **Then** the role gate rejects the call with `403`, no `vault.create_secret` runs, and no
    `external_org_bindings` row appears for `O`.

- **AC-EAC-005 — cross-tenant isolation** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** org `O1` Admin `A1` connects ClickUp and org `O2` has no binding,
  - **When** `A1` reads the Integrations health source,
  - **Then** `A1` sees only `O1`'s binding (RLS `external_org_bindings_select` conjoins `org_id =
    auth_org_id()` + `is_active_member()`); `O2`'s binding, if any, is invisible.

### Reconnect / rotate

- **AC-EAC-006 — reconnect rotates the Vault secret** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** org `O` already has an active ClickUp binding with `secret_ref=R1`,
  - **When** an Admin re-submits a new valid token,
  - **Then** the binding row is **updated** (`secret_ref=R2`, same `(org_id,external_tier)` — no second
    row), `R1` is revoked from Vault, and one audit event `action='integration.reconnect'` is logged.

### Disconnect

- **AC-EAC-007 — disconnect soft-archives + revokes** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** org `O` has an active ClickUp binding,
  - **When** an Admin invokes disconnect under a verified JWT,
  - **Then** the row becomes `status='disconnected'`, `disconnected_at` is set (no DELETE), the Vault
    secret is deleted, an audit event `action='integration.disconnect'` is logged, and a subsequent
    credential-resolution attempt for `O` fails closed.

- **AC-EAC-008 — disconnected org never reaches external with another's credential** *(Unit,
  `pmo-portal/src/lib/adapterSeam/credentials/vaultResolver.test.ts`)*
  - **Given** a disconnected org `O` binding and Vault reader returning null for `O`'s `secret_ref`,
  - **When** the dispatch handler resolves `O`'s credential,
  - **Then** the resolver throws `config-rejected` and the adapter is never invoked (NFR-EAC-SEC-003).

### Per-org resolution (refactor)

- **AC-EAC-009 — adapter-dispatch resolves per-org Vault secret_ref** *(Unit,
  `pmo-portal/src/lib/adapterSeam/erpnext/dispatchFactory.test.ts` extended; clickup variant added)*
  - **Given** org `O` has a `external_org_bindings` row with `secret_ref=R`,
  - **When** a dispatch command runs for `O`,
  - **Then** the credential is resolved from Vault via `R` (the injected reader), and the resulting
    client's `apiKey`/`apiSecret`/`token` come from Vault — not the global env token.

- **AC-EAC-010 — env fallback retained (ADDITIVE)** *(Unit, `vaultResolver.test.ts`)*
  - **Given** a binding whose `secret_ref` resolves to no Vault secret AND the env `<PREFIX>_KEY` pair IS
    set,
  - **When** the credential resolver runs,
  - **Then** it falls back to the env pair (no behavior change vs. pre-change #315) instead of throwing.

- **AC-EAC-011 — ClickUp adopts external_org_bindings; global token fallback** *(Unit,
  `pmo-portal/src/lib/adapterSeam/clickup/dispatchFactory.test.ts` extended)*
  - **Given** org `O` has a `clickup` `external_org_bindings` row,
  - **When** a ClickUp dispatch runs for `O`,
  - **Then** the client uses the per-org Vault token; given org `O'` has NO such row, the client falls back
    to the global `CLICKUP_API_TOKEN` env (FR-EAC-016).

### Project link / unlink

- **AC-EAC-012 — link picker lists workspace Lists via per-org token** *(Unit,
  `pmo-portal/src/lib/integrations/clickupLists.test.ts`)*
  - **Given** the `clickup-lists` handler with an injected ClickUp client returning Spaces/Folders/Lists,
  - **When** an Admin/PM requests the picker for a connected org,
  - **Then** the response is the flattened List tree, and the per-org Vault token (not the global) is used
    for the read.

- **AC-EAC-013 — link direction enforcement** *(Unit, `pmo-portal/src/lib/integrations/clickupLink.test.ts`)*
  - **Given** a `clickup-link` request with `direction='push-seed'` for a List that already has tasks,
  - **When** the handler runs (injected ClickUp client reports the List non-empty + PMO project has tasks),
  - **Then** the handler rejects the mixed case (`409 action-required`) and writes no binding row (D4).

- **AC-EAC-014 — link writes binding under caller's org, role-gated** *(pgTAP,
  `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** an Admin/PM of org `O` and a chosen List `L`,
  - **When** the link endpoint runs under the verified JWT,
  - **Then** an `external_project_bindings` row is written with `org_id=O`, `list_id=L`, a
    `direction` field, and `linked_by=auth.uid()`; an audit event `action='integration.link'` is logged.

- **AC-EAC-015 — unlink soft-drops + audit** *(pgTAP, `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** a linked project,
  - **When** an Admin/PM unlinks under the verified JWT,
  - **Then** the binding row is soft-archived (no DELETE; tombstones preserved), an audit event
    `action='integration.unlink'` is logged, and the project's tasks retain their read-model rows.

### Health + observability

- **AC-EAC-016 — health surface shows status + last sync + errors** *(Unit (RTL),
  `pmo-portal/src/components/integrations/IntegrationsView.test.tsx`)*
  - **Given** a connected ClickUp tier with a non-empty outbox error count and a recent watermark,
  - **When** the Integrations panel renders,
  - **Then** the Connect/Disconnect card shows `Active`, `connected_by`, `connected_at`, `last sync`,
    and an error count badge; a disconnected tier shows `Disconnected` with a Reconnect affordance only for
    Admin/Operator (`can('manage','integration')`).

- **AC-EAC-017 — non-Admin sees no write controls** *(Unit (RTL), `IntegrationsView.test.tsx`)*
  - **Given** an Engineer (non-Admin) viewing the Integrations panel of a connected tier,
  - **When** the card renders,
  - **Then** no Connect/Disconnect/Link/Unlink controls appear (FE stricter than RLS, ADR-0016/FR-EAC-018).

### End-to-end journey (curated, ONE)

- **AC-EAC-018 — admin connects → links a project → a PMO task change reflects in the (mocked) List, and
  back** *(E2E, `pmo-portal/e2e/AC-EAC-018-connect-link-sync.spec.ts`)*
  - **Given** a seeded org with an Admin user, a ClickUp edge fn mock (or served test-fn wiring) on the
    local stack,
  - **When** the Admin connects ClickUp (mocked validate 200) → links a PMO project to a List
    (`push-seed`) → edits a PMO task status → ClickUp (mocked) fires a webhook for a counterpart change,
  - **Then** the Edit→ClickUp-List change and the webhook→PMO-read-model change both converge, the
    Integrations card shows `Active` with an updated `last sync`, and the outbox for the task reaches
    `confirmed`. (The mock stands in for the un-gated live-smoke.)

### Audit + reversibility

- **AC-EAC-019 — audit events emitted for every privileged write** *(pgTAP,
  `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** an Admin connects, reconnects, disconnects, links, and unlinks in sequence,
  - **When** each call completes,
  - **Then** exactly one `log_audit` row exists per `action in
    ('integration.connect','integration.reconnect','integration.disconnect','integration.link',
    'integration.unlink')` with matching `org_id`, `actor`, `tier`.

- **AC-EAC-020 — reversibility (schema + soft-archive)** *(pgTAP,
  `supabase/tests/external_admin_connect_rls.test.sql`)*
  - **Given** the layer applied (migrations 0104+),
  - **When** `supabase db reset` runs and manual rollback is applied in reverse order,
  - **Then** all layer functions/tables are removable without cascading the merged `external_org_bindings`
  foundation (additive only); a disconnected binding remains tombstoned (no hard delete), proving
  NFR-EAC-REV-001.

## 5. Owner-gated live-smoke (NOT a build task — validation checklist only)

Per the scope-fence, the live-smoke against a real ClickUp/ERPNext workspace is **owner-gated** (needs
owner-provided real credentials). It is referenced by the plan as a validation gate **before production
enable**, not as a build task. The §7 checklist of the scope doc is the operator runbook; code is built
against the **provisional wire shapes** (`types.ts`/`mapping.ts`) + **mocked** in tests, identical to the
shipped P1 stance. A `docs/` live-smoke appendix is produced **after** owner provides credentials, outside
this plan.

## 6. Open questions for the Director

1. **Webhook secret for ClickUp admin-configured orgs.** Today `CLICKUP_WEBHOOK_SECRET` is a single global
   fn env (P1 = one employing org per client). Per-org connect implies a per-org webhook secret stored in
   Vault (`webhook_secret_ref`, already a column on `external_org_bindings` —mig `0096`). The plan assumes
   the admin-connect flow also provisions the webhook secret; confirm the operator retains seeding the
   webhook registration on ClickUp (ClickUp has no API to auto-register webhooks for personal tokens — out
   of band). → **Plan: store `webhook_secret_ref` per org; operator registers the ClickUp webhook out of
   band; the admin-connect flow documents this as a known manual step (scope §10-adjacent).**
2. **`can('manage','integration')` role set.** Spec encodes `Admin` (+ Operator via server gate). Confirm
   Executive is excluded from self-serve (Exec is money authority, not integration admin) — matches the
   Companies `delete` precedent (Admin-only). → **Plan: `integration.manage = Admin` only.**

---

# 7. ADDENDUM (2026-09-14, issue #650) — ERPNext activation at Company selection

- **Author:** eng-planner (Design+Plan, Director-dispatched money/auth lane)
- **Plan:** `docs/plans/2026-09-14-erpnext-activation.md` · **ADR:** `docs/adr/0073-erpnext-activation-at-company-selection.md`
- **Binding rulings this addendum implements:** `OD-INT-6` (ERP sync is paused until a Company is
  selected; the `connected-but-not-activated` state is deliberate and runtime, not schema),
  `DD-OPS-10` (RIS targets ERPNext **v16**; the local dev bed is v15.94.3 — so **both** majors must be
  supported), `DD-XING-2` (`activated_at` is an epoch other logic reads), `OD-INT-1` (Admin ∨ Operator).
- **Out of scope, stated:** credential resolution on the write paths (issue **#651**, running in parallel —
  nothing here touches `resolveErpCredentials` or the sweep's write paths); the **#481** crossing dry-run;
  any UI change beyond the Company-dialog **error copy**.

## 7.1 The gap in one paragraph

`OD-INT-6` says Company selection is what makes an ERPNext binding usable, and `resolveErpDispatchAdapter`
+ `listEmployingOrgsLive` + `org_has_active_erpnext_binding` all gate on `external_org_bindings.activated_at`.
**No shipped code path ever writes `activated_at`, `version_major`, or a non-empty `site_url`.** Every
binding that has them was written by `supabase/seed.sql`, an e2e helper, or operator SQL. So a real
self-serve ERPNext connect produces a binding that (a) has no site URL, so the Company picker and the
Company validation both target an unparseable URL, and (b) can never activate, so no ERP sync will ever
run for that org no matter what the admin does in the UI. The three annotations in §3 record where the
existing prose reads as though this worked.

## 7.2 Requirements (EARS)

### Connect persists the site URL

- **FR-EAC-101** — When an ERPNext connect credential validates, the system SHALL persist the submitted
  `siteUrl` onto the org's `external_org_bindings` row before returning success, via a service-role-only
  security-definer RPC that re-checks the URL is non-empty and `https://`-schemed. *(Event-driven.)*
- **FR-EAC-102** — While an ERPNext binding already carries a non-empty `site_url`, when a connect
  persists a **different** `site_url`, the system SHALL clear `activated_at`, `version_major` and
  `config.company` in the same statement — a repointed connection is un-activated until it re-handshakes.
  *(Conditional: while a site_url exists, when it changes.)*
- **FR-EAC-103** — While an ERPNext binding's `site_url` is empty, the system SHALL refuse Company
  selection with `422` and a message telling the admin to reconnect, and SHALL make no external call and
  no write. *(State-driven.)*

### Company selection IS activation

- **FR-EAC-104** — When an Admin/Operator selects an ERPNext Company and the Company validates against the
  site, the system SHALL perform the version handshake
  (`GET /api/method/frappe.utils.change_log.get_versions`) against the binding's `site_url` using the
  binding's Vault credential, **before** any database write. *(Event-driven.)*
- **FR-EAC-105** — When the handshake's ERPNext major version is not in the supported set `{15, 16}`, the
  system SHALL respond `422` with code `CONFIG_REJECTED` (the handler's 422 vocabulary; review #650
  aligned the one outlier) and a message naming the observed major and the supported set, and SHALL
  write nothing (no `config.company`, no `version_major`, no `activated_at`). *(Event-driven.)*
- **FR-EAC-106** — When the handshake major is supported, the system SHALL, in **one** database statement,
  set `version_major`, merge `config.company` together with the Company account defaults
  (`default_payable_account`, `default_cash_account`, `default_bank_account`, `default_expense_account`,
  `cost_center`) resolved from the same `GET Company/<name>` response, and stamp `activated_at`.
  *(Event-driven.)*
- **FR-EAC-107** — `activated_at` SHALL be set-once for the lifetime of a connection: when a Company is
  selected on a binding whose `activated_at` is already non-NULL, the original value SHALL be preserved.
  It is cleared only by disconnect (FR-EAC-108) or by a site-URL repoint (FR-EAC-102). *(Ubiquitous.)*
  > **Why set-once, concretely.** `activated_at` is `DD-XING-2`'s epoch and the sweep's floor: the
  > timesheet backstop enumerates candidates with `approved_at >= activated_at`. Moving the stamp on a
  > re-select would silently drop every week approved between the first activation and the re-select out
  > of the recovery scope — hours the client's ERP never hears about, with no surface saying so.

### Disconnect un-activates

- **FR-EAC-108** — When an admin disconnects a tier, the system SHALL clear `activated_at`,
  `version_major` and `config.company` in the **same statement** that sets `status='disconnected'` and
  `disconnected_at`. *(Event-driven.)*

### Enforcement + surfacing

- **FR-EAC-109** — `site_url`, `version_major` and `activated_at` SHALL be writable only by the
  service-role activation path (the three new RPCs plus the service-role edge functions that call them).
  *(Ubiquitous.)*
- **FR-EAC-110** — The supported-major allowlist SHALL be enforced in the database as well as in the edge
  function; **the database is the authority** and the edge function is the fast/UX gate. *(Ubiquitous.)*
- **FR-EAC-111** — When the Company-selection endpoint answers non-2xx, the FE repository seam SHALL read
  the endpoint's JSON error body and surface its `message` (the established
  `FunctionsHttpError.context` pattern), so the admin sees why activation was refused rather than
  "Edge Function returned a non-2xx status code". *(Event-driven.)*

### Non-functional

- **NFR-EAC-SEC-101** — The `site_url` write path SHALL keep the existing boundary SSRF/HTTPS guard in
  `external-connect` **and** re-check non-empty + `https://` inside the database RPC. The credential value
  stays in Vault only; nothing in this addendum widens what leaves the server.
- **NFR-EAC-SEC-102** — The three new RPCs SHALL be `service_role`-only EXECUTE (revoked from
  `public`, `anon`, `authenticated`), asserted **on the database that applies the migration** (the
  `0210` idiom), because hosted Supabase's default privileges differ from local Docker.
- **NFR-EAC-SEC-103** — No RESTRICTIVE RLS policy and no column trigger is added to
  `external_org_bindings`. `authenticated`/`anon` hold **SELECT only** on that table (mig `0096` line
  103; no later migration widens it), so a write policy there would be a **dead layer that reads like a
  live control** — the exact failure recorded in `0180` §3 and in the `0203` audit. The live layer is
  the grant surface, and it is proved by a **catalog-derived** pgTAP assertion that fails if a future
  migration re-grants INSERT/UPDATE/DELETE.
- **NFR-EAC-REV-101** — Reversibility (ADR-0006): `supabase db reset`; manual rollback is
  `drop function` on the three new RPCs in reverse order. No column is added, dropped or retyped, so no
  data migration exists to reverse.
- **NFR-EAC-CONTRACT-101** — `supabase/seed.sql` and the e2e helpers keep writing `site_url` /
  `activated_at` / `version_major` directly under the service role; nothing added here blocks them. An
  org that is already activated (seed, e2e, RIS operator SQL) is byte-for-byte unchanged.

## 7.3 Acceptance criteria (Given/When/Then) + owning test layer

> Layers per ADR-0010. **Edge-fn behaviour → Deno unit** importing the SHIPPED handler with
> `globalThis.fetch` mocked (`scripts/check-edge-fn-test-binding.mjs` enforces the binding).
> **RPC gates / grants / atomicity / set-once → pgTAP.** **FE seam → Vitest.**
> **No new Playwright journey** — the only cross-stack proof would need a live Frappe bench, which CI
> does not have; that proof is the owner-gated **#481** dry-run checklist, not a CI e2e.

### Connect persists the site URL

- **AC-EAC-101 — connect persists the submitted site URL** *(Deno unit,
  `supabase/functions/external-connect/connect.test.ts`)*
  - **Given** an Admin JWT, the kill switch enabled, and a mocked ERPNext site whose
    `GET /api/method/frappe.auth.get_logged_user` returns `{"message":"erp-user@example.com"}`,
  - **When** the Admin connects `erpnext` with `siteUrl: 'https://erp.example.com'`,
  - **Then** the handler calls `create_vault_secret_for_org` exactly once **and then**
    `set_external_binding_site_url` exactly once with `p_site_url = 'https://erp.example.com'`, and
    responds `200 { ok: true }`.

- **AC-EAC-102 — a failed site-URL persist does not report a usable connection** *(Deno unit,
  `supabase/functions/external-connect/connect.test.ts`)*
  - **Given** the same setup but `set_external_binding_site_url` returns a Postgres error,
  - **When** the Admin connects `erpnext`,
  - **Then** the handler responds `500` with code `SITE_URL_NOT_PERSISTED` and a message telling the admin
    to retry Connect, and makes **no** call to `activate_external_binding`. (The binding is left
    `site_url=''`, which FR-EAC-103 and the activation RPC's own guard both refuse — the partial state is
    safe by construction, so no destructive compensating delete runs.)

- **AC-EAC-103 — repointing the site URL clears the activation stamps** *(pgTAP,
  `supabase/tests/erpnext_activation.test.sql`)*
  - **Given** an org with an `erpnext` binding at `https://old.example.com`, `activated_at` set,
    `version_major = 15` and `config = {"company":"Old Co"}`,
  - **When** `service_role` calls `set_external_binding_site_url(org,'erpnext','https://new.example.com',admin)`,
  - **Then** `site_url` is the new URL and `activated_at`, `version_major` are NULL and `config` no longer
    has a `company` key; and re-calling with the SAME url leaves an activated binding untouched.

### Company selection IS activation

- **AC-EAC-104 — an empty site URL refuses Company selection before any external call** *(Deno unit,
  `supabase/functions/external-set-company/set-company.test.ts`)*
  - **Given** an Admin JWT and an `active` `erpnext` binding whose `site_url` is `''`,
  - **When** the Admin submits a Company,
  - **Then** the handler responds `422 CONFIG_REJECTED` with a reconnect instruction, makes **zero**
    outbound requests to any ERPNext host, and calls neither `read_vault_secret` nor
    `activate_external_binding`.

- **AC-EAC-105 — the handshake runs before any write** *(Deno unit, `set-company.test.ts` — its own
  titled test since the review follow-up)*
  - **Given** a valid Admin JWT, an active binding with a real `site_url`, and a mocked site where
    `GET /api/resource/Company/ACME` returns 200 and
    `GET /api/method/frappe.utils.change_log.get_versions` returns `{"erpnext":{"version":"15.94.3"}}`,
  - **When** the Admin selects `ACME`,
  - **Then** the recorded fetch order is Company-validate → version-handshake → `activate_external_binding`,
    and there is **no** `PATCH /rest/v1/external_org_bindings` at all (the write moved into the RPC).

- **AC-EAC-106 — an unsupported major refuses with a legible 422 and writes nothing** *(Deno unit,
  `set-company.test.ts`)*
  - **Given** the same setup but the handshake returns `{"erpnext":{"version":"14.30.1"}}`,
  - **When** the Admin selects `ACME`,
  - **Then** the response is `422` with `error: 'CONFIG_REJECTED'` and a message containing both `14` and
    `15 and 16`, and `activate_external_binding` and `log_audit` are each called **zero** times.

- **AC-EAC-107 — a v15 handshake activates** *(Deno unit, `set-company.test.ts`)*
  - **Given** the handshake returns `15.94.3` and `GET Company/ACME` returns
    `default_payable_account: 'Creditors - A'`, `default_cash_account: 'Cash - A'`,
  - **When** the Admin selects `ACME`,
  - **Then** `activate_external_binding` is called once with `p_version_major = 15`, `p_company = 'ACME'`
    and a `p_config_patch` carrying those two account defaults, and the response body is
    `{ ok: true, companyId: 'ACME', versionMajor: 15, activatedAt: <the RPC's return> }`.

- **AC-EAC-108 — a v16 handshake activates** *(Deno unit, `set-company.test.ts`)*
  - **Given** the handshake returns `16.33.0` (`DD-OPS-10`: RIS's target),
  - **When** the Admin selects `ACME`,
  - **Then** `activate_external_binding` is called once with `p_version_major = 16` and the response is
    `200`.

- **AC-EAC-109 — activated_at is set-once across re-selection** *(pgTAP,
  `supabase/tests/erpnext_activation.test.sql`)*
  - **Given** an active `erpnext` binding with a `site_url`, activated at `T0` with `company = 'A'`,
  - **When** `service_role` calls `activate_external_binding(...,'B',...)` at a later instant,
  - **Then** `config->>'company'` is `'B'` and `activated_at` is still exactly `T0`; and after a
    `deactivate_external_binding` + a fresh `activate_external_binding`, `activated_at` is a NEW, later
    instant.

- **AC-EAC-110 — activation is atomic and refuses an unusable binding** *(pgTAP,
  `erpnext_activation.test.sql`)*
  - **Given** an `erpnext` binding that is either `status <> 'active'` or has `site_url = ''`,
  - **When** `service_role` calls `activate_external_binding`,
  - **Then** it raises `P0001` and the row is unchanged (`activated_at`, `version_major` and
    `config->'company'` all still absent) — company, version and stamp are never partially written.

- **AC-EAC-111 — the database rejects an unsupported major independently of the edge function** *(pgTAP,
  `erpnext_activation.test.sql`)*
  - **Given** a connectable `erpnext` binding,
  - **When** `service_role` calls `activate_external_binding` with `p_version_major = 14`,
  - **Then** it raises `P0001` and nothing is written — proving FR-EAC-110's "the database is the
    authority" rather than trusting the edge function's check.

### Enforcement

- **AC-EAC-112 — the three RPCs are service-role only** *(pgTAP, `erpnext_activation.test.sql`)*
  - **Given** an authenticated Admin session (`set local role authenticated` + JWT claims),
  - **When** that session calls `set_external_binding_site_url`, `activate_external_binding` or
    `deactivate_external_binding`,
  - **Then** each raises `42501`, and `has_function_privilege('anon'|'authenticated', …, 'EXECUTE')` is
    false for all three while `service_role` retains EXECUTE.

- **AC-EAC-113 — no client write surface exists on the binding table** *(pgTAP,
  `erpnext_activation.test.sql`)*
  - **Given** the catalog at head,
  - **When** `information_schema.role_table_grants` is queried for
    `table_name = 'external_org_bindings'` and `grantee in ('anon','authenticated')`,
  - **Then** the returned `privilege_type` set is exactly `{SELECT}` — so a future migration that
    re-grants INSERT/UPDATE/DELETE fails this test rather than silently opening a direct path to
    `activated_at`.

- **AC-EAC-114 — disconnect un-activates, so the employ predicates go false** *(pgTAP,
  `erpnext_activation.test.sql`)*
  - **Given** an activated `erpnext` binding for org `O` for which
    `org_has_active_erpnext_binding(O)` is true,
  - **When** `service_role` calls `deactivate_external_binding(O,'erpnext',admin)`,
  - **Then** `status='disconnected'`, `disconnected_at` is set, `activated_at` and `version_major` are
    NULL, `config` has no `company` key, and `org_has_active_erpnext_binding(O)` is now false.

### Surfacing + the shared handshake

- **AC-EAC-115 — the FE seam surfaces the endpoint's own message** *(Vitest,
  `pmo-portal/src/lib/repositories/integrations.setCompany.test.ts`)*
  - **Given** `supabase.functions.invoke` rejects with a `FunctionsHttpError`-shaped error whose
    `.context` Response body is
    `{"error":"CONFIG_REJECTED","message":"ERPNext 14 is not supported (PMO supports 15 and 16)."}`
    (the endpoint's real body — review #650 aligned the code to `CONFIG_REJECTED`),
  - **When** `repositories.integrations.setCompany(org,'erpnext','ACME')` is awaited,
  - **Then** it rejects with an `AppError` whose `.message` is that sentence and `.code` is
    `CONFIG_REJECTED` (passed through verbatim by the seam), so `classifyMutationError(err).detail`
    renders it in the Company dialog.

- **AC-EAC-116 — the handshake helper is one derivation, budget-bounded, and it supports 15 and 16**
  *(Vitest, `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts`)*
  - **Given** `fetchErpVersionMajor` with a mocked fetch,
  - **When** the site reports `15.94.3`, `16.33.0` and `14.30.1` in three runs,
  - **Then** it returns `15`, `16` and `14` respectively; `SUPPORTED_VERSION_MAJORS` contains exactly
    `[15, 16]`; a hung site aborts at the handshake's 5s deadline and a retryable response is NOT
    retried (`timeoutMs: 5000, maxRetries: 0` — review #650); and `companyDefaultsFromDoc` keeps a
    default only when it is a 1–140-char string (ERPNext Link limit), else `null`. *(The former
    `activateBinding` twin was deleted with its tests — review #650: activation semantics live in the
    `activate_external_binding` RPC, migration 0216.)*

- **AC-EAC-117 — the disconnect suite binds to the shipped handler** *(Guard,
  `scripts/check-edge-fn-test-binding.mjs` + `pmo-portal/src/lib/agent/checkEdgeFnTestBinding.test.ts`)*
  - **Given** `external-disconnect` now performs a money-adjacent write (clearing the activation epoch),
  - **When** `npm run check:edge-test-binding` runs,
  - **Then** it requires `disconnect.test.ts` to import `handleDisconnectRequest` from `./index.ts` and
    requires `index.ts` to export it behind an `import.meta.main` guard — the current suite asserts only
    re-implemented local booleans and would pass while the shipped handler is broken.

- **AC-EAC-118 — the disconnect audit event is written with the fixed `log_audit` arg shape** *(Deno
  unit, `supabase/functions/external-disconnect/disconnect.test.ts` — owned by the AC-EAC-114/118-titled
  test)*
  - **Given** an Admin JWT and an existing binding,
  - **When** the Admin disconnects,
  - **Then** `log_audit` is called exactly once with `p_action = 'integration.disconnect'`, the REQUIRED
    `p_actor_id`, and NO `p_entity_type` key. *(The shipped call passed `p_entity_type` — no such
    parameter — and omitted `p_actor_id`, so no overload of `log_audit(text,uuid,uuid,uuid,jsonb)`
    matched and the disconnect audit event was never written.)*

## 7.4 Traceability — owning layer per AC

| AC | Owning layer | Owning file |
|---|---|---|
| AC-EAC-101, 102 | Deno unit | `supabase/functions/external-connect/connect.test.ts` |
| AC-EAC-104..108 | Deno unit | `supabase/functions/external-set-company/set-company.test.ts` |
| AC-EAC-103, 109, 110, 111, 112, 113, 114 | pgTAP | `supabase/tests/erpnext_activation.test.sql` |
| AC-EAC-115 | Vitest | `pmo-portal/src/lib/repositories/integrations.setCompany.test.ts` |
| AC-EAC-116 | Vitest | `pmo-portal/src/lib/adapterSeam/erpnext/binding.test.ts` |
| AC-EAC-117 | Verify gate | `scripts/check-edge-fn-test-binding.mjs` |
| AC-EAC-118 | Deno unit | `supabase/functions/external-disconnect/disconnect.test.ts` |

## 7.5 Deliberate behaviour changes to existing green tests

The BDD rule forbids bending an assertion to the app; these two are *deliberate* behaviour changes and
the plan records the justification with each.

1. **`binding.test.ts` — "a v16 handshake leaves the binding un-activated" must be inverted.** It encodes
   the pre-`DD-OPS-10` v15-only pin. `DD-OPS-10` ruled RIS targets v16, so v16 activating is the new
   correct behaviour. The v14 case stays as the negative oracle.
2. **`set-company.test.ts` — four cases assert `restCall(calls,'external_org_bindings','PATCH').length`.**
   FR-EAC-106 moves that write into `activate_external_binding` so company + version + stamp cannot land
   partially. The **goal** oracle ("the selected Company is persisted for this org") is unchanged; only the
   mechanism assertion moves to `rpcCall(calls,'activate_external_binding')`.

## 7.6 Open questions for the Director (addendum)

1. **Reconnect-rotate leaves a destructive compensating delete on the ClickUp branch.** On a rotate,
   `cleanup_external_connect_attempt` DELETEs the `(org, tier, secret_ref)` row — which after the rotate is
   the org's ONE live binding. A failed ClickUp finalize therefore destroys a working connection rather
   than rolling back to it. Pre-existing, not introduced here, and deliberately not copied onto the ERPNext
   branch (AC-EAC-102 leaves the row instead and lets the activation guard refuse it). **Worth its own
   issue?**
2. **SETTLED (2026-09-14, Director ruling): Company account defaults are IN scope.** The brief asked only
   for `version_major` + `activated_at`, but `bodies/paymentEntry.ts` reads `config.default_cash_account` /
   `default_bank_account` / `default_payable_account`, and nothing populated them on a self-serve connect —
   activating without them would activate a binding whose first Payment Entry posts with undefined accounts.
   FR-EAC-106 fills them from the `GET Company/<name>` the handler already makes (`companyDefaultsFromDoc`),
   and the defaults shipped in Phase 4 with their own tests (AC-EAC-107/108).
3. **SETTLED (2026-09-14, verified live on the v16.33 bench): the field names carry over.** An
   Administrator-session `GET Company/PMO Smoke Co` on v16.33 confirmed `default_payable_account`,
   `default_cash_account`, `default_expense_account` and `cost_center` under the v15 names;
   **`default_bank_account` is ABSENT on v16** (the key is not on the doc at all, not null-valued), so the
   mapper's absent-⇒-`null` rule fires for that one field on every v16 activation — "no default", which
   `paymentEntry.ts`'s `??` chain treats correctly. AC-EAC-108 pins this exact shape (four keys present,
   one missing). `frappe.utils.change_log.get_versions` was likewise confirmed `@frappe.whitelist()` on
   v16.33 (`change_log.py:104`).
