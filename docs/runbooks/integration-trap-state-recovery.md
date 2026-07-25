# Integration trap-state recovery

The trap is an org with ClickUp `tasks` ownership but no resolver-usable active binding. Recovery is
**platform-operator-only**. It is not an org-Admin operation because the fallback can release domain
ownership and restore PMO editability.

## Procedure

1. Set `EXTERNAL_CONNECT_ENABLED=false` before changing code or state; stop new connects.
2. Inventory orgs with ClickUp/tasks ownership and either no active `external_org_bindings` row or a
   missing Vault secret. Do not inspect or print secret values.
3. Restore or rotate the Vault reference and active binding. The bounded readiness proof is the same
   as connect: the binding resolves through `resolvePerOrgSecret`; no extra ClickUp API call is needed.
4. With the switch effectively enabled for the recovery command, invoke
   `recover_external_connect_trap(org_id, 'clickup', kill_switch_enabled, readiness, actor_id)` via
   the service-role edge/operator path. The RPC performs a direct `platform_operators` lookup on
   `actor_id`; it deliberately does **not** use `is_operator()` (that function is security invoker
   and misfires under service_role).
5. On readiness success, ownership is retained/employed. On failure, the RPC releases the **org-level**
   `external_domain_ownership(org_id, 'clickup', 'tasks')` row. This is the org enablement record;
   project-level task ownership remains governed by active `external_project_bindings`, and releasing
   it returns PMO task editability rather than deleting mirrored task rows.
6. Verify the ownership row, active binding, Vault reference existence, and PMO task writes. Review
   the audit event for actor, org, tier, kill-switch decision, readiness, and ownership action.
7. Run pgTAP and the curated connect/switch-recovery journeys. Seed and verify connect → readiness →
   ownership → sync, mixed-mode projects, and zero project bindings.
8. Set the deployed function secret to `true` (or omit it for the default-on behavior), then monitor
   audit, unresolved-inbound, binding, and execution-error signals before reopening self-serve.

## Rollback

Set the switch false, stop new connects, release ownership for unrepaired orgs through the same
operator RPC, audit affected task writes, and revert migration `0147_atomic_integration_connect_recovery.sql`.
Do not delete binding tombstones or Vault history.
