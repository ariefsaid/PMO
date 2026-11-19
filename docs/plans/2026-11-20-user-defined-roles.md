# User-defined Roles Implementation Plan

> **For agentic workers:** Director dispatches fresh Orca workers per slice. Use TDD; do not implement until the owner signs off the spec, ADR, and #908 sketch. Auth-tier slices are Director-dispatched per issue.

**Goal:** Give an Admin scoped, editable roles and document approval routing while preserving existing behaviour at migration.

**Architecture:** ADR-0103 adds org-owned role grants, project teams and a server evaluator; the UI consumes an untrusted projection. Existing safeguards and independently captured UI/server outcomes remain binding.

**Tech Stack:** Postgres/Supabase RLS and pgTAP, React/TypeScript, Vitest, Playwright.

**Spec:** `docs/specs/user-defined-roles.spec.md`.

## Global constraints

One role per user; real actor and org from trusted server context; current membership each transaction; default deny; rank and SoD remain independent; no implicit currency conversion; owner decides outstanding spec questions before build. Every DB slice is auth-tier and Director-dispatched; approval-routing changes are also money-tier. No migrations or production code are part of this plan-only branch.

## Review focus

- `USING` denial is often a silent zero-row update: assert persisted state, not only a successful statement (Tasks 1, 6).
- A record moving between projects must satisfy both old and new scope (Task 6).
- Equal rank does not outrank and the last Admin cannot be removed (Tasks 3, 7).
- Boundary amounts, different currencies and empty routes must not silently select an approver (Task 8).
- Revocation during a session must apply to the next transaction; view-as cannot grant authority (Tasks 5, 10).

## File and interface map

- `supabase/tests/roles_parity.test.sql`: independent head characterization and parity assertions; `supabase/tests/roles_scope.test.sql`, `roles_admin.test.sql`, `roles_routes.test.sql`: scoped contracts.
- `supabase/migrations/<next>_roles_storage.sql`, `<next>_roles_evaluator.sql`, `<next>_roles_routes.sql`, and per-module migrations: schema, helper and conversions. Allocate actual next migration numbers immediately before each migration, respecting concurrent work.
- `pmo-portal/src/auth/policy.ts`, `pmo-portal/src/auth/usePermission.ts` and corresponding tests: real-actor projection; inspect actual hook location before editing.
- `pmo-portal/pages/Roles.tsx`, `pmo-portal/src/lib/repositories/roles.ts`, relevant router and `pmo-portal/e2e/AC-011-roles.spec.ts`: Admin editor and repository.
- `docs/private/cleanup-20261119/landing/roles-parity-inventory.md`: private head inventory and independent expected outcomes; never publish unpatched weakness details.

These are proposed ownership boundaries; the Director must split migration filenames and work by the actual current head. `has_permission(p_key text, p_project_id uuid) returns boolean` reads actor/org from trusted context; null project is valid only for organisation-scoped grants. The route resolver takes a persisted document ID, derives type, project, amount and currency, and returns eligible profile IDs and an explanation; it must not trust caller-provided amounts. The resolver's exact typed signature is fixed with the owning domain after owner sign-off and before that slice is dispatched.

## Task 1 — Characterize the baseline first (auth-tier; AC-001, AC-014)

- [ ] Pin the implementation branch's head and inventory `pg_policies`, `pg_proc`, `role_table_grants`, transitive helpers, edge/CLI consumers and FE checks in the private inventory. Record each operation, role, actor, row context, expected server outcome, separately expected FE affordance, and source evidence. Include restricted columns, active membership, role rank, assignments and SoD.
- [ ] Create `supabase/tests/roles_parity.test.sql` with data-driven fixtures for each inventoried preset/operation/context; assert actual existing server access, persisted row read-back on denied updates, and function results, including `USING` and `WITH CHECK`. Expected values come from the reviewed baseline, never the proposed evaluator.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/roles_parity.test.sql`; require every planned assertion and no parse errors. Mutate one representative role gate and one SoD predicate locally; each must fail a relevant assertion, then restore. Record command output and exact head.
- [ ] Add independently expected FE cases to the existing policy tests; run the directly touched Vitest file with `cd pmo-portal && npx vitest run <exact-touched-test-file>`. Replace the argument with the actual path recorded in the inventory before dispatch; no whole-suite run.

## Task 2 — Project teams (auth-tier; AC-003, AC-005)

- [ ] In `supabase/tests/roles_scope.test.sql`, assert same-org team membership, foreign-org refusal, PM membership after create and PM replacement, and no membership from task assignment alone; run it and observe failures.
- [ ] Add an org-bound team relation, indexes, controlled administration and PM invariant in a reversible migration. Add team management on the project using the existing repository/form patterns; team edits audit actor and old/new state.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/roles_scope.test.sql` and the directly touched UI tests; require all assertions pass.

## Task 3 — Role storage and presets (auth-tier; AC-002, AC-010, AC-016)

- [ ] In `supabase/tests/roles_admin.test.sql`, assert independent copy, unique live names, cross-org rejection, no self-escalation, equal-rank refusal, assignment protection and last-Admin recovery; run red.
- [ ] Add org-bound roles, grants and audited transactional management with constraints and indexes in `supabase/migrations/<next>_roles_storage.sql`; seed five presets from the reviewed Task 1 inventory, not a historical count. Preserve the role enum and existing authority.
- [ ] Run `scripts/with-db-lock.sh supabase test db supabase/tests/roles_admin.test.sql`; require all assertions pass and mutate the last-Admin protection to demonstrate failure.

## Task 4 — Shadow evaluator (auth-tier; AC-001, AC-005)

- [ ] Extend parity tests to compare every baseline outcome with `has_permission(text, uuid)` and each relevant domain predicate separately; assert null, inactive and foreign-org cases deny. Run red before implementing.
- [ ] Implement `public.has_permission(p_key text, p_project_id uuid) returns boolean` in `supabase/migrations/<next>_roles_evaluator.sql`, with fixed search path, narrowly granted execution and indexed lookups. Do not replace existing authorisation yet.
- [ ] Run the parity and scope pgTAP files under `scripts/with-db-lock.sh`; require complete mappings and no mismatches. Measure EXPLAIN ANALYZE/BUFFERS for representative procurement lists against Task 1 baseline and submit evidence for Director review.

## Task 5 — Current permission projection (auth-tier; AC-004, AC-014)

- [ ] Add a pgTAP test that revokes a grant between transactions for the same authenticated JWT and asserts the next call denies; add a unit test that compares all preset affordances with the independent FE baseline. Run both red.
- [ ] Add a real-actor server projection and update `pmo-portal/src/auth/policy.ts` and the actual permission hook to use it; keep stricter FE conditions and view-as display separate. Do not trust projection for writes.
- [ ] Run both touched test files and typecheck; verify revocation with the same JWT and no refresh.

## Task 6 — Incremental server conversion (auth-tier; AC-001, AC-003, AC-005, AC-006)

- [ ] For procurement first, add parity tests for list/read, insert, update old/new scope, transitions, assignments, grants and independent SoD; run red against a deliberately mismatched evaluator.
- [ ] Replace the inventoried procurement policy/function/edge consumers one at a time, preserving grants, lifecycle and independent checks; run the targeted parity and existing touched procurement tests after each. Capture benchmark plans and compare to Task 4.
- [ ] Repeat by separately dispatched slices for remaining project modules, organisation modules and money paths, using the private inventory as the explicit per-consumer checklist. Each slice adds its failing parity cases before code and records exact files and commands in its dispatch; no slice is accepted with unclassified consumers.

## Task 7 — Rank and administration (auth-tier; AC-006, AC-010, AC-016)

- [ ] Add `roles_admin.test.sql` cases for strict rank, manager path, existing admin peer exception, profile-management floor, immutable recovery and custom role assignment. Run red.
- [ ] Convert rank and administrative functions to role IDs and current rank, preserving ADR-0070's independent floors and exact existing exceptions; audit changes. Run targeted pgTAP and mutation-check rank, self-escalation and last-Admin guards.

## Task 8 — Approval routing (auth-tier and money-tier; AC-006–009)

- [ ] In `supabase/tests/roles_routes.test.sql`, assert adjacent boundaries, overlap rejection, currency mismatch, missing amount, empty eligibility, SoD, existing authorised fallback and matching transition/notification recipients. Run red.
- [ ] Implement the owner-approved route rows and persisted-document resolver in `supabase/migrations/<next>_roles_routes.sql`, using the existing domain transaction and lock. Integrate transition and notification paths with that same resolver; preserve authorised existing fallbacks and exceptions.
- [ ] Run the targeted pgTAP and affected domain tests under the DB lock; mutate boundary and SoD checks and require failures. Record routing precedence, currency and fallback decisions in the signed spec before implementation.

## Task 9 — Admin editor (UI; AC-011, AC-015)

- [ ] Obtain the #908 sketch-glance, then write component tests for loading, empty, keyboard, validation and save errors and the locked-rule explanation; run red.
- [ ] Implement `pmo-portal/pages/Roles.tsx`, the typed roles repository, routing and translations using existing form primitives; display off / assigned / organisation with unsupported scope disabled and explained, counts, copy, rank and audit-safe errors.
- [ ] Run directly touched Vitest tests, `npm run typecheck`, ESLint on touched files, `node scripts/affected-e2e.mjs`, and `scripts/ux-proof.sh` on touched routes. Author `pmo-portal/e2e/AC-011-roles.spec.ts` for copy, change, save and reopen; run its touched journey with `scripts/e2e-local.sh AC-011`.

## Task 10 — Requested role examples and view-as (auth-tier; AC-012, AC-013)

- [ ] Write pgTAP cases for owner-approved #1407/#1409 grants and the budget editor exclusion; write `pmo-portal/e2e/AC-012-roles-view-as.spec.ts` proving real actor authority and visible view-as state. Run red.
- [ ] Add the approved examples as copyable configurations, without granting overhead, company finance or project-admin approval; preserve SoD. Run the touched pgTAP and e2e journey.

## Task 11 — Cut-over last (auth-tier; AC-001–016)

- [ ] Run the live-catalog and source inventory at the final target head, compare it with Task 1, classify all changes, and require zero unresolved reachable consumers, complete server/FE parity, successful mutation checks, hosted-grant review and reviewed benchmark evidence. Security-auditor and Director sign off.
- [ ] Backfill role IDs transactionally, validate counts and same-org references, and execute the reviewed final cut-over migration. Enable custom assignment only when every consumer is converted; remove enum dependencies last. Exercise the documented rollback on a disposable restored snapshot, including the post-custom-assignment freeze and reviewed reverse mapping.
- [ ] Run `npm run check:guards`, `npm run typecheck`, ESLint on touched files, directly touched unit tests, affected e2e journeys, `scripts/ux-proof.sh`, and touched pgTAP under `scripts/with-db-lock.sh`; record exact commands and outputs for review. Run no full local suite. Director applies the project's review and release gates.

## Traceability

AC-001: 1, 4, 6, 11; AC-002: 3; AC-003: 2, 6; AC-004: 5; AC-005: 2, 4, 6; AC-006: 6–8; AC-007–009: 8; AC-010: 3, 7; AC-011: 9; AC-012–013: 10; AC-014: 1, 5; AC-015: 9; AC-016: 3, 7.
