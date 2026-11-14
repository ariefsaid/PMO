# Feature: Onboarding an organization into the shared project (#2257)

> **Authority:** ADR-0101 (one shared multi-tenant project). Supersedes Deliverable 1 of
> `onboarding-tooling.spec.md` (one hosted project per client) for every organization after the first;
> `scripts/provision-client.sh` stays the path for a brand-new project's first organization.
> **Binding:** ADR-0016 (RLS is the authority), ADR-0019 (server-enforced rules), ADR-0010 (test pyramid).
> **Glossary nouns:** *Operator* (platform persona, not an organization Admin), *Organization*, *Plan*.

## Job story

When a new client signs, the Operator wants to add its organization with one command, so that the
client's first Admin gets an invitation and nobody has to remember a list of manual steps.

## Intent and boundaries

One command adds an organization to the shared project: it creates the organization with its first
Admin, assigns a plan, applies feature switches, checks the result, and only then marks the
organization live.

Out of scope: connecting an accounting system (the organization's Admin does that in the app);
a hosted project, mail sender or Microsoft 365 app per organization; removing or deactivating an
organization (see Decisions); any in-app screen.

## Observations

- **OBS-ONB-001.** `scripts/pmo.mjs` has no command that adds an organization; the runbook
  (`docs/runbooks/pmo-cli.md`) describes a hand-run sequence.
- **OBS-ONB-002.** `operator_create_org` (latest body in migration 0213) needs an existing account
  with no profile as the first Admin, and creates the organization, the Admin profile and the default
  stage configuration in one transaction.
- **OBS-ONB-003.** The invite function (`admin-invite-user`) needs an existing organization. So neither
  existing path can create an organization and its first Admin from an email address alone, and the CLI
  never holds a service key: the missing step has to run server-side.
- **OBS-ONB-004.** `operator_set_org_plan` and `operator_toggle_feature` (migration 0532) exist; an
  organization with no plan row resolves to the top plan.
- **OBS-ONB-005.** `operator_set_org_lifecycle_state` (migration 0191) accepts `live`, `demo`, `test`;
  `live` cannot be changed afterwards.
- **OBS-ONB-006.** `classifyOrgAdminExistence` in `scripts/check-client-readiness.mjs` passes only when
  the project holds exactly one organization.

## Decisions

1. **Server-side step.** A new edge function, `operator-org`, with two actions (`create`, `status`).
   It is the only place the first Admin's invitation is issued for a new organization. The existing
   invite function is not changed.
2. **Operator's own identity does the writes.** The function calls `operator_create_org` and
   `operator_set_org_plan` with the caller's token, so the database's own Operator checks and audit
   rows apply. The service key is used only to issue the invitation, to look up accounts by email and
   to read the status summary, and never before the caller is confirmed as an active Operator.
3. **Live is stamped last.** The command marks the organization live only after its status check
   passes, because live cannot be undone.
4. **No removal in this slice.** A mistake is corrected with existing functions (invite a second
   Admin, then disable the first). Deactivating an organization changes the lifecycle rule and is a
   separate decision.
5. **Dry run by default.** Without `--confirm` the command prints what it would do and writes nothing.
6. **Organizations are keyed by name** (case-insensitive), as today. No new column, no migration.
7. **Project-level readiness script:** only its organization-count rule changes (one or more).

## Requirements

### Edge function `operator-org`

- **FR-ONB-001.** When a request arrives without a valid session, or from a caller who is not an active
  Operator, the function shall refuse it before any service-key client is built.
- **FR-ONB-002.** When action `create` is called, the function shall validate, in this order and before
  issuing anything: organization name present; Admin email well-formed (the shared invite validator,
  including its wildcard refusal); Admin full name present; currency, locale and timezone present; plan
  identifier present and existing. Each failure returns its own error code.
- **FR-ONB-003.** When the organization name is already taken and the given email is not an Admin of
  that organization, the function shall refuse with a name-conflict code and issue nothing.
- **FR-ONB-004.** When the given email already has a profile in any organization, the function shall
  refuse with its own code and issue nothing.
- **FR-ONB-005.** When validation passes, the function shall issue the invitation (redirect built from
  the server's site address only), create the organization with that account as first Admin, and
  assign the plan, and shall return the organization id.
- **FR-ONB-006.** When an account for the email exists, has no profile and has never signed in, the
  function shall reuse it instead of issuing a second account.
- **FR-ONB-007.** If a step after issuance fails, the function shall report which step failed and shall
  not delete or alter the issued account.
- **FR-ONB-008.** When `create` is called for an organization that already exists with that email as
  its Admin, the function shall change nothing and return the organization id with `created: false`.
- **FR-ONB-009.** When action `status` is called with an organization id, the function shall return,
  for that organization only: whether it exists, lifecycle state, the explicitly assigned plan (or
  none), counts of active and invitation-pending Admins, whether default stage configuration exists,
  and the feature switches set for it.
- **FR-ONB-010.** The function shall rate-limit `create` per caller.

### Command `pmo org add`

- **FR-ONB-011.** The command shall require `--name`, `--admin-email`, `--admin-name`, `--currency`,
  `--locale`, `--timezone` and `--plan`, and shall refuse to run when any is missing, naming it.
- **FR-ONB-012.** While `--confirm` is absent, the command shall print the planned steps and make no
  request that writes.
- **FR-ONB-013.** When confirmed, the command shall, in order: call `create`; read `status`; assign the
  plan if none is assigned (stop if a different plan is assigned); apply each `--feature` switch not
  already set; read `status` again; evaluate readiness; set the lifecycle state only if readiness is
  healthy and the state differs; print the result.
- **FR-ONB-014.** If readiness is unhealthy, the command shall leave the lifecycle state unset, print
  each failed check by name and exit non-zero.
- **FR-ONB-015.** When re-run with the same inputs after a partial or complete run, the command shall
  finish the remaining steps and create nothing twice.

### Readiness

- **FR-ONB-016.** Organization readiness is healthy only when the organization exists, has an
  explicitly assigned plan, has at least one active or invitation-pending Admin, and has default stage
  configuration.
- **FR-ONB-017.** The project-level readiness check shall pass its organization rule when the project
  holds one or more organizations each with an Admin.

### Non-functional

- **NFR-ONB-001.** No schema migration.
- **NFR-ONB-002.** No value from one organization appears in another organization's status response.
- **NFR-ONB-003.** The CLI never holds or accepts a service key (existing rule, unchanged).

## Acceptance and owning proof

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-ONB-001 | Given a caller who is not an active Operator, when either action is called, then it is refused and no service-key client was built and no invitation issued. | Deno test (shipped handler) |
| AC-ONB-002 | Given a `create` with a missing plan, a malformed or wildcard email, or a missing field, when called, then each is refused with its own code and no invitation is issued. | Deno test |
| AC-ONB-003 | Given a name already taken by another organization, or an email that already has a profile, when `create` is called, then it is refused and no invitation is issued. | Deno test |
| AC-ONB-004 | Given valid inputs, when `create` is called, then the invitation is issued once, the organization is created under the caller's token with that account as Admin, the plan is assigned, and the id is returned. | Deno test |
| AC-ONB-005 | Given the organization-creation step fails after issuance, when `create` returns, then the failed step is named and no account deletion was requested. | Deno test |
| AC-ONB-006 | Given a completed `create`, when it is called again with the same inputs, then nothing is issued or written and `created: false` is returned. | Deno test |
| AC-ONB-007 | Given two organizations, when `status` is called for one, then the response describes only that one. | Deno test |
| AC-ONB-008 | Given no `--confirm`, when `pmo org add` runs, then no writing request is made. | node test |
| AC-ONB-009 | Given a missing required flag, when `pmo org add` runs, then it refuses and names the flag. | node test |
| AC-ONB-010 | Given a healthy status, when the confirmed command runs, then the lifecycle state is set after the status check, and only once. | node test |
| AC-ONB-011 | Given an unhealthy status (no plan, no Admin, or no stage configuration), when the confirmed command runs, then the lifecycle state is not set, each failed check is named, and the exit code is non-zero. | node test |
| AC-ONB-012 | Given readiness inputs, when classified, then healthy holds only with organization, explicit plan, Admin and stage configuration all present. | node test |
| AC-ONB-013 | Given a project with two organizations each with an Admin, when the project-level check classifies it, then the organization rule passes. | node test |
| AC-ONB-014 | Given the local stack, when `pmo org add … --state test --confirm` runs as the Operator, then the organization exists with its Admin, plan and stage configuration, and a second run changes nothing. | recorded local run (evidence, not CI) |

Creation, plan assignment and lifecycle rules keep their existing pgTAP proofs
(`operator_create_org.test.sql` and the plan and lifecycle tests); this feature adds no database object.
