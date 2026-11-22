# Plan — labour cost for crew members with no login (NLL)

Spec `docs/specs/no-login-labour-cost.spec.md`. Branch `feat/gap-people-no-login-labour-cost` off `land/fix-1122`.
Money path: ships alone. Migrations **1720, 1721** (range 1720-1729). Builder writes pgTAP and e2e; the wave run executes
them (no local DB). Every restated function body is copied from the database at head
(`docker exec supabase_db_pmo-portal psql -U postgres -tAc "select pg_get_functiondef('public.<fn>(<args>)'::regprocedure)"`),
and only the lines named below change. Both migrations replace a few named lines, so each carries a `-- drops: <reason>`
marker naming them, which `npm run check:restated-functions` accepts and prints for the reviewer.

## Design

```
labour_cost_classes (1250, unchanged) ── one organisation-wide list, also used by guard head-count later
   │
   ├─ labour_cost_rates           subject_kind gains 'class' (class_id is the subject; person_id, role_key null)
   │     labour_class_rate_for(org, class, date)       latest start in force, not archived
   │
   └─ labour_class_assignments    NEW: worker_id (people) → class_id, effective_from/to, archived_at (dated, like rates)
         labour_class_for(org, worker, date)           latest start in force, not archived

labour_cost_attendance_days (view, NOT granted)        THE no-double-count rule, one place: present, approved,
                                                       no timesheet link, no approved timesheet line of the
                                                       person's login on the same project and date, hours > 0
   │
labour_cost_class_lines(project)                       NEW internal reader: every class-priced labour line of a
   │                                                   project. Branch 1 (this item): source 'attendance_day'.
   │                                                   Gated on labour_cost_enabled. Overtime = timesheet rule.
   ▼
work_order_cost_amounts(project)  (restated from 1298 head)  + union of class lines: per row for Admin/Finance/
   │                                                   Executive; aggregate per WO/discipline/class/source for PM
   ├─ work_order_idle_cost        (restated)  hourly cost = counted rows with labour_class_id and unit 'hours'
   └─ work_order_performance      (1286, unchanged) already sums every 'counted' row → inherits attendance cost
```

Why a dated assignment and not a column on `people`: a plain column re-prices every approved day when a person is
reclassified, which FR-LCM-005 (history is stable) forbids; a column plus a lock would make promotion impossible. The
assignment mirrors the rate model exactly (start, end, archive, latest start wins, history lock).

**How the later items stack (no change to this item's objects):**
- *guard-headcount* adds a second `union all` branch to `labour_cost_class_lines` (source e.g. `headcount_day`,
  record id = its head-count record, class from that record — the same `labour_cost_classes` list), priced through the
  same `labour_class_rate_for(org, class, date)`; amount = head-count x the daily equivalent. `work_order_cost_amounts`
  maps class lines generically (source, quantity, unit and class pass through; PM aggregation groups by source), so it is
  not restated again; the front end adds the source to `SOURCES` / `FinanceCostSource`. If its quantity is stated in hours
  (head-count x the rate's day length) it enters idle hourly cost automatically; in another unit it stays out.
- *idle-with-rent* reads its hourly cost from `work_order_cost_amounts` with the predicate this item introduces in
  `work_order_idle_cost` (`reason = 'counted' and labour_class_id is not null and quantity_unit = 'hours'`); one predicate,
  copied or factored into a helper by that item.

## Tasks

### T1 — pgTAP first (red) — `supabase/tests/1720_labour_class_rates.test.sql`, `supabase/tests/1721_no_login_labour_cost.test.sql`
Fixtures follow `supabase/tests/1251_labour_cost_amounts.test.sql` and `supabase/tests/attendance_timesheet.test.sql`
(org, Admin/Finance/Executive/PM/Engineer profiles via the test helpers, one project, two work orders, one crew; people
rows with and without `profile_id`; approved no-login days inserted as postgres with `approved_at`, `approved_by`,
`locked_at` set — the guard checks lock only on UPDATE/DELETE).
- 1720 owns AC-NLL-009, 010, 011. 1721 owns AC-NLL-001..008.
- AC-NLL-001: as Finance, with the switch off, `create temp table before_cost as select * from work_order_cost_amounts(P)`
  and the same for `work_order_idle_cost(P)` **before** inserting attendance, class rates and assignments; insert them;
  `results_eq` (ordered by source, record_id, work_order_id, class) before vs after for both reads; then switch on and
  assert an `attendance_day` row exists (so the test is not vacuous).
- AC-NLL-006: one project, three people: L (login, attendance → `attendance_generate_timesheet` → timesheet approved by a
  non-recorder), N (no login, week approved by `attendance_decide_week`), B (attendance approved while no login; then a
  `profile_id` is set and an approved timesheet line for the same project and date is inserted). Assert per person and
  date `count(*) = 1` across the whole `work_order_cost_amounts(P)` output for rows with `quantity_unit = 'hours'`, the
  source of each, and `sum(amount)` of counted labour = the hand sum.
- AC-NLL-007: PM — no `attendance_day` row with a non-null `record_id`, `occurred_on` or `person_id`; aggregate sum =
  Finance's per-row sum; `select count(*) from labour_cost_rates where subject_kind = 'class'` = 0 and the same on
  `labour_class_assignments`; Engineer → `throws_ok(..., '42501')`; Executive sees per-row rows and the rates.

### T2 — migration `supabase/migrations/1720_labour_class_rates.sql` (+ `rollback/1720_labour_class_rates_down.sql`)
1. `labour_cost_rates`: drop/re-add `labour_cost_rates_subject_kind_check` as `subject_kind in ('person','role','class')`;
   drop/re-add `labour_cost_rates_subject` with a third arm `(subject_kind = 'class' and person_id is null and role_key is null)`;
   drop/re-create `labour_cost_rates_one_start` on `(org_id, subject_kind, coalesce(person_id::text, role_key, class_id::text), effective_from) where archived_at is null`
   (identical keys for existing rows). `labour_rate_for` is untouched: its predicate names `person` and `role` only, so
   a class rate never prices a timesheet.
2. `create table public.labour_class_assignments (id uuid pk default gen_random_uuid(), org_id uuid not null default
   public.auth_org_id() references organizations on delete cascade, worker_id uuid not null references people(id),
   class_id uuid not null references labour_cost_classes(id), effective_from date not null, effective_to date,
   archived_at timestamptz, created_by uuid references profiles(id), created_at timestamptz not null default now(),
   constraint labour_class_assignments_window check (effective_to is null or effective_to >= effective_from))`;
   unique `(org_id, worker_id, effective_from) where archived_at is null`; index `(worker_id, effective_from)`.
   RLS enable + force; one select policy, the rates predicate verbatim:
   `org_id = (select public.auth_org_id()) and (select public.is_active_member()) and (select public.auth_role()) in ('Admin','Finance','Executive')`.
   `revoke all ... from public, anon, authenticated; grant select to authenticated; grant all to service_role`. Writes by RPC only.
3. `create view public.labour_cost_attendance_days with (security_invoker = true)` — columns id, org_id, worker_id,
   project_id, work_order_id, crew_id, work_date, `hours + coalesce(overtime_hours, 0) as hours`; where
   `status = 'present' and approved_at is not null and timesheet_entry_id is null and hours + coalesce(overtime_hours,0) > 0
   and not exists (select 1 from people w join timesheets t on t.user_id = w.profile_id and t.org_id = a.org_id and t.status = 'Approved'
   join timesheet_entries e on e.timesheet_id = t.id where w.id = a.worker_id and e.project_id = a.project_id
   and e.entry_date = a.work_date and e.hours > 0)`. `revoke all ... from public, anon, authenticated` (read only inside definers).
4. `labour_class_for(p_org, p_worker, p_date) returns setof labour_class_assignments` and
   `labour_class_rate_for(p_org, p_class, p_date) returns setof labour_cost_rates` (sql, stable, definer, `order by effective_from desc limit 1`), revoked from public/anon/authenticated.
5. `labour_class_locked(p_org uuid, p_kind text, p_id uuid, p_from date) returns boolean` — exists a costed day
   (`labour_cost_attendance_days`, org, `work_date >= p_from`) **priced now** (lateral `labour_class_for` x lateral
   `labour_class_rate_for` both found) where: kind `rate` → that rate prices it; `assignment` → that assignment; `worker`
   → the day's worker = p_id; `class` → the class in force = p_id. Independent of the switch (1299 rule). Revoked.
6. RPCs (definer; first statements `perform public.assert_not_light(); perform public.assert_is_active_member();`,
   gate `labour_cost_gate()`; audit through `log_audit`): `save_labour_class_assignment(p jsonb) returns uuid` (person and
   class in caller's org, class not archived, start required, end ≥ start; lock kind `worker` from start →
   `LCM_CLASS_LOCKED: this would change hours already costed for this person; start the new class after the last costed day`;
   unique → 23505), `end_labour_class_assignment(p_id, p_end)` (added-span check like `end_labour_cost_rate`, lock kind
   `assignment` from `p_end + 1`), `archive_labour_class_assignment(p_id)` (lock kind `assignment` from `0001-01-01`).
   Grant execute to authenticated.
7. Restate from head **`save_labour_cost_rate(jsonb)`**: accept `class` (`v_kind in ('person','role','class')`; message
   "subject_kind must be person, role or class"); for `class` no person/role parsed; lock line becomes
   `if (v_kind = 'class' and public.labour_class_locked(v_org, 'class', v_class, v_from)) or (v_kind <> 'class' and public.labour_rate_locked(...))`.
   **`end_labour_cost_rate(uuid,date)`**: added-span `exists` gains an attendance arm for `r.subject_kind = 'class'`
   (costed days in the span whose class in force is `r.class_id`, priced by another rate); the final lock adds
   `or public.labour_class_locked(v_org, 'rate', p_id, p_end + 1)`. **`archive_labour_cost_rate(uuid)`**: adds
   `or public.labour_class_locked(v_org, 'rate', p_id, date '0001-01-01')`. File header:
   `-- drops: save_labour_cost_rate's subject check and lock line gain the class subject (FR-NLL-001/008)`.
8. Rollback: restore the three restated bodies from head (copy the `pg_get_functiondef` text taken before the migration),
   drop the three RPCs, `labour_class_locked`, `labour_class_rate_for`, `labour_class_for`, the view, the table;
   `delete from labour_cost_rates where subject_kind = 'class'` (data loss stated in the file header); restore the
   index, the subject constraint and the kind check to their 1250 definitions.

### T3 — migration `supabase/migrations/1721_work_order_cost_amounts_attendance.sql` (+ rollback)
1. `labour_cost_class_lines(p_project_id uuid) returns table(source text, record_id uuid, work_order_id uuid,
   discipline_id uuid, occurred_on date, class_id uuid, quantity numeric, quantity_unit text, amount numeric, worker_id uuid)`,
   sql stable definer, revoked from public/anon/authenticated. CTEs mirror `labour_cost_priced_lines` (1251):
   `org` (auth_org_id) → `proj_days` (distinct worker, date of the project's costed days, `and public.labour_cost_enabled(org.id)`)
   → `ent` (all costed days of those worker-dates, any project) → `rated` (cross join lateral `labour_class_for`, cross
   join lateral `labour_class_rate_for`) → `cum` (prior hours partitioned by worker, date, ordered by project_id, id) →
   `split` (regular / hourly equivalent as 1251). Output: priced rows of the project (`'attendance_day'`, id,
   work order, crew discipline, date, class, hours, `'hours'`, rounded amount, worker) **union all** the project's
   costed days absent from `rated` (class null, amount null). The front end and `work_order_cost_lines` take the
   discipline from the crew (`1037:294`); same here.
2. Restate **`work_order_cost_amounts(uuid)`** from head; add `, cls as (select * from public.labour_cost_class_lines(p_project_id))`
   and two branches:
   ```sql
   union all
   select l.source, l.record_id, p_project_id, l.work_order_id, l.discipline_id, l.occurred_on, null::text,
          case when l.amount is null then null::text else v_cur end, l.amount::text,
          case when l.amount is null then 'no-rate' else 'counted' end, l.quantity, l.quantity_unit,
          case when v_pm then null::uuid else l.worker_id end, l.class_id
     from cls l
    where not v_pm or l.amount is null
   union all
   select l.source, null::uuid, p_project_id, l.work_order_id, l.discipline_id, null::date, null::text, v_cur,
          sum(l.amount)::text, 'counted', sum(l.quantity), l.quantity_unit, null::uuid, l.class_id
     from cls l
    where v_pm and l.amount is not null
    group by l.source, l.work_order_id, l.discipline_id, l.class_id, l.quantity_unit;
   ```
3. Restate **`work_order_idle_cost(uuid)`** from head; the `wo_cost` filter line
   `where c.source = 'timesheet_entry' and c.reason = 'counted' and c.work_order_id is not null` becomes
   `where c.reason = 'counted' and c.labour_class_id is not null and c.quantity_unit = 'hours' and c.work_order_id is not null`
   (the same rows as today: a counted timesheet row always carries its rate's non-null class, `1250:31`). This one
   restatement drops a line, so the file carries `-- drops: idle hourly cost reads every counted hourly labour row, not only timesheet rows (FR-NLL-009)`.
4. Rollback: restore both bodies from head, drop `labour_cost_class_lines`.

### T4 — generated types `pmo-portal/src/lib/supabase/database.types.ts` (hand-edit)
`labour_class_assignments` Row/Insert/Update/Relationships; Functions `save_labour_class_assignment`,
`end_labour_class_assignment`, `archive_labour_class_assignment`, `labour_cost_class_lines`. No casts; `check:typed-dals` 0.

### T5 — repository + parse (vitest first)
- `pmo-portal/src/lib/db/workOrderFinance.ts`: `SOURCES` += `'attendance_day'`; `aggregatedLabour` accepts source
  `timesheet_entry` or `attendance_day`. Test AC-NLL-012 in `workOrderFinance.test.ts`.
- `pmo-portal/src/lib/workOrderPlanVsActual.ts`: `FinanceCostSource` += `'attendance_day'`; `hourFigures` crew = timesheet
  rows not `not-posted` **plus** attendance rows; `labourByClass` reads both sources. Test AC-NLL-013 in
  `workOrderPlanVsActual.test.ts`.
- `pmo-portal/src/lib/db/labourCost.ts`: `RateSubject` += `'class'` (payload: no person/role; `validateRateInput`
  subject check skips class); `listLabourClassAssignments`, `saveLabourClassAssignment`, `endLabourClassAssignment`,
  `archiveLabourClassAssignment`; the people picker reads `people` with `profile_id is null`, not archived, paged.
  Repository `src/lib/repositories/labourCost.ts`, hook `src/hooks/useLabourCost.ts`. Tests in `labourCost.test.ts`.

### T6 — screen (restructure skill; DESIGN.md tokens; shared primitives; 390 px and 1440 px)
- `pmo-portal/pages/admin/LabourCostSettings.tsx`: subject select gains "Labour class" (the class field is the subject).
- NEW `pmo-portal/pages/admin/LabourClassAssignments.tsx` (rendered inside the Labour cost section, Admin/Finance via
  `can()`): list (person, class, from, to), add (`EntityFormModal`, `Combobox` person, `SelectField` class, dates), end,
  archive (`ConfirmDialog`). Empty list: "No crew member has a labour class yet. Admin or Finance adds one here; hours of
  people with no login are costed by their class." Disabled end/archive say why.
- Strings EN + ID: `public/locales/{en,id}/administration.json` (`labourCost.*`), `public/locales/{en,id}/workOrderPva.json`
  (`source.attendance_day`: "Attendance" / "Kehadiran"), `public/locales/{en,id}/refusals.json` (`LCM_CLASS_LOCKED`).
- Tests: `pages/admin/LabourClassAssignments.test.tsx`, `pages/admin/LabourCostSettings.test.tsx` (class subject).
- e2e: `pmo-portal/e2e/serial/AC-NLL-014-crew-member-class.spec.ts` after `AC-LCM-018-labour-cost-rates.spec.ts`
  (Finance: switch on, add class rate, assign a class to a no-login person, end it; see it listed), tagged per
  `docs/e2e-parallel-conventions.md`.

### T7 — docs
`docs/glossary.md`: Class rate, Labour class assignment, Costed attendance day; amend "Labour class" (also held by a person).

## Traceability
| AC | Owning test |
|---|---|
| AC-NLL-001..008 | `supabase/tests/1721_no_login_labour_cost.test.sql` |
| AC-NLL-009..011 | `supabase/tests/1720_labour_class_rates.test.sql` |
| AC-NLL-012 | `pmo-portal/src/lib/db/workOrderFinance.test.ts` |
| AC-NLL-013 | `pmo-portal/src/lib/workOrderLabourCost.test.ts` (the labour-cost rollup gate-tests) |
| AC-NLL-014 | `pmo-portal/pages/admin/LabourClassAssignments.test.tsx` + `e2e/serial/AC-NLL-014-crew-member-class.spec.ts` |
Regression guards that must stay green: `1250_labour_cost_rates`, `1251_labour_cost_amounts`, `1255_idle_cost`,
`1298_work_order_labour_reads`, `1299_labour_rate_history_lock`, `attendance_timesheet`, `1286` performance tests.

## Added on the Director's go (Phase B)
- `pmo-portal/src/lib/db/workOrderFinance.ts` lists `expense_claim`: a project with an expense claim naming a work order
  no longer makes the plan-versus-actual read fail (`workOrderFinance.test.ts`).
- `pmo-portal/src/lib/db/workOrderCosts.ts` lists `attendance_day`: the work-order Costs section shows approved no-login
  attendance from the attribution view instead of dropping it, labelled "Attendance" (`workOrderCosts.test.ts`,
  `pages/WorkOrderDetail.test.tsx`).
- Customer answers taken for the build (logged as open by the Director): overtime by the timesheet day-length rule; a
  class rate does not price login people; no rate by crew position.

## Mutation checks (wave run; each: edit, `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db <file>'`, expect `not ok` on the named AC, `git checkout -- <migration>`, reset again)
- **M1 no double count (a):** in `1720_labour_class_rates.sql` view `labour_cost_attendance_days` delete
  `and a.timesheet_entry_id is null` → `1721` AC-NLL-006(a) red (L counted twice). **(b):** delete the
  `and not exists (... approved timesheet line ...)` clause → AC-NLL-006(c) red.
- **M2 switch gate:** in `1721_...sql` `labour_cost_class_lines`, replace `and public.labour_cost_enabled(org.id)` with
  `and true` → AC-NLL-001 red.
- **M3 privacy (a):** in `work_order_cost_amounts` change `where not v_pm or l.amount is null` to `where true` →
  AC-NLL-007 red (PM sees per-row money and person). **(b):** in `1720`, add `'Project Manager'` to the
  `labour_class_assignments` select policy roles → AC-NLL-007 red.
- **M4 history lock:** replace the body of `labour_class_locked` with `select false` → `1720` AC-NLL-011 red.

## Local gates (builder)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`,
`npx vitest related --run <changed source files>` + touched tests. pgTAP, e2e and screenshots: the wave run.
