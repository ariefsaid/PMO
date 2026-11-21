# Light accounts: Foreman and Field user on one phone home screen

Ticket #2710 (map #902). Status: Approved by the Director 2026-11-21 (rulings below applied), built. Rulings: OD-SCOPE-4 (binding), OD-SCOPE-3, OD-SCOPE-2.
Builds on `builtin-role-set.spec.md` (#2709). Clock-in at the work location is #2705; handover with count and photo is the handover ticket.

**Job story.** When a foreman or a field worker uses PMO only for their own jobs, I want a light account with one phone home screen,
so they see only what is theirs and the seat costs less.

## 1. Design in one paragraph

A **light account** is an active profile whose `built_in_role` is `foreman` or `field_user` (both Engineer base). One SQL helper
`profile_seat_type(profile)` gives `'light'` or `'full'`; `actor_is_light()` is the same for the signed-in, active person. Nothing
changes for anyone else: a NULL key or any other key is `full`. Enforcement is in the database: **restrictive** RLS policies, one per
covered table, whose predicate is `(select actor_is_light()) is not true or <own-row test>`. Existing permissive policies are
untouched, and a restrictive policy can only narrow, so a full Engineer reads exactly what it reads today. The phone home screen
(`/my`) reads through a few `security definer` RPCs that return only the person's own items, so a light account never needs a project
or work-order read to see the project or work-order *name* next to its own task. The seat report splits full and light.
No new setting: nothing activates until `built_in_roles_enabled` is on AND someone holds a light key (#2709 FR-012).

## 2. What exists on dev (prior-art result, scope stated)

Searched decisions, ADRs, migrations, hooks and issues with `scripts/prior-art.sh` for seat, usage, delivery, handover, receiving,
delivery note, attendance, roster.
- **Seats:** `profiles.status = 'active'` counted against `plans.seat_limit` (0535, `PL001`). Limit and price stay the owner's (#2539); this
  ticket only adds a read-only split. The cap itself is not changed.
- **Attendance:** `attendance_record(work_order, date, source, rows)` (1110), `work_order_roster` (1036), `crew_members`,
  `work_order_crews`, `crews.field_controller_id` (a profile). A field controller already may record for the crew rostered that day.
  Source `phone_check_in` exists. This ticket calls the existing RPC; #2705 adds the location test behind the same call.
- **Deliveries addressed to a person, count and photo:** NOT on dev. Only `procurement_receipts` / `stock_documents` exist (site and
  warehouse side, no "addressed to person", no confirm-with-photo). OD-SCOPE-10 (handover) is the ticket that creates it. This ticket
  builds the **section and a typed seam** (`useMyDeliveries`, returns an empty list until the handover ticket supplies a source) and
  no table, no ledger, no stock write.
- **Tasks:** `tasks.assignee_id` (profile). **Issues:** `incident_reports.reported_by` (profile).

## 3. Requirements (EARS)

- **FR-001** The system shall derive seat type from the role key through one SQL function `profile_seat_type(uuid)` and one frontend mirror
  `seatTypeOf(key)`: `light` for `foreman` and `field_user`, `full` for every other key and for NULL.
- **FR-002** The system shall expose `actor_is_light()` (real signed-in active person; false for inactive, anonymous, legacy).
- **FR-003** While the actor is a light account, the database shall return no row of a covered table (section 5) except the person's own
  rows; writes to covered tables outside the person's own items shall be refused. The refusal is by RESTRICTIVE policies.
- **FR-004** While the actor is not a light account, every covered-table policy outcome shall equal today's (the restrictive predicate is
  true). The predicate is one `(select actor_is_light())` call (0646 initplan).
- **FR-005** Own rows are: tasks where `assignee_id` is the person; incident reports where `reported_by` is the person; work orders (and their
  roster rows) the person is rostered on today through `crew_members` / `work_order_crews`; for a Foreman additionally the crews where
  `field_controller_id` is the person, their members and the work orders those crews serve; attendance rows already limited to own/own-crew.
- **FR-006** `my_home()` (security definer, light or full caller, own items only) shall return: assigned tasks (any project, with project name,
  no value fields); work orders rostered today (id, title, project name, today's date); reported issues; for a Foreman, the crew
  roster per rostered work order. It returns no price, budget or contract field.
- **FR-007** When a light account signs in, it shall land on `/my`; every other route shall redirect to `/my`; the navigation rail, search
  and command palette shall not render. A full account never sees `/my` redirect behaviour (the route exists, shows the same four sections
  for its own items, no redirect rule applies).
- **FR-008** The clock-in section shall list today's rostered work orders and call the existing `attendance_record` path with source
  `phone_check_in`. A work order the person is not rostered on is not offered; the off-roster case is a request to the supervisor
  (a plain "ask your supervisor" note until #2705 supplies the routed request). A visible seam `ClockInSection` takes an optional
  `locationCheck` prop for #2705.
- **FR-009** The Foreman's section shall show the crew roster for today and tick attendance through the existing roster-tick path
  (`attendance_record`, source `roster_tick`); a Field user shall see no roster section.
- **FR-010** The deliveries section shall render the seam with an empty state until the handover ticket supplies deliveries; it shall write nothing.
- **FR-011** The seat report shall split active seats into full and light (`org_seat_report()`, Admin/Executive of the organization), additive
  to the existing plan read; `seat_limit` enforcement is unchanged and counts both types.
- **FR-012** The UI shall be English and Bahasa Indonesia, phone-first, token-only, one column, 44px touch targets.
- **NFR-001** Existing tests untouched and green; no existing repository gains a method (new standalone module `myHome.ts`).

## 4. Acceptance criteria and owning layer

| ID | Given / When / Then | Owner |
|---|---|---|
| AC-LA-001 | `profile_seat_type` is `light` for exactly `foreman` and `field_user` over all 28 keys, `full` for the other 26 and for NULL; `actor_is_light` false for legacy, inactive, anonymous. | pgTAP |
| AC-LA-002 | Given a light Foreman, then on each covered table it reads only its own rows (tasks assigned, incidents reported, rostered work orders, own crews); other rows of the same org are invisible. | pgTAP |
| AC-LA-003 | Given a light Field user, then it reads zero rows of projects, budgets, lists and price tables, and only rostered work orders. | pgTAP |
| AC-LA-004 | Given a full Engineer (NULL key) and an Engineer holding `engineer`, then row counts on every covered table equal the counts before the migration (fixed expected literals from seed). | pgTAP |
| AC-LA-005 | Given a light actor, when it inserts/updates/deletes a covered row that is not its own, then refused; when it updates its own task status, then allowed. | pgTAP |
| AC-LA-006 | `my_home()` for a light actor returns only own items and no price/budget key (jsonb key list asserted). | pgTAP |
| AC-LA-007 | `org_seat_report()` splits full/light for an org; another org's Admin and a light actor are refused. | pgTAP |
| AC-LA-008 | Predicate is a single initplan call (0646 passes on the new policies). | pgTAP (0646 existing) |
| AC-LA-009 | `seatTypeOf` equals SQL over all keys; `isLightAccount` false for legacy. | vitest |
| AC-LA-010 | A light account at any route is redirected to `/my`; the nav is not rendered; a full account is not redirected. | vitest |
| AC-LA-011 | `/my` shows four sections; Foreman also the roster; Field user not; clock-in lists rostered work orders and calls `attendance_record` with `phone_check_in`; deliveries shows the empty seam; EN and ID strings. | vitest |
| AC-LA-012 | Seat report on Administration shows full and light counts; unchanged when no light roles. | vitest |
| AC-LA-013 | Given a light account, each of six guarded definer RPCs refuses with `LIGHT_ACCOUNT`. | pgTAP |
| AC-LA-014 | The standing sweep: every public security-definer function `authenticated` can execute either refuses a light account in its body or is on the named allowlist (each entry with its reason), and every public table carrying `org_id` either carries the restrictive light or own-row select policy or is on the named allowlist; the project-documents bucket carries the restrictive light read policy. A later function or table without either fails the sweep. | pgTAP |
| AC-LA-E2E | A Foreman signs in, lands on `/my`, ticks crew attendance, and a typed URL for a project returns to `/my`. | E2E (curated, serial) |

Mutation checks (named, not run by the builder): drop the `tasks` restrictive policy (AC-LA-002 red); make `actor_is_light()` return false
(AC-LA-002/003/005 red); make `profile_seat_type` return `light` for `engineer` (AC-LA-001 red); drop the own-task clause (AC-LA-005 red);
remove a price-key from the `my_home` exclusion test (AC-LA-006).

## 5. Covered tables (restrictive policies; verified against `pg_policies` and `role_table_grants` at build)

| Table | Light actor may read |
|---|---|
| `projects`, `project_documents`, `milestones`, `project_members` | nothing (names come through `my_home()`) |
| `work_orders`, `work_order_lines`/value/cost tables | only work orders rostered today (Foreman: also their crews') |
| `tasks` | `assignee_id` = self; update own status only |
| `incident_reports` | `reported_by` = self; insert own |
| budget tables (`budgets`, `budget_line_items`), invoices, payments, procurement, stock cost and price tables | nothing |
| `companies`, `contacts` and the other list tables the Engineer can read | nothing |
| `crews`, `crew_members`, `work_order_crews` | rostered work orders; Foreman: own crews, members |
| `attendance_days` | unchanged (already own / own-crew) |

Not narrowed: profile names and organisation reference data (the shell needs them), and per-person tables whose existing policies are
already own-row.

## 6. Settings

None new. Activation is `built_in_roles_enabled` (#2709) plus someone holding a light key. Seat price and counts remain the owner's (#2539).
Who holds a light role is set in the existing Edit role form; the seat report is read-only.

## 6a. Director rulings applied

1. Deliveries: section plus `useMyDeliveries` seam returning an empty list; no table, no stock write; the section renders nothing while empty; the handover ticket (OD-SCOPE-10) is the source.
2. Covered tables: the list in section 5, named in migration 1206 (60 deny tables + 6 own-row tables). Predicate is `(select actor_is_light()) is not true or <own-row>`.
3. Off-roster clock-in: a plain "ask your supervisor" note until #2705 routes it.
4. Own incident reports read plus insert; own tasks read plus status-only update (restrictive policies + trigger `aa_tasks_light_status_only`).
5. Definer RPCs (FR-013, AC-LA-013): see below.

**FR-013** Where a security-definer RPC returns project, budget, price, billing or list data to `authenticated`, it shall refuse a light account first (`assert_not_light()`, SQLSTATE 42501, message `LIGHT_ACCOUNT: ...`). Security-INVOKER reads (executive dashboard, projects delivery, sales pipeline, win rate, finance budget review, budget projection, project milestones and milestone dates, budget distribution gaps, fiscal years, project budget, budget push status) need no guard: restrictive RLS makes them return zero rows to a light account.
Guarded in 1209: every security-definer function that returns data to `authenticated` (the 78 names listed in the migration), except the helpers the shell and the home path call (`auth_role`, `actor_authorization_state`), the attendance path (`attendance_record`, `attendance_generate_timesheet`, which the crew tick uses), `my_home`, and the operator functions, which have their own gate. A name that cannot be rewritten fails the migration. pgTAP checks every guarded body carries the guard, the exempt ones do not, and a light account can still record attendance (AC-LA-013).
Guarded in 1461: the write-side definers a light account has no screen for (material and client requisitions, procurement and stock documents, timesheets, daily reports, equipment usage, imprest, billing stages and retention, and the assistant credit bookkeeping). A function a light account legitimately calls stays on the sweep's allowlist with its reason.
The standing sweep (AC-LA-014, `2711_light_account_boundary_sweep.test.sql`) is the contract for later work: a new definer or `org_id` table that is neither guarded nor on the named allowlist fails it, whichever lane it lands from.

## 7. Not in this ticket

Daily report entry from the phone (Q1 2027). The location test (#2705). A deliveries table or any stock-ledger change (handover ticket,
ships alone). Offline capture.
