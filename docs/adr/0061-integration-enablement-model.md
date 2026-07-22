# ADR-0061 — Per-org integration enablement with operator break-glass

- **Status:** Proposed — owner approval required
- **Date:** 2026-07-22
- **Deciders:** Owner, Director (pending formal sign-off)
- **Related:** `docs/specs/integration-enablement-model.spec.md`; OD-INT-14; ADR-0055 (external-system SoT); ADR-0016 (`can()` UX-only, server authority); ADR-0018 (soft-archive); ADR-0047 (multi-org deferred); ADR-0059 (admin connect foundation).

## Context

`EXTERNAL_CONNECT_ENABLED` was introduced as a global rollout gate while per-org Vault credentials were being built. The later admin self-serve flow made `external_org_bindings` and `external_domain_ownership` per-org, but the resolver still treats the global flag as a prerequisite. `external-connect` also currently logs an ownership-RPC failure and returns success, after the binding/Vault write has already happened.

That combination permits an org-admin to see an Active connection while ClickUp `tasks` is employed and the sync paths cannot resolve a credential. Migration `0140` then rejects native task-field writes for non-service users. This is an architectural authorization error: deployment configuration is deciding whether an individual org is enabled, while the UI and database advertise that the org is enabled.

OD-INT-14 keeps the current single-org webhook-secret model; this decision does not expand that scope. ADR-0055 still governs external ownership, read models, and synchronous write-through.

## Decision

1. **The per-org binding is the enablement authority.** An active `external_org_bindings` row for the org/tier, together with the corresponding `external_domain_ownership` rows, authorizes that org's external integration. Every sync path resolves the active org binding and its Vault credential; it does not infer enablement from a deployment-wide switch.
2. **Retain `EXTERNAL_CONNECT_ENABLED` as an operator break-glass kill-switch.** In deployed environments it defaults to enabled when absent. An explicit false value disables external execution everywhere, immediately and fail-closed, for incident response. It does not create, remove, or mutate per-org ownership and does not require org-admin reconnect after restoration.
3. **Make connect atomic at the domain boundary.** Credential validation and sync-readiness checks happen before ClickUp ownership is employed. Binding persistence and ownership employment are committed as one logical operation. A failure leaves no Active binding with employed `tasks`; an already-created Vault secret is revoked or deterministically cleaned up. The implementation must use a server-side transaction/RPC boundary appropriate to the existing Vault and ownership primitives rather than client sequencing that can report partial success.
4. **Provide an explicit trapped-org repair runbook.** For each affected org, operators first enable the kill-switch, inspect binding/Vault state, restore or rotate the org credential, and prove a bounded adapter/sweep readiness check. Ownership is retained/employed only after that proof. If proof cannot pass, release ClickUp `tasks` ownership so PMO native task edits are restored, then remediate and reconnect. Each action is audited and repeatable.
5. **Keep authorization server-side.** `can()` and UI visibility remain UX hints under ADR-0016. Edge functions/security-definer RPCs and RLS enforce caller role, `org_id`, and ownership changes. No client-provided `org_id` becomes an authority input.

## Data flow

Connect: verified org-admin JWT → credential validation → effective kill-switch check → Vault write/binding transaction → per-org Vault resolution/readiness proof → ownership transaction → Active response.

Sync: execution path → effective kill-switch check → active binding for the execution org → Vault secret → existing ClickUp adapter/sweep/webhook path. A kill-switch stop is global and temporary; a missing or invalid org binding is org-local and fail-closed.

## Consequences

### Positive

- A client org-admin can self-serve without an app operator deciding which org is enabled.
- The operator retains an emergency stop with a clear, narrow purpose.
- Connect cannot intentionally strand an org behind `enforce_assignee_status_only()` without a sync path.
- Existing credentials survive a temporary incident stop; restoration does not require credential re-entry.
- The `org_id` seam, Vault custody, RLS, audit trail, and external SoT model remain intact.

### Costs and risks

- Connect needs a real server-side atomic boundary and cleanup for Vault's external side effect; a database transaction alone cannot roll back a Vault secret creation.
- Operators need a one-time discovery and repair run for organizations already in the trap state.
- All relevant execution paths must converge on the same kill-switch default/semantics; drift would recreate the bug.
- A global kill-switch intentionally affects healthy customers during an incident, so its use must be observable and reversible.

## Rejected alternatives

- **Just flip the flag on in production.** Rejected. It may make current resolver paths run, but papers over existing trap-state organizations and leaves a global rollout switch deciding per-org behavior. It is a rollout step after this fix, not the architecture.
- **Delete the flag entirely.** Rejected. Operations need an immediate integration-wide incident stop.
- **Keep the flag as the per-org enablement gate.** Rejected. It contradicts self-serve and recreates the exact mismatch between Active UI/ownership and sync execution.
- **Let connect employ ownership, then repair asynchronously.** Rejected. This creates the known half-committed state and makes native PMO task writes fail before sync is proven.
- **Gate the UI only.** Rejected. UI gating cannot protect direct edge-function calls, stale clients, or database writes; ADR-0016 requires server/RLS authority.

## Rollback

The implementation plan must ship reversible migrations and a kill-switch runbook. Rollback stops new connects, releases ownership only through the existing authorized server path, and restores the previous resolver behavior only as a temporary emergency measure; it must not silently leave an org with employed ownership and no sync path. Vault cleanup must be explicit because database rollback cannot undo an external Vault side effect.
