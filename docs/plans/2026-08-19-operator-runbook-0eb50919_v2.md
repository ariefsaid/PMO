# Issue #491 — Operator runbook

## Plan status

**Blocked before public-doc authoring on two execution-contract decisions.** The requested page must let a first-time operator execute every listed operation and state its audit record, but the current source does not provide a public, completed invocation-and-audit contract for every required present/forthcoming operation. Do not make up either contract in a public document.

Resolve these through the Director/owner's private channel before proceeding:

1. **Interim org creation:** approve the exact supported transactional invocation that creates the organization, a usable first-Admin identity/membership, all currently required locale defaults, and `pmo_epoch_at`; also specify how that procedure changes when the #484 RPC ships. The current repo has no `operator_create_org` implementation or invocation signature, and the named companion fields are not all present in the current schema.
2. **Audit labels:** supply a verified durable audit record/action for each catalogued operation that the runbook must label “audited as.” If an operation has no such record, do not describe that absence in the public repository; obtain a private decision on whether to defer the documentation claim or schedule the required implementation.

The work below becomes executable only after both decisions are supplied. No ADR is needed: selecting a dedicated runbook is a documentation-organization choice, not an architectural decision.

## Design

Create **`docs/operator-runbook.md`**, rather than adding another long section to `docs/environments.md`. `docs/environments.md` is the environment registry and deployment reference; an independent, task-oriented page makes the rare cross-org procedures scannable, gives the RIS sequence one durable home, and prevents it being lost among environment setup. Add reciprocal links so either document finds the other.

The runbook is a public-safe operating procedure. It must contain no real names, contact details, identifiers, endpoints, environment-variable names, credentials, vault/provider names, or credential coordinates. For any credential-handling prerequisite, point only to `scripts/op-get.sh`.

Use this boundary statement verbatim near the top:

> **Operator = cross-org, platform-level, rare → guarded RPC + runbook.**
> **Org-admin = within-org, routine → UI.**

Also state the DD-OPS-1 revisit trigger: reconsider a dedicated operator console only when shared multi-tenancy makes the deployment host more than a handful of organizations and operator administration becomes routine.

### Catalog boundary and source findings

The builder must inventory current behavior from the shipped source, not merely repeat the issue list. The page’s catalog must distinguish a genuine cross-org/platform power from an ordinary org-admin action that also recognizes an Operator in its own-org authorization branch.

Include the issue’s required entries plus these source-discovered shipped Operator capabilities:

- grant an organization credit balance through `operator_grant_credits`;
- read the operator organization directory, aggregate usage, and per-run aggregate statistics through `operator_list_orgs`, `operator_usage_summary`, and `operator_agent_run_stats`;
- set a user’s active/disabled status across organizations through `admin_set_user_status`;
- recover an integration trap state through `recover_external_connect_trap(...)`;
- run a historical import into an explicitly selected organization through `scripts/import-historical.mjs`; and
- provision or revoke the platform grant itself through the approved service-side SQL procedure.

For clarity, document that the integration connect/list/link/unlink/disconnect/set-company endpoints are **not** additional cross-org operator powers: their target is resolved from the caller’s own profile, and they remain routine org-admin integration work even though their server gate can recognize an Operator. This is the explicit report of the additional code search result and prevents the runbook from becoming a duplicate integration-user guide.

For each catalog row, use these exact fields in this order:

1. **Does** — operator outcome and blast-radius boundary.
2. **Invoke** — exact UI location, authenticated API/RPC name and required parameter names, or the named service-side procedure; never a credential value or endpoint coordinate.
3. **Who may** — Platform Operator, org-Admin, or both, including whether the operation is cross-org or pinned to the caller’s organization.
4. **Audited as** — only the verified durable event/action or row-provenance label approved by the audit decision above.
5. **Verify/stop** — the safe success observation and the condition that must stop execution rather than retry a mutation.

## Implementation plan

### Task 1 — Resolve the two public-safe execution contracts before writing the runbook

**Files:** no tracked-file change until both answers are received.

1. In a private Director/owner channel, obtain the approved interim organization-creation transaction contract, including how an initial identity and first Admin membership are provisioned atomically or sequenced, the exact companion-field values, and the replacement call/signature after #484 lands.
2. In the same private decision, obtain the approved audit record/action label for every current catalog entry and the forthcoming lifecycle/org-creation entries.
3. Record neither private detail nor any missing-control explanation in a tracked document. If either answer is unavailable, stop the issue here and return the two questions verbatim to the Director.

**TDD:** Not applicable; this is a prerequisite decision and introduces no executable behavior.

**Verify:** confirm that each of the catalog rows named in the Design section has an approved invocation and an approved audit label before beginning Task 2.

### Task 2 — Author the complete public-safe operator capability catalog

**Files:** create `docs/operator-runbook.md`.

1. Add the title, purpose, public-repository safety notice, boundary rule, and DD-OPS-1 revisit trigger from the Design section.
2. Add an “Operator status and access” section that says the grant is a platform capability rather than an org role; identifies the approved service-side `platform_operators` grant/revocation procedure; identifies the vendor platform authority that may perform it; and gives the approved audit/provenance label. Do not include account-creation SQL, user data, or credentials.
3. Add an “Available powers” table using the five required fields for: feature entitlement toggles (`Administration → Features` / `operator_toggle_feature`); org-targeted invites (`admin-invite-user`); credit grants; operator directory and aggregate usage/run-stat reads; cross-org user-status updates; `operator_set_domain_ownership`, integration trap-state recovery, and historical import into an explicitly selected organization.
4. For the feature entry, retain the current UI path as the routine invocation and name the RPC as the enforcing interface. For every API/RPC entry, show parameter **names only** and state that the request is authenticated as the Operator; direct credential acquisition to `scripts/op-get.sh` without naming a secret source.
5. Add a short “Not a separate operator power” section explaining the own-org integration-action classification found during recon, with a link to the existing Integration UI rather than duplicating its procedures.
6. For every row, use only audit labels approved in Task 1. Do not infer an audit event from an authorization check, UI gate, or a field name.

**TDD:** Not applicable; this task documents existing behavior and changes neither application nor database behavior.

**Verify:**
```bash
rg -n "Does|Invoke|Who may|Audited as|Verify/stop|operator_grant_credits|operator_list_orgs|operator_usage_summary|operator_agent_run_stats|admin_set_user_status|operator_set_domain_ownership|recover_external_connect_trap|import-historical|admin-invite-user|platform_operators" docs/operator-runbook.md
```
The command must exit 0 and show all required catalog evidence.

### Task 3 — Add the org-creation and lifecycle contracts plus the RIS provisioning sequence

**Files:** modify `docs/operator-runbook.md`.

1. Add an “Organization creation” entry with two visibly separate paths:
   - **Interim now:** the owner-approved single transaction from Task 1, which creates the organization, first Admin membership, `default_locale`, `default_number_locale`, `default_timezone`, and `pmo_epoch_at` together; its `Audited as` value comes only from Task 1.
   - **After #484:** replace the interim invocation with the exact approved `operator_create_org` call and its audit label; do not guess its parameters before it exists.
2. Add an “Organization lifecycle state — forthcoming (#489)” entry. It must say the interface is not yet available, only `demo` and `test` are eligible for wholesale destructive operations, and `live` is terminal. It must identify #489 as the future guarded, audited transition contract and must not invent an RPC name or SQL syntax.
3. Add a self-contained “RIS provisioning sequence” checklist in this exact order: lifecycle guard ships; existing organizations receive their deliberate lifecycle backfill; create the RIS organization stamped `live` with every creation companion; invite exactly one RIS Admin; that Admin invites the rest of the team; offboard—not move—demo-organization duplicates; verify.
4. Make the final verification checklist require all of: the first Admin can sign in and sees only the intended organization; the team invitations are issued by that Admin; duplicate demo accounts were offboarded and newly invited rather than reassigned; and, before any operational data is loaded, the destructive procedure is deliberately attempted against the real organization and is observed refusing it. State that a successful refusal is required evidence and that no data-loading step may proceed without it.
5. Keep all people, organization identifiers, invitation targets, dates, endpoints, and data values as role-based prose; do not add execution placeholders that look like real tenant data.

**TDD:** Not applicable; this task documents planned #484/#489 behavior and the owner-decided RIS procedure without implementing behavior.

**Verify:**
```bash
rg -n "Interim now|After #484|default_locale|default_number_locale|default_timezone|pmo_epoch_at|forthcoming|live.*terminal|RIS provisioning|guard ships|backfill|exactly one RIS Admin|offboard|refus" docs/operator-runbook.md
```
The command must exit 0 and show every required creation, lifecycle, ordering, and refusal-proof item.

### Task 4 — Make the runbook findable from the environment reference

**Files:** modify `docs/environments.md` and `docs/operator-runbook.md`.

1. Add a concise `## Operator runbook` cross-link in `docs/environments.md` immediately before the existing `## Provisioning an Operator (per client)` section. The text must identify `docs/operator-runbook.md` as the one page for rare cross-org/platform procedures and RIS provisioning, and must preserve the existing environment procedure below it.
2. Add a reciprocal “Related procedures” link from the runbook to `docs/environments.md` for deployment/environment setup only.
3. Do not copy existing credential, infrastructure, or account-provisioning material into the new page; the cross-link is the only navigation duplication.

**TDD:** Not applicable; this is documentation navigation only.

**Verify:**
```bash
rg -n "operator-runbook\.md|Operator runbook" docs/environments.md docs/operator-runbook.md
```
The command must exit 0 and show links in both directions.

### Task 5 — Perform docs-only safety and completeness verification

**Files:** `docs/operator-runbook.md`, `docs/environments.md`.

1. Review the diff line-by-line against Issue #491, DD-OPS-1, DD-RIS-4, #484, and #489: all required capabilities, the additional discovered capabilities, the boundary rule, the forthcoming lifecycle note, and the ordered RIS procedure must be present.
2. Confirm no unsupported interface name, audit action, credential source, endpoint, identifier, or person-specific information was inferred or copied.
3. Run the docs-only checks below. This issue changes no JavaScript/TypeScript, so do not run typecheck, lint, or Vitest solely for this diff.

**TDD:** Not applicable; no product behavior changes.

**Verify:**
```bash
git diff --check -- docs/operator-runbook.md docs/environments.md
! rg -n "1Password|vault|https?://|[A-Z][A-Z0-9_]{2,}=" docs/operator-runbook.md
git diff -- docs/operator-runbook.md docs/environments.md
```
All commands must exit 0. The final diff review must confirm that `scripts/op-get.sh` is the only credential-procedure reference in the new runbook and that it names no fetched item, provider, environment variable, or secret coordinate.

## Traceability

Issue #491 provides completion criteria but no `AC-###` identifiers and there is no dedicated Issue #491 spec. This is a docs-only change, so no behavior task owns a test-layer AC. The plan traces each documentation task to the issue/decision criteria instead:

| Task | Issue/decision criteria covered |
|---|---|
| 1 | Public-repo rule; “what it is audited as”; first-time operator can execute the procedure |
| 2 | Every current operator power, including credit grants, aggregate reads, user-status updates, trap-state recovery, and historical import discovered outside the issue list; DD-OPS-1 boundary rule and revisit trigger |
| 3 | Interim/future org creation; #489 forthcoming lifecycle state and terminal `live`; DD-RIS-4 ordered provisioning and observed destructive-guard refusal |
| 4 | Findability from `docs/environments.md` |
| 5 | Public-repo safety and docs-only quality verification |

## Builder handoff

Do not begin tracked-file edits until the two private contract decisions in Task 1 are available. This stop is required to avoid documenting an invented invocation or audit claim in the public repository. Once cleared, this is a docs-only branch: remain on `docs/491-operator-runbook`, do not push, and do not open a PR.
