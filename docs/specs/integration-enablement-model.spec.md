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

### Observed / legacy behavior to remove

- **OBS-IEM-001:** `resolvePerOrgSecret` currently returns `{ kind: 'no-binding' }` immediately when `connectEnabled` is false, causing flag-off to suppress per-org Vault resolution.
- **OBS-IEM-002:** `external-connect` currently validates, writes Vault/binding, and then calls `admin_change_domain_ownership`; an ownership RPC failure is logged as non-fatal. This permits a partially completed connection.
- **OBS-IEM-003:** The current UI renders `IntegrationsView` unconditionally in `pmo-portal/pages/AdminUsers.tsx`; the connect form is not gated by `EXTERNAL_CONNECT_ENABLED`.
- **OBS-IEM-004:** With ownership employed and resolver disabled, native task columns are protected by `enforce_assignee_status_only()` (migration `0140`), producing the documented trap state.

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

## Out of scope

OAuth, per-org webhook secrets (OD-INT-14), multi-org rollout (ADR-0047), redesign of the adapter contract, and UI redesign beyond truthful connection status and failure messaging.
