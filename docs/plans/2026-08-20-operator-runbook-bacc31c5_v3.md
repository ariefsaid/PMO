# Issue #491 — Operator runbook

## Decision

Create **`docs/operator-runbook.md`** and add a short reciprocal link from **`docs/environments.md`**. `docs/environments.md` is already a large environment/deployment reference; placing a complete, task-oriented inventory plus the RIS sequence there would make both operational references harder to scan. A standalone page gives rare cross-org procedures one discoverable home, while the environment document remains the credential/environment reference.

No ADR is needed: this is documentation organization, not an architectural or irreversible product decision.

## Design and source-backed scope

The runbook is a public-safe catalogue of the **current** authority and invocation contracts, not a proposed control design. Start with a prominent public-repo safety note: no secret, credential coordinate, environment-variable name, host, organization identifier, or personal data belongs on this page. For a credential prerequisite, point only to `scripts/op-get.sh` without saying what it fetches.

Place the following boundary rule verbatim near the top:

> **Operator = cross-org, platform-level, rare → guarded RPC + runbook.**
> **Org-admin = within-org, routine → UI.**

Also retain DD-OPS-1's revisit trigger: reconsider an operator console only when shared multi-tenancy means a deployment holds more than a handful of organizations and this work becomes routine.

Every power entry must use the same four labels, in this order: **Does**, **Invoke**, **Who may**, **Audited today**. Invocation instructions must name the actual UI path, Edge Function/RPC/script and required parameter *names*, but use role-based placeholders rather than values or endpoint coordinates. State server-side enforcement separately from UI affordances where relevant.

### Required catalogue and audit facts

Document these source-proven entries:

| Power | Invocation/authority to describe | Audited today |
|---|---|---|
| Feature entitlement toggles | `/administration` → **Features** controls the signed-in Operator's organization and invokes `operator_toggle_feature(p_org_id, p_key, p_enabled)`; cross-org use is the authenticated RPC/API path, not a wired organization-picker UI. Only the platform Operator can change a gatable key. | **Not currently audited.** |
| Org-targeted invitation | The `admin-invite-user` API accepts `email`, `role`, `p_org_id`; the current `/administration` → **Users** → **Invite user** UI does **not** expose alternate-organization selection, so it invites only the caller's own organization. Org-Admins are likewise pinned to their own organization. | **Not currently audited** on the successful invitation path. |
| Cross-org member offboard/re-enable | `admin_set_user_status(p_profile_id, p_status, p_org_id)`; the Users UI supports the caller's visible organization, while a cross-org action uses the guarded RPC/API path. Both an in-org Admin and an Operator may use it, with the sole-Admin/self lockout protections. | **Not currently audited.** |
| Credit grant | `/administration` → **Credits** → **Grant credits** operates on the signed-in Operator's organization and enforces `operator_grant_credits(p_org_id, p_amount, p_note)`; cross-org grants use the authenticated RPC/API path rather than a wired organization picker. Operator only. | `credits.grant` in `audit_events`. |
| Organization directory and aggregate usage/read statistics | `/administration` → **Usage** is Operator-only and currently shows unfiltered aggregate usage; `operator_list_orgs()`, `operator_usage_summary(p_org_id)` and `operator_agent_run_stats(p_org_id)` are the available directory/filter RPCs, but no organization switcher is wired in the current UI. | Read-only access is **not currently audited**. |
| Domain ownership | guarded `operator_set_domain_ownership(p_org_id, p_tier, p_domain, p_action)` (`employ`/`release`); Operator only. Do not substitute the separate Admin-or-Operator integration path for this requested RPC. | **Not currently audited** for direct `operator_set_domain_ownership`. |
| Platform Operator membership | an authorized platform administrator provisions/revokes the `platform_operators` row through the approved service-side SQL procedure; no UI or client API exists. Explain that it is a platform grant, not an org role, and that the row retains `granted_by`/`granted_at` provenance. | **Not currently audited**; provenance is not an `audit_events` record. |
| Organization creation | **“via `operator_create_org` (#484); not yet shipped”** and no interim/manual SQL. | Not shipped; therefore no audit record exists today. |
| Organization lifecycle | forthcoming **#489** guarded lifecycle state; `live` is terminal. Do not invent a function name, command, or audit event. | Not shipped; therefore no audit record exists today. |

Add a concise but complete **Additional source findings** section so the page truly reports code discoveries rather than silently limiting itself to the issue's initial list. Split it into three small tables rather than presenting every authorization helper as a normal first-time procedure:

1. **Additional platform/cross-org actions.** Include `m365_disconnect_cascade(...)` (Operator cross-org or Admin own-org; writes one `m365.connection.revoked` event per deleted connection and writes nothing on an idempotent no-op); `admin_change_domain_ownership(...)` (Operator cross-org or Admin own-org; audited as `integration.domain_ownership.employ`/`.release`); the credential-custody binding/rotation operation (Operator cross-org or Admin own-org; audited as the integration connect/reconnect event); `finalize_external_connect(...)` (service-only finalization, audited by its finalize/cleanup event); and `recover_external_connect_trap(...)` (service-only ClickUp recovery requiring an Operator actor, audited as `integration.trap_recovery`). For service-only or credential-bearing rows, invoke is the existing controlled procedure/runbook, not a copied RPC call or request body; retain `docs/runbooks/integration-trap-state-recovery.md` as the detailed recovery procedure.
2. **Operator-recognized but own-org browser operations.** List the exact functions `external-connect`, `external-disconnect`, `external-companies`, `external-set-company`, `external-lists`, `external-link`, `external-unlink`, and the M365 organization-approval action. State that their target derives from the caller profile, so an Operator does not gain an arbitrary-org browser route. Record the verified success audit truth per row: connect/disconnect/link/unlink/set-company/list-companies attempt their named integration audit actions; `external-lists` and M365 approval are **not currently audited**; ownership release is separately audited through `admin_change_domain_ownership`. Link to the current Integration UI rather than duplicating procedures.
3. **Helpers and ordinary org-admin recovery, not first-time Operator powers.** Report `operator_org_exists(...)` and `org_has_member_email(...)` as invite-authorization helpers (read-only and not audited), `credits_insert` as an own-org direct-DML permission with no supported UI/runbook route and no audit (the guarded credit-grant RPC is the documented operation), and `release_outbox_hold`/`attest_timesheet_no_erp_document` as same-org Admin—not Platform Operator—recoveries that do audit on success. State that `audit_events` remains readable only within the caller's own organization even for an Operator, so it is not a cross-org audit viewer.

Adapter onboarding, client provisioning, and historical import are privileged provisioning/service procedures, not browser-Operator RPCs. Give a neutral stub pointing to their existing named procedure/guides; do not reproduce credentials, request bodies, hosts, organization values, or service-side invocation details. This reports the discovery without publishing a dangerous operator recipe.

The direct-RPC audit distinction is important: `admin_change_domain_ownership(...)` (the integration flow) writes `integration.domain_ownership.employ`/`integration.domain_ownership.release`, but direct `operator_set_domain_ownership(...)` does not. The runbook must state the audit truth for the exact entry point being documented rather than treating authorization or a related path as an audit record.

### RIS provisioning section

Add **RIS provisioning sequence (DD-RIS-4)** to the same runbook, in this exact order and with a dependency column/checkmark for each step:

1. **#489 destructive guard ships** — prerequisite for all later steps.
2. **Backfill existing organization lifecycle states** — depends on the guard shipment.
3. **Create the RIS organization stamped `live` at creation with its #484 companions** — depends on #489 backfill and #484; do not enumerate or fabricate the unshipped RPC signature.
4. **Invite the RIS Admin** — depends on successful creation.
5. **Their Admin invites the rest** — depends on the first Admin accepting/accessing the organization; the operator does not assign the rest of the client roles.
6. **Offboard demo-organization duplicates** — depends on the RIS members existing as fresh identities; do not describe moving profiles.
7. **Verify** — before operational data is loaded, deliberately attempt the wholesale destructive procedure against the real organization and record that it refuses; a guard never observed refusing is not a guard. Also verify organization isolation, Admin access, team-invite ownership, and offboarding completion.

All role/person/org values remain execution-time placeholders, not examples with real values.

## Implementation plan

### Task 1 — Write the public-safe runbook foundation and the current power catalogue

**Files:** create `docs/operator-runbook.md`

1. Add the page title, purpose, public-repository safety boundary, the exact Operator/org-admin boundary rule, and DD-OPS-1 revisit trigger.
2. Add a “How to read this runbook” note defining the four mandatory entry labels: Does, Invoke, Who may, Audited today; say audit claims describe only the shipped success path.
3. Add the required catalogue rows for entitlement toggles, organization-targeted invites, cross-org user status, credit grants, organization/usage/statistics reads, direct domain ownership, and Operator membership using the exact symbols, UI paths, parameter names, authority, and audit facts in the Design section.
4. Describe the invitation surfaces truthfully: the API's `p_org_id` override is the org-targeted route, while the current Users invite UI has no alternate-organization picker and invites the caller's own organization. Preserve the non-Operator own-org restriction.
5. State the same current-surface boundary for Features, Credits, user status, and Usage: only their named RPC/API interfaces provide an explicit organization parameter; do not claim the current Administration UI has an organization picker where source shows none.
6. Add the three-table “Additional source findings” inventory from the Design section: additional platform/cross-org operations, own-org browser operations that merely recognize an Operator, and helpers/same-org Admin recoveries that are not Operator powers. State each exact success-path audit result; do not turn a related audit event into an audit claim for an unaudited entry point.
7. Retain `docs/runbooks/integration-trap-state-recovery.md` as the detailed trap-recovery procedure and use a neutral stub for every service-only or credential-bearing integration/provisioning action.
8. Do not copy any SQL, host, environment variable, secret coordinate, account details, org identifier, or personal data from existing environment documentation.

**TDD:** Not applicable — this documents existing behavior and adds no executable product behavior.

**Verify:**
```bash
rg -n "Does|Invoke|Who may|Audited today|operator_toggle_feature|admin-invite-user|admin_set_user_status|operator_grant_credits|operator_list_orgs|operator_usage_summary|operator_agent_run_stats|operator_set_domain_ownership|platform_operators|m365_disconnect_cascade|admin_change_domain_ownership|finalize_external_connect|recover_external_connect_trap|external-connect|external-disconnect|external-link|external-unlink|external-lists|release_outbox_hold|attest_timesheet_no_erp_document|credits\.grant|integration\.trap_recovery|not currently audited" docs/operator-runbook.md
```
The command must exit 0 and show each required current power, source-discovery report, and audit-state declaration.

### Task 2 — Add the explicitly forthcoming organization entries and RIS sequence

**Files:** modify `docs/operator-runbook.md`

1. Add the organization-creation entry exactly as **“via `operator_create_org` (#484); not yet shipped”**. State that there is no current invocation or audit event, and explicitly say no interim/manual SQL belongs in this runbook.
2. Add the forthcoming #489 lifecycle entry. State that it is not shipped, `live` is terminal, and no lifecycle invocation/audit event is available today; do not invent either.
3. Add the ordered DD-RIS-4 checklist from the Design section with explicit dependencies at every step.
4. Make the final verification step explicitly require proving the destructive guard refuses a wipe of the real, `live` organization **before** any data enters it, plus the role-based access/invitation/offboarding checks.
5. Keep #484 and #489 as issue references without adding URLs, values, or implementation details not present in shipped code/decisions.

**TDD:** Not applicable — this is a documentation-only statement of planned work, not an implementation of #484 or #489.

**Verify:**
```bash
rg -n "operator_create_org|#484|not yet shipped|#489|live.*terminal|RIS provisioning|guard ships|backfill|stamped.*live|RIS Admin|invites the rest|offboard|refus" docs/operator-runbook.md
```
The command must exit 0 and show the two forthcoming entries and every ordered RIS dependency, including the observed-refusal proof.

### Task 3 — Make the standalone procedure discoverable from environment operations

**Files:** modify `docs/environments.md`; modify `docs/operator-runbook.md`

1. Insert a short `## Operator runbook` subsection in `docs/environments.md` immediately before `## Provisioning an Operator (per client)`. Link to `docs/operator-runbook.md`, describe it as the inventory of rare cross-org/platform acts and RIS provisioning, and retain the existing environment-specific material in place.
2. Add a reciprocal “Related procedure” link in `docs/operator-runbook.md` to `docs/environments.md` for environment/deployment setup only.
3. Do not duplicate the existing environment document's credentials, provider references, hostnames, account instructions, or setup SQL into the new runbook.

**TDD:** Not applicable — documentation navigation only.

**Verify:**
```bash
rg -n "Operator runbook|operator-runbook\.md" docs/environments.md docs/operator-runbook.md
```
The command must exit 0 and show reciprocal, correctly named links.

### Task 4 — Perform docs-only completeness and public-safety verification

**Files:** `docs/operator-runbook.md`; `docs/environments.md`

1. Review the final diff against Issue #491, DD-OPS-1, DD-RIS-4, and the 2026-08-19 Director ruling. Confirm every listed power, all source-discovered additional powers, both unshipped issue entries, the boundary rule, and the refusal proof are represented.
2. Confirm every “Audited today” statement is a current source fact: only `credits.grant` and `integration.trap_recovery` may be asserted from the confirmed catalogue without a new source check; no authorization/provenance/UI behavior may be relabelled as audit.
3. Confirm the runbook contains no secrets, credential coordinates, vault/provider name, environment-variable name, host, URL, real organization identifier, email, or personal data. Its only credential-procedure reference may be `scripts/op-get.sh`.
4. Do not run application tests for this docs-only change; run the deterministic documentation/diff checks below.

**TDD:** Not applicable — no code, migration, or test behavior changes.

**Verify:**
```bash
git diff --check -- docs/operator-runbook.md docs/environments.md
! rg -n "1Password|vault|https?://|[A-Z][A-Z0-9_]{2,}|@[A-Za-z0-9.-]+" docs/operator-runbook.md
git diff -- docs/operator-runbook.md docs/environments.md
```
All commands must exit 0. The final diff review must confirm `scripts/op-get.sh` is the only credential-procedure reference and contains no indication of what it retrieves.

## Traceability

Issue #491 is docs-only and has no dedicated spec or `AC-###` identifiers. There are no behavior tasks or test-owning acceptance criteria to add. Traceability is therefore to the issue/decision completion criteria:

| Task | Issue/decision criteria covered |
|---|---|
| 1 | Every shipped Operator or cross-org authority, Operator-recognized own-org integration action, helper/exclusion, invocation, and current audit truth; DD-OPS-1 boundary/revisit decision |
| 2 | #484 listed but not invented; #489 lifecycle and terminal `live`; DD-RIS-4 ordered provisioning and destructive-guard refusal proof |
| 3 | Runbook located beside and discoverable from environment procedures |
| 4 | Public-repo rule, factual audit reporting, docs-only quality gate |

## Builder handoff

Stay on `docs/491-operator-runbook`; this is docs-only. Do not push or open a PR. Do not write interim organization-creation SQL, do not design an audit system, and do not turn “not currently audited” findings into proposed remediation. The page must say what exists today and name #484/#489 where functionality is forthcoming.
