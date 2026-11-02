# Employee assignment and rotation roster Implementation Plan

> **For agentic workers:** Execute only after owner signs off the linked spec and sketch. Use the project's Orca worker routing and TDD; each slice has independent review and gate evidence.

**Goal:** Deliver PMO-owned employees, dated project/site assignments and a clear on/off roster as a standalone first increment.

**Architecture:** A PMO employee is distinct from the ERP mirror and can optionally link to a profile. Dated assignment segments are the sole roster source; an authoritative database constraint rejects overlaps, and a bounded read computes calendar-day states. UI uses the typed repository seam; future attendance and payroll capture the lookup result under their own issues rather than changing existing timesheets here.

**Tech Stack:** PostgreSQL/Supabase RLS and RPC, React 19, TypeScript, Vitest/RTL, Playwright. **Spec:** `docs/specs/employee-roster.spec.md` (proposed; OQ-ER-1–6 are unsigned).

## Global constraints

- Use only migrations 0533–0536; recheck collision against the target base before each slice. No build until OQs are signed, especially roles, site and correction semantics.
- Employee code and name are minimum person data. Never put real personal data in fixtures, docs or logs. Existing ERP mirror, linking and timesheet write/approval paths are unchanged.
- Calendar dates are date values, never JS timestamps. For archive's 'today', use the organisation's configured timezone; if no timezone is configured use UTC. Assignment bounds are inclusive; an open end means infinity. No shared offline writes.
- `org_id` is server-stamped; all employee, profile and project references must belong to that org. RLS and server authorization are authoritative; `can()` only shapes UX. Register `employee.view/manage`, `assignment.view/manage`, `roster.view` in the #902 permission catalogue; until #902 exists, enforce OQ-ER-4's built-in role defaults. No role migration or new role enum.
- Every new table has FORCE RLS, service role grant, no direct authenticated DML, indexed bounded reads, and an explicit rollback in `supabase/migrations/rollback/`. All callable RPCs revoke public/anon and grant only intended roles. Add new relations/definers to `scripts/isolation-probe-denominator.json` and maintain the 0178 retained-RPC inventory/count. Run 0136 and 0137 with DB slices.
- Migrations with auth/RLS changes ship alone. No money or SoD change is made here; if scope changes to include either, isolate and mutation-test it. Avoid changing migration bodies already landed; rebase and regenerate DB types.
- The linked employee sees only their own roster. Admin manages identities and links; Admin/Finance manage assignments; Admin/Finance/Executive see all. Audit uses existing `log_audit`; do not log extra profile fields.
- Test fixtures: synthetic orgs, projects and profiles only. pgTAP uses transaction, `finish()` and rollback; every AC appears in exactly one owning test. Re-run each red test after implementation and check output body for `Parse errors`.

## Review focus

1. Leap days and cycle wrap: T3 checks 28 February through 1 March in a leap year.
2. Open-ended, adjacent and concurrent assignments: T2 proves exclusion and boundary behavior.
3. Stale edits versus archive: T2 proves a stale version cannot replace a newer correction; archive uses a lock shared with assignment creation.
4. Cross-org and inactive actors: T1 and T3 prove denial and own-only read.
5. Page boundaries and unassigned dates: T3 proves continuation and explicit unassigned cells; T5 covers empty/error UI.

## Slice map and dependencies

| Slice | Migration | Outcome | Release |
|---|---|---|---|
| R1 identity | 0533 | employee master, explicit profile link, archive, roles | auth; alone |
| R2 assignment | 0534 | segments, overlap constraint, audited writers | auth; alone, after R1 |
| R3 roster read | 0535 | bounded period and dated lookup RPCs | auth; alone, after R2 |
| R4 permission/API registration | 0536 | API guard registration and role catalogue integration | auth; alone, after R3 |
| R5 repository + UI | none | typed client, roster and employee workflow | batchable, after R4 |
| R6 acceptance | none | one cross-stack journey | with R5 |

#1517 depends on #1516 and #1520 and needs the lookup and must decide site/geofence, attendance capture, consent and offline sync; #1518 depends on #1517 and defines payroll snapshots and correction handling; #1510 defines project cost postings; #1514 retains its approved-timesheet billing contract. #902 adopts the named actions/scopes; #1520 implements the #1501/#718 offline capture ruling. None is a prerequisite to R1–R6. The external employee match flow and #1606 remain independent; no automatic identity merge is authorized.

## Shared gates and execution

Run DB tests from repo root with `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <explicit files>'` only for migration slices; capture full output, check no `Parse errors` and all assertions pass. Add `supabase/tests/0136_posture_b_side_mirror_droppable.test.sql`, `supabase/tests/0137_service_role_grants.test.sql`, `supabase/tests/0178_anon_executable_definers.test.sql`, plus the touched file. Run `scripts/check-migration-collisions.sh` and `scripts/check-migration-collisions.sh --self-test`, `node scripts/check-isolation-denominator.mjs` and its `--self-test`. Generate types under the same DB lock after reset: `supabase gen types typescript --local > pmo-portal/src/lib/supabase/database.types.ts`. For each slice run in `pmo-portal`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched TS/TSX files>`, and the named touched Vitest files. For UI also run `scripts/ux-proof.sh <touched route>` and the touched e2e under the DB lock. No full local suite or bare Playwright. Security mutation: temporarily remove each role/org predicate and confirm its denial test fails, then restore; record output. RLS/definer reviewers assess grants and actual policies. Before each commit run the relevant tests; no `--no-verify`, no attribution trailers.

## R1 — Employee identity (0533; ships alone)

**Files:** `supabase/migrations/0533_employee_roster_identity.sql`, `supabase/migrations/rollback/0533_employee_roster_identity_down.sql`, `supabase/tests/employee_roster_identity.test.sql`, `pmo-portal/src/lib/supabase/database.types.ts`.

**Interfaces:** `employees(id uuid, org_id uuid, code text, display_name text, profile_id uuid null, archived_at timestamptz null, version integer, created_at timestamptz)`; `save_roster_employee(p_id uuid, p_code text, p_name text, p_profile_id uuid, p_expected_version integer) returns uuid` (null id creates); `archive_roster_employee(p_id uuid, p_expected_version integer) returns void`. Archive checks assignment in R2; until R2 no assignment exists. Client writes use RPC only. Profile linking is explicit, same-org, active and unique among non-archived people.

- [ ] **R1.1 red (4 min):** In `employee_roster_identity.test.sql`, assert AC-ER-001 creates a person with null profile, duplicate normalized code fails, AC-ER-002 duplicate and foreign profile fail, and AC-ER-012 leaves an existing ERP link and timesheet unchanged. Run the shared DB command with this file; expect missing-object failures.
- [ ] **R1.2 green (5 min):** Create the table, org-scoped unique normalized code, partial unique profile index, org stamp, RLS and select policy. Validate active same-org profile in the writer. Implement `save_roster_employee` with role checks, expected version and `log_audit`.
- [ ] **R1.3 red→green (4 min):** Add the inactive and foreign actor assertions for AC-ER-008 to `employee_roster_identity.test.sql`; implement authorization using existing active-member helpers. Implement `archive_roster_employee` and rollback that refuses if rows exist; R2 extends archive atomically. Run R1 test to green and mutation-check role/org gates.
- [ ] **R1.4 gate (5 min):** Run shared migration gates and commit `feat: add roster employee identity`.

## R2 — Assignment segments (0534; ships alone)

**Files:** `supabase/migrations/0534_employee_roster_assignments.sql`, rollback `supabase/migrations/rollback/0534_employee_roster_assignments_down.sql`, `supabase/tests/employee_roster_assignments.test.sql`, generated types.

**Interfaces:** `employee_assignments(id uuid, org_id uuid, employee_id uuid, project_id uuid, site_label text, starts_on date, ends_on date null, anchor_on date, on_days integer, off_days integer, version integer, archived_at timestamptz null)`; `save_employee_assignment(p_id uuid, p_employee_id uuid, p_project_id uuid, p_site_label text, p_starts_on date, p_ends_on date, p_on_days integer, p_off_days integer, p_expected_version integer) returns uuid`; `archive_employee_assignment(p_id uuid, p_expected_version integer) returns void`. `anchor_on = starts_on`; values 1–366 for each cycle count. Corrections preserve ID, use version and audit. Lock employee row before assignment save/archive and employee archive, always in that order.

- [ ] **R2.1 red (4 min):** In `employee_roster_assignments.test.sql` encode AC-ER-004 same-day overlap refused, next-day adjacency accepted, open-end overlap refused and two concurrent transactions yield one success; AC-ER-005 stale version fails, fresh update logs before/after. Run test; expect missing-object failures.
- [ ] **R2.2 green (5 min):** Create table, constraints and a database exclusion constraint on `(org_id, employee_id, daterange(starts_on, ends_on, '[]'))` for unarchived rows; use `btree_gist` if needed. Same-org foreign references are checked in the writer, and all inserts/updates serialized with the employee row lock. Exclusion is the race authority, not a preflight query.
- [ ] **R2.3 red→green (5 min):** Add AC-ER-006 archive refuses an open/current/future segment and succeeds after end before organisation-local today, retaining history. Extend `archive_roster_employee` using the shared employee lock; save and archive assignment RPCs check roles, references, version and audit. Test invalid date/cycle as part of AC-ER-011 in R3, not here.
- [ ] **R2.4 gate (5 min):** Rollback refuses while assignments exist and restores the R1 archive body; run shared DB gates, mutate overlap and authorization checks to confirm red, restore, then commit `feat: add dated employee assignments`.

## R3 — Roster and dated lookup (0535; ships alone)

**Files:** `supabase/migrations/0535_employee_roster_reads.sql`, `supabase/migrations/rollback/0535_employee_roster_reads_down.sql`, `supabase/tests/employee_roster_reads.test.sql`, generated types.

**Interfaces:** `resolve_employee_assignment(p_employee_id uuid, p_date date) returns table(assignment_id uuid, project_id uuid, site_label text, state text)` returns exactly one row: all IDs/site null and `state='unassigned'` if no assignment. `list_employee_roster(p_from date, p_to date, p_after_employee_id uuid, p_limit integer) returns table(employee_id uuid, code text, display_name text, day date, assignment_id uuid, project_id uuid, site_label text, state text)`; order by employee ID and day; limit is 1–100 employees, request one extra employee to indicate continuation, never partial days. Caller obtains next cursor from the last returned employee. Both functions are stable, use existing server role/scope predicates and reject invalid/foreign requests without exposing identity.

- [ ] **R3.1 red (4 min):** `employee_roster_reads.test.sql`: AC-ER-003 14-on/7-off boundaries, AC-ER-007 assigned and unassigned lookup, leap-day cycle wrap; AC-ER-011 reversed dates, 63 days, zero counts reject, 62 days succeeds and page continuation preserves all days. Expect missing functions.
- [ ] **R3.2 green (5 min):** Implement lookup and roster with inclusive `generate_series` dates and integer date offset modulo cycle length; compute on/off before presentation. Null end is infinity. Refuse requests exceeding 62 days rather than truncating.
- [ ] **R3.3 red→green (4 min):** AC-ER-008 privileged org scope, inactive denial and linked own-only result; implement scope checks and test foreign employee IDs. Mutation-check both role and org guards. Add rollback to drop only these reads.
- [ ] **R3.4 gate (5 min):** Run shared DB gates and commit `feat: expose bounded employee roster reads`.

## R4 — API permission registration (0536; ships alone)

**Files:** `supabase/migrations/0536_employee_roster_api_permissions.sql`, `supabase/migrations/rollback/0536_employee_roster_api_permissions_down.sql`, `supabase/tests/employee_roster_api_permissions.test.sql`, generated types; permission catalogue docs only if #902 has landed.

- [ ] **R4.1 red (4 min):** `employee_roster_api_permissions.test.sql` exercises authenticated API client roles for each R1–R3 RPC, including Engineer denial of management and own-only read; assert foreign organisation denial. Run shared DB command and observe red for unregistered functions.
- [ ] **R4.2 green (5 min):** Extend the newest `api_client_request_guard` body with exact R1–R3 RPC names and OQ-ER-4 tiers, without widening other calls. Restore prior body verbatim in rollback. If #902 has landed register named actions and scopes in its shipped catalogue; otherwise record this as an explicit #902 integration requirement, not an invented parallel matrix.
- [ ] **R4.3 gate (5 min):** Run R4 and shared DB gates, mutation-check the API role gate, restore and commit `feat: register roster API permissions`.

## R5 — Repository and screens (no migration)

**Files:** `pmo-portal/src/lib/db/employeeRoster.ts`, `src/lib/repositories/contracts/employeeRoster.ts`, `src/lib/repositories/employeeRoster.ts`, `src/lib/repositories/index.ts`, `src/hooks/useEmployeeRoster.ts`, `src/auth/policy.ts`, `pages/EmployeeRoster.tsx`, `pages/EmployeeRoster.test.tsx`, `src/hooks/useEmployeeRoster.test.tsx`, `src/auth/policy.test.ts`, `App.tsx`, and `public/locales/en/employeeRoster.json`, `public/locales/id/employeeRoster.json`, and the existing i18n namespace registration.

**Interfaces:** DAL wraps R1–R3 RPCs with generated types; repository exports `listRoster(from,to,after,limit)`, `resolveAssignment(employeeId,date)`, `saveEmployee`, `archiveEmployee`, `saveAssignment`, `archiveAssignment`. Hook query keys include org and period/cursor; mutations invalidate employee and roster roots. Route `/employees` shows employee list, assignment form and period roster; preserve existing app navigation patterns.

- [ ] **R5.1 red (4 min):** `useEmployeeRoster.test.tsx` tests org/period keys, pagination cursor and invalidation after save; `policy.test.ts` tests each OQ-ER-4 role and own scope. Run `cd pmo-portal && npx vitest run src/hooks/useEmployeeRoster.test.tsx src/auth/policy.test.ts`; expect missing implementation.
- [ ] **R5.2 green (5 min):** Implement typed DAL, repository contract/registry, hooks and UX permission predicates; no direct DAL from pages and no client-supplied org ID.
- [ ] **R5.3 red (4 min):** In `pages/EmployeeRoster.test.tsx`, AC-ER-009 asserts empty state and retains entered values on rejected save with retry; AC-ER-010 asserts project/site, on/off/unassigned dates, keyboard operation and axe. Run `npx vitest run pages/EmployeeRoster.test.tsx`; expect failure.
- [ ] **R5.4 green (5 min):** Implement accessible responsive page with shared form/confirm/error primitives, server conflict messaging, 62-day date validation, paging and both locale translations. Render date strings without timezone conversion. Hook route and navigation into `App.tsx` using current patterns.
- [ ] **R5.5 gate:** Run app shared gates, named tests and `scripts/ux-proof.sh /employees`; Director performs one rendered review of all states. Commit `feat: add employee roster workflow`.

## R6 — Cross-stack journey (no migration)

**Files:** `pmo-portal/e2e/AC-ER-013-employee-roster.spec.ts`. Read `docs/e2e-parallel-conventions.md` first; use isolated synthetic fixtures and `@e2e-isolation`.

- [ ] **R6.1 red (4 min):** Add AC-ER-013: Given an Admin and a project, When they create a person without a login, assign a site with 14-on/7-off from 1 March and open 28 February–22 March, Then the roster shows the site and on/off boundary and unassigned day before the assignment. Run `scripts/e2e-local.sh AC-ER-013` under `scripts/with-db-lock.sh`; investigate any failure in shipped behavior, never weaken the goal.
- [ ] **R6.2 green/gate:** Fix the owning slice if red, rerun the same journey, capture output, commit `test: cover employee roster journey`. The full browser suite remains the release-PR CI gate.

## AC → owning layer and proof

| AC | Owner | Test |
|---|---|---|
| 001, 002, 012 | pgTAP R1 | `supabase/tests/employee_roster_identity.test.sql` |
| 003, 007, 008, 011 | pgTAP R3 | `supabase/tests/employee_roster_reads.test.sql` |
| 004, 005, 006 | pgTAP R2 | `supabase/tests/employee_roster_assignments.test.sql` |
| 009, 010 | Vitest/RTL R5 | `pmo-portal/pages/EmployeeRoster.test.tsx` |
| 013 | Playwright R6 | `pmo-portal/e2e/AC-ER-013-employee-roster.spec.ts` |

AC-ER-008's inactive write denial may have additional regression coverage in R1, but R3 is its single owner. API registration, accessibility and mutation checks supplement these proofs. Review spec and owner decisions after sign-off and update all dependent tasks before dispatch.
