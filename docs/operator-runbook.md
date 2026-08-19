# Operator runbook

This page is the public-safe inventory of rare, platform-level operator powers and the RIS provisioning sequence. It describes shipped behavior and current audit facts; it is not an audit design. Never put secrets, credential coordinates, environment-variable names, hosts, organization identifiers, or personal data here. For credential-shaped prerequisites, use the sanctioned `scripts/op-get.sh` procedure without recording what it retrieves.

> **Operator = cross-org, platform-level, rare → guarded RPC + runbook.**  
> **Org-admin = within-org, routine → UI.**

An Operator is a platform grant, not an additional organization role. Reconsider a dedicated operator console only when shared multi-tenancy means a deployment holds more than a handful of organizations and these actions become routine (DD-OPS-1, #442).

## How to use this page

For each power, **Does** says what it changes or reads, **Invoke** says the supported surface and parameter names, **Who may** states the authority, and **Audited today** reports the shipped success-path audit behavior. “Not currently audited” is a finding, not a proposed remediation. Values below are execution-time placeholders; do not put real values in this document.

## Operator powers

### Feature entitlements

- **Does:** Enables or disables a gatable feature for a selected organization. Core features cannot be toggled.
- **Invoke:** In the signed-in Operator's organization, use **Administration → Features**. The UI invokes `operator_toggle_feature(p_org_id, p_key, p_enabled)`. For another organization, use the authenticated guarded RPC/API path with those parameter names; the current UI has no organization picker.
- **Who may:** An active platform Operator; the server re-checks the Operator grant. The organization must exist.
- **Audited today:** **Not currently audited.**

### Organization-targeted invitation

- **Does:** Invites a user with a requested role into a specified organization.
- **Invoke:** Call the `admin-invite-user` API with `email`, `role`, and `p_org_id`. The current **Administration → Users → Invite user** UI has no alternate-organization selector and invites only the caller's organization.
- **Who may:** A platform Operator may target an organization through the API. An Org-Admin is restricted to their own organization; the UI does not provide cross-organization targeting.
- **Audited today:** **Not currently audited** on the successful invitation path.

### Cross-organization member offboarding and re-enable

- **Does:** Sets a member profile's status to `active` or `disabled`, with protections against self-lockout and removing the sole Admin.
- **Invoke:** Use `admin_set_user_status(p_profile_id, p_status, p_org_id)` through the authenticated guarded RPC/API path. The Users UI supports the caller's visible organization; use the cross-organization path when the target organization differs.
- **Who may:** An Admin for the target organization or a platform Operator; server-side protections still apply.
- **Audited today:** **Not currently audited.**

### Credit grant

- **Does:** Grants credits to an organization and records the operator's note.
- **Invoke:** In **Administration → Credits**, choose **Grant credits**. The UI invokes `operator_grant_credits(p_org_id, p_amount, p_note)`. Cross-organization grants use the authenticated guarded RPC/API path; the current UI has no organization picker.
- **Who may:** An active platform Operator only; the RPC validates the target organization.
- **Audited today:** `credits.grant` in `audit_events`.

### Organization directory and usage statistics

- **Does:** Reads the organization directory, aggregate usage, and agent-run statistics. The current Usage page displays unfiltered aggregate usage.
- **Invoke:** Use **Administration → Usage** for the signed-in Operator's organization context. The available read RPCs are `operator_list_orgs()`, `operator_usage_summary(p_org_id)`, and `operator_agent_run_stats(p_org_id)`. No organization switcher is wired into the current UI.
- **Who may:** A platform Operator; these are read-only guarded RPCs.
- **Audited today:** Read-only access is **not currently audited**. `audit_events` itself remains readable only within the caller's own organization, including for an Operator; it is not a cross-organization audit viewer.

### Direct external domain ownership

- **Does:** Employs or releases an external domain ownership assignment for an organization and tier.
- **Invoke:** Call `operator_set_domain_ownership(p_org_id, p_tier, p_domain, p_action)` through the authenticated guarded RPC path, where `p_action` is `employ` or `release`.
- **Who may:** An active platform Operator only; the RPC validates the target organization.
- **Audited today:** **Not currently audited** for this direct RPC. The separate integration path below has its own audit events and is not interchangeable with this entry point.

### Organization creation — forthcoming

- **Does:** Will create an organization with the companion records defined by the product contract.
- **Invoke:** Via `operator_create_org` (#484); **not yet shipped**. There is no current invocation. No interim or hand-written organization-creation SQL belongs in this runbook.
- **Who may:** Not available until #484 ships.
- **Audited today:** Not shipped; therefore no audit record exists today.

### Organization lifecycle — forthcoming

- **Does:** Will provide the guarded organization lifecycle state and destructive guard described by #489. The `live` state is terminal.
- **Invoke:** #489 is **not yet shipped**; no function name, command, or invocation is available today.
- **Who may:** Not available until #489 ships.
- **Audited today:** Not shipped; therefore no audit record exists today.

### Platform Operator membership

- **Does:** Grants or revokes the platform-level Operator status represented by a `platform_operators` row. This is distinct from an organization role.
- **Invoke:** An authorized platform administrator provisions or revokes the row through the approved service-side SQL procedure. There is no UI or client API. Use `scripts/op-get.sh` for any credential-shaped prerequisite; do not record credentials here.
- **Who may:** The authorized platform administrator who controls the service-side provisioning path. The row retains `granted_by` and `granted_at` provenance.
- **Audited today:** **Not currently audited** as an `audit_events` record; the row's provenance is not an audit event.

## Additional source findings

These are powers and authority paths discovered in the shipped code in addition to the initial issue list.

### Additional platform/cross-organization actions

| Power | Does / Invoke | Who may | Audited today |
|---|---|---|---|
| `m365_disconnect_cascade(...)` | Disconnects M365 and removes the related connections. Use the controlled integration disconnect procedure; do not copy credentials or request bodies into this page. | Operator cross-organization or Admin for their own organization. | One `m365.connection.revoked` event per deleted connection; an idempotent no-op writes nothing. |
| `admin_change_domain_ownership(...)` | The integration connect/disconnect path employs or releases domain ownership. Use the existing Integration UI or controlled integration procedure. | Operator cross-organization or Admin for their own organization. | `integration.domain_ownership.employ` or `integration.domain_ownership.release`. |
| Credential-custody binding/rotation | Binds or rotates the integration credential reference through the controlled integration procedure. Never record the credential or its coordinates here. | Operator cross-organization or Admin for their own organization. | The integration connect/reconnect event. |
| `finalize_external_connect(...)` | Finalizes an external connection after service-side readiness checks. Use the controlled integration onboarding procedure; this is not a client invocation recipe. | Service-only finalization. | The finalize/cleanup event. |
| `recover_external_connect_trap(...)` | Recovers a trapped external connection state. Follow [`docs/runbooks/integration-trap-state-recovery.md`](runbooks/integration-trap-state-recovery.md), which is the detailed procedure. | Service-only ClickUp recovery requiring an Operator actor. | `integration.trap_recovery`. |

Adapter onboarding, client provisioning, credential custody, and historical import are privileged service procedures rather than browser-Operator RPCs. For adapter onboarding, use the named `clickup-onboard` or `erpnext-onboard` procedures and the [external adapter decision](adr/0065-external-admin-connect.md). For client provisioning, use [`scripts/provision-client.sh`](../scripts/provision-client.sh) and the [per-client environment procedure](environments.md#per-client-provisioning-real-production-gtm--adr-0047). For historical import, use [`scripts/import-historical.mjs`](../scripts/import-historical.mjs) and the [onboarding tooling specification](specs/onboarding-tooling.spec.md). These references are the controlled guides; this page intentionally does not reproduce credentials, request bodies, hosts, or organization values.

### Operator-recognized own-organization browser operations

These Edge Functions recognize an Operator, but their target is derived from the caller profile. An Operator therefore does **not** gain an arbitrary-organization browser route. Use the current Integration UI and its normal organization context.

| Operation | Does / Invoke | Who may | Audited today |
|---|---|---|---|
| `external-connect` | Connects an external integration in the caller's organization. Use the Integration UI. | Admin of the organization or Operator in that organization context. | Attempts the named integration connect audit action. |
| `external-disconnect` | Disconnects an external integration in the caller's organization. Use the Integration UI. | Admin of the organization or Operator in that organization context. | Attempts `integration.disconnect`; ClickUp ownership release is separately audited through `admin_change_domain_ownership`. |
| `external-companies` | Lists external companies for the caller's organization. Use the Integration UI. | Admin or Operator in the caller's organization context. | Attempts its named integration audit action. |
| `external-set-company` | Selects the external company for the caller's organization. Use the Integration UI. | Admin or Operator in the caller's organization context. | Attempts its named integration audit action. |
| `external-lists` | Lists external lists for the caller's organization. Use the Integration UI. | Admin or Operator in the caller's organization context. | **Not currently audited.** |
| `external-link` | Links a project in the caller's organization. Use the Integration UI. | Admin or Operator in the caller's organization context. | Attempts its named integration audit action. |
| `external-unlink` | Unlinks a project in the caller's organization. Use the Integration UI. | Admin or Operator in the caller's organization context. | Attempts its named integration audit action. |
| M365 organization approval | Approves the M365 organization connection in the caller's organization context. Use the Integration UI. | Admin or Operator in the caller's organization context. | **Not currently audited.** |

### Helpers and ordinary Org-Admin recovery

| Finding | Does / Invoke | Who may | Audited today |
|---|---|---|---|
| `operator_org_exists(...)` | Read-only invite-authorization helper; not a supported operator procedure. | Used by the invitation authorization path. | **Not currently audited.** |
| `org_has_member_email(...)` | Read-only invite-authorization helper; not a supported operator procedure. | Used by the invitation authorization path. | **Not currently audited.** |
| `credits_insert` | Own-organization direct-DML permission. There is no supported UI or runbook route; use the guarded credit-grant RPC instead. | Own-organization permission, not a cross-organization Operator procedure. | **Not currently audited.** |
| `release_outbox_hold` | Releases a same-organization held outbox command for recovery. | Same-organization Admin, not a platform Operator power. | Audited on success. |
| `attest_timesheet_no_erp_document` | Attests a same-organization timesheet recovery condition. | Same-organization Admin, not a platform Operator power. | Audited on success. |

## RIS provisioning sequence (DD-RIS-4)

Complete these steps in order. Every dependency is explicit because the destructive guard must be observed working before real data exists.

| Order | Step | Dependency |
|---:|---|---|
| 1 | **#489 guard ships.** | Prerequisite for every later step. |
| 2 | **Backfill existing organization lifecycle states.** | Depends on #489 guard shipment. |
| 3 | **Create the RIS organization stamped `live` at creation with its #484 companions.** | Depends on the #489 backfill and #484. Do not invent the unshipped RPC signature. |
| 4 | **Invite the RIS Admin.** | Depends on successful organization creation. |
| 5 | **Their Admin invites the rest.** | Depends on the first Admin accepting/accessing the organization. The Operator does not assign the remaining client roles. |
| 6 | **Offboard demo-organization duplicates.** | Depends on RIS members existing as fresh identities; do not move profiles. |
| 7 | **Verify.** | Depends on all preceding steps. Before operational data is loaded, deliberately attempt the wholesale destructive procedure against the real `live` organization and prove that it refuses a wipe. A guard never observed refusing is not a guard. Also verify organization isolation, Admin access, team-invite ownership, and offboarding completion. |

## Related procedure

See [`docs/environments.md`](environments.md) for environment, deployment, and credential-procedure setup. This page is the inventory of rare cross-organization/platform acts and the RIS provisioning sequence.
