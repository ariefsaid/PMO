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
  ADR-0059 (`docs/adr/0059-external-admin-connect.md`).
- **Builds on (merged):** #315 ERPNext P2 → `supabase/migrations/0096_erpnext_seam_tables.sql`
  (`external_org_bindings` + `external_command_outbox` + `external_ref_lineage` + 2 SECURITY DEFINER RPCs);
  `pmo-portal/src/lib/adapterSeam/erpnext/credentials.ts` (the credential-resolution SEAM);
  `supabase/functions/erpnext-onboard/index.ts` (consumption pattern); Vault precedent mig `0082` + `0094`;
  `pmo-portal/src/components/integrations/IntegrationsView.tsx` (the read-only panel to extend).
- **Plan:** `docs/plans/2026-07-14-external-admin-connect.md`. **ADR:** `docs/adr/0059-external-admin-connect.md`.

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
  `GET /api/resource/User/<self>` for the `apiKey:apiSecret` tier) **before** storing anything
  (OD-INT-2). *(Event-driven.)*
- **FR-EAC-003** — On successful validation, the system SHALL store the credential exactly once via
  `vault.create_secret(value, name)` and persist **only** the resulting Vault `secret_ref` (the name) on
  a `external_org_bindings` row for `(org_id, external_tier='clickup'|'erpnext')`; the credential value
  SHALL never be persisted in a DB column and never returned to the client (OD-INT-3). *(Event-driven.)*
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
