# Spec — Integration enablement model (per-org authority, operator break-glass)

- **Date:** 2026-07-22
- **Status:** Proposed — owner approval required before implementation
- **Scope:** ClickUp integration enablement; the shared resolver also serves other external tiers where applicable.
- **Related:** OD-INT-14 (single-org scope; per-org webhook secret deferred), ADR-0055 (external-system SoT), ADR-0016 (`can()` is UX-only; server is authority), ADR-0018 (soft-archive), ADR-0047 (multi-org deferred).
- **AC series evidence:** `git grep -ohE 'AC-[A-Z]+-[0-9]+' | sort -u` returned no `AC-IEM-*` identifier. This spec therefore reserves `AC-IEM-001` through `AC-IEM-008`.

## Problem and job story

`EXTERNAL_CONNECT_ENABLED` is deployment-wide, while connection and domain ownership are per org. When the flag is false, an org admin can currently complete `external-connect`; ClickUp `tasks` can become externally owned while the sync resolver returns `no-binding`. PMO native task fields then reject non-service writes, and no external sync runs, although the UI reports Active.

**Job story:** When I am a client org-admin, I want connecting ClickUp to either establish a usable sync or fail without changing task ownership, so my organization is never left with an Active-looking but unusable integration.

## Definitions

- **Per-org enablement:** an active `external_org_bindings` row for the org and tier, together with the corresponding `external_domain_ownership` row(s). These are the authority for whether the org employs ClickUp.
- **Kill-switch:** `EXTERNAL_CONNECT_ENABLED`, read by server-side integration paths only. It disables all external integration execution when explicitly false; it is not per-org enablement.
- **Usable sync:** the kill-switch permits execution, the active binding resolves its Vault credential, and the existing ClickUp adapter/sweep/webhook dispatch path can accept the org's credential. A successful credential validation alone is insufficient.
- **Trap state:** ClickUp `tasks` is employed in `external_domain_ownership`, but the binding cannot be resolved by the sync path (including the current flag-off behavior).

## Requirements (EARS)

### Functional

- **FR-IEM-001 (ubiquitous):** The system SHALL treat an active, org-scoped `external_org_bindings` row and matching `external_domain_ownership` as the authority for whether that org employs ClickUp; client UI affordance state SHALL not be the authority.
- **FR-IEM-002 (conditional):** While `EXTERNAL_CONNECT_ENABLED` is explicitly set to `false`, every ClickUp execution path that can dispatch or sweep work SHALL fail closed for external execution, and SHALL not mutate PMO task ownership or claim that sync is healthy. This is an operator break-glass state, not a per-org connection state.
- **FR-IEM-003 (ubiquitous):** In a deployed environment, the kill-switch SHALL default to enabled when unset or absent; only an explicit, documented false value SHALL disable the integration. The deployed configuration SHALL record the effective value and rollout verification.
- **FR-IEM-004 (conditional):** While the kill-switch is enabled, a correctly-connected org SHALL resolve its own active binding's Vault credential and use the existing ClickUp sync paths; the resolver SHALL never use the global flag as a substitute for the binding decision.
- **FR-IEM-005 (event-driven):** When an org-admin submits ClickUp connect, the system SHALL validate the credential, confirm that the kill-switch permits sync, and verify the org's binding can be resolved by the sync path before employing `tasks` ownership.
- **FR-IEM-006 (event-driven):** When connect succeeds, the system SHALL commit the binding and ownership change as one logical operation; if Vault write, binding persistence, ownership employment, or sync-readiness verification fails, it SHALL not leave `tasks` employed by that connect attempt. Any orphaned Vault secret SHALL be revoked or queued for deterministic cleanup.
- **FR-IEM-007 (event-driven):** When connect cannot complete, the client SHALL receive a non-success response with a safe, actionable message (for example, integration disabled by operator or ClickUp sync is not ready), SHALL not receive credential material or Vault contents, and SHALL display the tier as not Active.
- **FR-IEM-008 (state-driven):** While an org is in the trap state, recovery SHALL first restore a resolvable credential and permitted sync path, then verify a bounded sync health check, and only then retain/employ ClickUp ownership. If readiness cannot be restored, recovery SHALL release `tasks` ownership before reporting the integration usable; the runbook SHALL identify affected task writes and audit the repair.
- **FR-IEM-009 (event-driven):** When the operator kill-switch is turned off after an org has a valid active binding, the system SHALL resume that org's existing per-org sync after the switch is restored without requiring the org-admin to reconnect or re-enter a credential.

#### Ownership granularity (owner ruling 2026-07-22 — supersedes the org-wide reading of ADR-0055 §7)

- **FR-IEM-010 (ubiquitous):** Task-domain ownership SHALL follow the **project binding**, not the org. A PMO project's tasks are ClickUp-owned **if and only if** that project has an active `external_project_bindings` row for the `clickup` tier. Employing ClickUp at org level SHALL NOT, by itself, make any project's tasks read-only.
- **FR-IEM-011 (state-driven):** While a project has no active ClickUp binding, its tasks SHALL remain fully PMO-owned and editable — creatable, editable and deletable by the normal PMO write-roles — even while the org employs ClickUp for other projects. Mixed mode (some projects on ClickUp, some PMO-native) is a supported steady state, not a transitional one.
- **FR-IEM-012 (event-driven):** When a project is unlinked from its ClickUp List, its tasks SHALL return to PMO-owned and editable, and the mirrored task data SHALL be retained (soft-archive/tombstone semantics per ADR-0018, consistent with the existing unlink reversibility contract).
- **FR-IEM-013 (event-driven):** When a project is created while the org employs ClickUp, its tasks SHALL be PMO-owned and editable until an org-admin or that project's PM explicitly binds it to a List. A new project SHALL NEVER be born read-only.
- **FR-IEM-014 (ubiquitous):** While the org employs ClickUp, the Admin UI SHALL present a **binding map** showing, for every PMO project, which ClickUp List it is bound to (and which projects are unbound / PMO-native). The map is the org-admin's view of what is delegated to ClickUp and what is not.
- **FR-IEM-015 (ubiquitous):** The server SHALL be the authority for the per-project ownership decision (the column-pin trigger and RLS), evaluated per project; `can()` and the binding map remain UX-only per ADR-0016.

#### Unbound sides (owner ruling 2026-07-22 — "no project on either side")

Binding is a **two-sided, partial** relation: PMO projects may be unbound, ClickUp Lists may be
unbound, and either side may be empty entirely. Each case is specified, none is an error.

- **FR-IEM-016 (event-driven):** When an inbound ClickUp change arrives for a task whose List has **no
  active project binding** for that org, the system SHALL NOT create or update any PMO task. It SHALL
  NOT infer a project. Specifically, the current "single employing org ⇒ use its only binding"
  fallback SHALL be removed: an unresolvable binding is a **no-op**, not a guess.
- **FR-IEM-017 (event-driven):** When such an unresolvable inbound event is discarded, the system
  SHALL record it as an observable signal (health/audit) rather than dropping it silently, so an
  org-admin can see that ClickUp activity exists outside what PMO tracks.
- **FR-IEM-018 (ubiquitous):** The reconciliation sweep SHALL enumerate **only bound Lists**. An
  unbound List's tasks SHALL never be read into PMO.
- **FR-IEM-019 (state-driven):** While an org employs ClickUp but has **no project bindings at all**
  (including immediately after connect), the integration SHALL be a valid, healthy, inert state: no
  task is ClickUp-owned, all PMO tasks stay editable, no sync runs, and the tier SHALL still report
  `Active` (the credential is valid) with an empty binding map — not an error or a warning.
- **FR-IEM-020 (ubiquitous):** The Admin binding map (FR-IEM-014) SHALL show **both** directions: each
  PMO project with its bound List or marked PMO-native, **and** ClickUp Lists in the workspace that are
  bound to no PMO project — so the admin can see what is delegated, what is not, and what exists in
  ClickUp that PMO does not track.
- **FR-IEM-021 (event-driven):** When a bound PMO project is deleted or archived, its binding SHALL be
  released (the project stops being ClickUp-owned) and the map SHALL surface the now-unbound List
  rather than retaining a binding to a project that no longer exists.

### Observed / legacy behavior to remove

- **OBS-IEM-001:** `resolvePerOrgSecret` currently returns `{ kind: 'no-binding' }` immediately when `connectEnabled` is false, causing flag-off to suppress per-org Vault resolution.
- **OBS-IEM-002:** `external-connect` currently validates, writes Vault/binding, and then calls `admin_change_domain_ownership`; an ownership RPC failure is logged as non-fatal. This permits a partially completed connection.
- **OBS-IEM-003:** The current UI renders `IntegrationsView` unconditionally in `pmo-portal/pages/AdminUsers.tsx`; the connect form is not gated by `EXTERNAL_CONNECT_ENABLED`.
- **OBS-IEM-004:** With ownership employed and resolver disabled, native task columns are protected by `enforce_assignee_status_only()` (migration `0140`), producing the documented trap state.
- **OBS-IEM-005:** `supabase/functions/clickup-webhook-worker/index.ts:170` calls `resolvePerOrgSecret` with `connectEnabled: true` **hard-coded**, so inbound webhook application bypasses the flag entirely. Consequently the trap state is not "nothing syncs" but an **asymmetric one-way mirror**: ClickUp→PMO changes still land while PMO→ClickUp (`adapter-dispatch`) and the healing sweep (`clickup-sweep`) are both suppressed — and PMO's own tasks are read-only. A kill-switch that a component hard-codes past is not a kill-switch.
- **OBS-IEM-008:** `clickup-webhook-worker`'s `resolveBindingLive` tier-3 fallback attributes an unresolvable task to the org's only `external_project_bindings` row when that org is the single employing org (`.maybeSingle()`). A task from an **unbound** ClickUp List is therefore minted into an unrelated PMO project — ClickUp-side work the client never delegated silently appears in PMO. This fallback must be removed, not narrowed.
- **OBS-IEM-007:** `external_domain_ownership` is keyed `unique (org_id, external_tier, domain)` — **org-wide** — while `external_project_bindings` is per `(org_id, project_id, tier)`. `enforce_assignee_status_only()` (migration `0140`) and the `0093` task RLS policies both gate on `domain_externally_owned(org_id,'tasks')`, so employing ClickUp makes **every task in every project** read-only while only *bound* projects sync. A client piloting ClickUp on one of ten projects gets nine projects of permanently read-only, never-syncing tasks — the trap state generalized, independent of the kill-switch.
- **OBS-IEM-006:** The flag's blast radius is not ClickUp-only: `erpnext-onboard` (2 refs), `erpnext-sweep` (2), and `erpnext-webhook` (3) also read `EXTERNAL_CONNECT_ENABLED`. Any change to its semantics affects the ERPNext tier identically and MUST be specified for both tiers.

### Non-functional

- **NFR-IEM-001:** The kill-switch and binding decision SHALL be evaluated server-side on every relevant execution; client state and `can()` remain UX-only per ADR-0016.
- **NFR-IEM-002:** The design SHALL preserve the `org_id` seam and RLS/role enforcement, remain compatible with OD-INT-14's single-org webhook-secret decision, and avoid storing credential values outside Vault.
- **NFR-IEM-003:** Connect and recovery SHALL be idempotent and auditable, including actor, org, tier, effective kill-switch decision, readiness result, and ownership action; rollback SHALL be a reversible migration and an operationally safe disable path.

## Acceptance criteria

### AC-IEM-001 — kill-switch default and break-glass semantics *(owning layer: unit)*
**Given** the kill-switch is absent, **when** a resolver or dispatch path evaluates it, **then** it treats the switch as enabled.
**Given** the switch is explicitly false, **when** a ClickUp execution path evaluates it, **then** it fails closed and does not perform external work or change domain ownership.

### AC-IEM-002 — per-org binding is authority *(owning layer: unit)*
**Given** two org-scoped bindings and an enabled kill-switch, **when** each org syncs, **then** each resolves only its own active binding/Vault secret, and a missing binding is not converted into another org's credential or a false Active state.

### AC-IEM-003 — connect is atomic on readiness failure *(owning layer: pgTAP)*
**Given** a valid ClickUp token but disabled kill-switch or failed sync-readiness check, **when** an org-admin connects, **then** the operation fails, `tasks` is not employed, no Active binding is committed, and any created Vault secret is revoked/cleaned up.

### AC-IEM-004 — connect succeeds as one operation *(owning layer: curated e2e)*
**Given** an org-admin has a valid token, the kill-switch permits execution, and the resolver/adapter readiness check passes, **when** they submit Connect, **then** the UI reports Active only after binding and ownership are committed and a sync invocation can run with that org's credential.

### AC-IEM-005 — safe client failure *(owning layer: unit)*
**Given** connect fails for disabled integration, invalid credentials, or unavailable sync readiness, **when** the response reaches the client, **then** it shows a tier-specific actionable error, remains not Active, and contains no token, Vault secret value, or secret contents.

### AC-IEM-006 — trapped-org recovery *(owning layer: pgTAP)*
**Given** an org has employed ClickUp tasks but no resolver-usable binding, **when** the recovery procedure runs, **then** it either restores the binding and proves sync readiness before retaining ownership, or releases ownership and leaves the org editable in PMO; the procedure is idempotent and audited.

### AC-IEM-007 — kill-switch recovery without reconnect *(owning layer: curated e2e)*
**Given** an org has a valid active binding and ownership, **when** the operator disables and then re-enables the kill-switch, **then** the org's existing binding resumes sync without re-entering credentials or reconnecting.

### AC-IEM-008 — server-side enforcement and tenancy *(owning layer: pgTAP)*
**Given** a caller or database session from another org or without the required role, **when** it attempts connect, ownership employment, or recovery, **then** server authorization/RLS rejects it and no cross-org state changes occur; `can()` does not replace this enforcement.

### AC-IEM-009 — the kill-switch is honoured uniformly by every execution path *(owning layer: unit)*
**Given** the operator kill-switch is engaged, **when** ANY integration execution path runs — outbound dispatch, the reconciliation sweep, **and inbound webhook application** — **then** each one resolves no per-org credential and performs no external I/O; no path may hard-code its enablement (cf. OBS-IEM-005), and this holds identically for the `clickup` and `erpnext` tiers (cf. OBS-IEM-006).

### AC-IEM-010 — unbound projects stay PMO-editable while the org employs ClickUp *(owning layer: pgTAP)*
**Given** an org employing ClickUp with project A bound to a List and project B unbound, **when** a PMO write-role user edits a task's native fields in project B, **then** the write succeeds; **and when** the same user edits a task in project A, **then** the write is rejected (`42501`) because ClickUp owns it.

### AC-IEM-011 — a project created after employing ClickUp is not born read-only *(owning layer: pgTAP)*
**Given** an org already employing ClickUp, **when** a new project is created and no binding exists for it, **then** its tasks are creatable and editable by PMO write-roles.

### AC-IEM-012 — unlink returns a project's tasks to PMO-editable, retaining mirrored data *(owning layer: pgTAP)*
**Given** a bound project whose tasks are ClickUp-owned, **when** the project is unlinked, **then** its tasks become editable by PMO write-roles and the previously mirrored task rows are still present (not hard-deleted).

### AC-IEM-013 — the Admin binding map reflects actual bindings *(owning layer: unit)*
**Given** an org employing ClickUp with a mix of bound and unbound projects, **when** an org-admin opens the Integrations admin surface, **then** each project is listed with its bound ClickUp List (or shown as PMO-native/unbound), matching `external_project_bindings` exactly.

### AC-IEM-014 — an unbound ClickUp List never leaks tasks into PMO *(owning layer: unit)*
**Given** an org employing ClickUp with exactly one bound project, **when** an inbound change arrives for a task in a List bound to no PMO project, **then** no PMO task is created or updated in any project — in particular not in the single bound project — and the event is recorded as unresolvable.

### AC-IEM-015 — employing ClickUp with zero bindings is healthy and inert *(owning layer: pgTAP)*
**Given** an org that has connected ClickUp but bound no projects, **when** the state is inspected, **then** the tier reports `Active`, no task in any project is ClickUp-owned, every PMO task remains editable by write-roles, and no sync work is enumerated.

### AC-IEM-016 — the binding map shows unbound Lists as well as unbound projects *(owning layer: unit)*
**Given** a workspace with List L1 bound to project P1 and List L2 bound to nothing, and PMO project P2 unbound, **when** an org-admin opens the map, **then** P1→L1 is shown as bound, P2 is shown PMO-native, and L2 is shown as a ClickUp List PMO does not track.

## Out of scope

OAuth, per-org webhook secrets (OD-INT-14), multi-org rollout (ADR-0047), redesign of the adapter contract, and UI redesign beyond truthful connection status and failure messaging.
