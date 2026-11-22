# Plan: daily head count (HC)

Spec `docs/specs/guard-headcount.spec.md`. Branch `feat/gap-people-guard-headcount` off
`feat/gap-people-no-login-labour-cost`, merged with `land/fix-1122` (clean after two trivial text merges in
`CostSection.tsx` and the two `workOrders.json` files). Money path: ships alone. Builder writes pgTAP and e2e; the
wave run executes them (no local DB). Restated bodies are copied from the database at head
(`pg_get_functiondef`), only the lines named change.

## MIGRATION NUMBERS: needs a decision from the orchestrator
The brief gives 1710-1719. Table 1710 is fine there (references only `labour_cost_classes`, 1250). But the two
**restatements** (`labour_cost_class_lines` from 1721 and `labour_class_locked` from 1720) must sort **after** 1721, or
`supabase db reset` replays them before the objects exist. Ask: a second number pair after 1721 (for example 1722-1723,
unused today) for the restating migration, or move everything above 1721. Plan below uses 1710 (table and RPCs) and
`<R>` (restatements, number to be given).

## Design

```
headcount_days (NEW, 1710)  org_id, work_order_id, crew_id, work_date, class_id, head_count 1..500,
   │                        entered_by, recorded_by_ids uuid[], entered_at, approved_by, approved_at, locked_at
   │                        unique (work_order_id, crew_id, work_date, class_id)
   │                        select-only grants; writes by 3 definer RPCs
   ▼
labour_cost_class_lines (restated, <R>)  += branch 'headcount_day': approved lines, switch on, priced by
   │                                     labour_class_rate_for(org, class, date); amount = count x daily equivalent
   ▼
work_order_cost_amounts / idle cost / PVA   unchanged SQL (generic mapping, plan NLL "stacking")
```
Single FK path from `headcount_days` to each of `work_orders`, `crews`, `labour_cost_classes`, `profiles` (two profile
FKs, entered_by and approved_by, are named constraints and never embedded: reads use RPC or explicit `!constraint_name`
hints), so no existing embed becomes ambiguous.

## Tasks

### T1 pgTAP first (red): `supabase/tests/1710_headcount_days.test.sql`, `supabase/tests/<R>_headcount_cost.test.sql`
Fixtures: `1721_no_login_labour_cost.test.sql` and `attendance_timesheet.test.sql` (org, Admin/Finance/Executive/PM/
Engineer, a field account, a disabled member, a project with two work orders, a crew rostered on WO-A only with the
Engineer as `field_controller_id`, hourly/daily/monthly class rates). 1710 owns AC-HC-005, 006, 007, 012 support;
`<R>` owns AC-HC-001..004, 008, 009. Each AC asserts the oracle named in the spec, with the exact message.

### T2 migration `supabase/migrations/1710_headcount_days.sql` (+ `rollback/1710_headcount_days_down.sql`)
1. Table as designed; `org_id uuid not null default public.auth_org_id()` plus `stamp_org_id` trigger; FKs
   (`work_order_id`, `crew_id`, `class_id`, `entered_by`/`approved_by` to profiles); check `head_count between 1 and 500`.
   Index `(work_order_id, work_date)`. RLS enable + force.
2. Policies (all `(select ...)`-wrapped helpers, all with `(select public.is_active_member())`, 0203): select for
   Admin/Executive/Project Manager/Finance, or the crew's field controller; restrictive `light_account_deny_select`
   (the 2711(b) rule, same form as its sibling tables). `revoke all ... from public, anon, authenticated; grant select to authenticated; grant all to service_role`.
3. RPCs (definer, `search_path = public, pg_temp`; first statements `perform public.assert_not_light(); perform
   public.assert_is_active_member();` which satisfies 2711(a) and 0173):
   - `record_headcount_day(p_work_order_id, p_crew_id, p_work_date, p_class_id, p_count) returns uuid`: org checks, crew
     rostered on the WO that date (`work_order_crews` window), class not archived, `attendance_can_record(p_crew_id)`,
     date window from `organizations.attendance_backdate_days` and `equipment_org_today`, count bounds, refuses an
     approved line (`HC_LOCKED`), upsert, appends the caller to `recorded_by_ids`, `log_audit`.
   - `approve_headcount_day(p_id) returns void`: role Admin/Executive/Project Manager (`crew_can_manage()`), caller not in
     `recorded_by_ids` (SoD, checked before role, as `attendance_decide_week`), sets approved and locked, `log_audit`.
   - `clear_headcount_day(p_id) returns void`: `attendance_can_record(crew)`, unapproved only.
   Messages `HC_*`: `HC_CREW_NOT_ROSTERED`, `HC_DATE_FUTURE`, `HC_DATE_OLD`, `HC_COUNT`, `HC_LOCKED`, `HC_CLASS`.
   `grant execute ... to authenticated`; list the three in `supabase/tests/inventory/anon-executable-definers/guard-headcount.txt`.
4. Rollback drops the three RPCs and the table (data loss stated in the header).

### T3 migration `<R>_headcount_cost.sql` (+ rollback), number from the orchestrator
1. Restate **`labour_cost_class_lines(uuid)`** from head (1721 body): add `union all` branch
   `select 'headcount_day', h.id, h.work_order_id, c.discipline_id, h.work_date, h.class_id, h.head_count * r.day_hours,
   'hours', round(h.head_count * case r.basis when 'daily' then r.amount when 'hourly' then r.amount * r.day_hours
   else r.amount / r.month_hours * r.day_hours end, 2), null::uuid` from `headcount_days h` joined to the lateral
   `labour_class_rate_for(org.id, h.class_id, h.work_date)`, `where h.approved_at is not null and h.org_id = org.id and
   h.work_order_id in (select id from work_orders where project_id = p_project_id) and public.labour_cost_enabled(org.id)`;
   plus the unpriced arm (no rate in force: class null amount null row, class kept in `class_id`).
   Header `-- drops: none`; keeps the 1721 branch verbatim.
2. Restate **`labour_class_locked(uuid,text,uuid,date)`** from head (1720): add an arm so kinds `rate` and `class` also
   count an approved head-count line `work_date >= p_from` priced now by that rate/class. Kinds `assignment`, `worker`
   unchanged. Independent of the switch.
3. Rollback restores both bodies from head text taken before the migration.

### T4 generated types `pmo-portal/src/lib/supabase/database.types.ts` (hand edit)
`headcount_days` Row/Insert/Update/Relationships (named FK constraints), Functions `record_headcount_day`,
`approve_headcount_day`, `clear_headcount_day`. No casts; `check:typed-dals` 0.

### T5 data layer and parse (vitest first)
- `pmo-portal/src/lib/db/workOrderFinance.ts` and `pmo-portal/src/lib/db/workOrderCosts.ts`: add `headcount_day` to
  `SOURCES` and the labour aggregation test (`reason === 'counted'`); `pmo-portal/src/lib/workOrderPlanVsActual.ts`:
  `FinanceCostSource` += `headcount_day`; crew hours, labour by class read it. Tests: `workOrderFinance.test.ts`,
  `workOrderLabourCost.test.ts` (AC-HC-010).
- NEW `pmo-portal/src/lib/db/headcount.ts` (list by work order and date range, record, approve, clear), repository
  `src/lib/repositories/headcount.ts`, hook `src/hooks/useHeadcount.ts`. List read uses explicit table columns, no embeds.
- `can()` in `src/auth/policy.ts`: `record`/`approve` on `headcount` mirrors the DB (UX only).

### T6 screen (restructure skill; DESIGN.md tokens; shared primitives; 390 px and 1440 px)
- NEW `pmo-portal/pages/crews/HeadCountSection.tsx`, rendered by `AttendanceTick.tsx` below the roster for the chosen
  work order and date: one row per class (class select from the class list, number field, replace on save), the named
  present count beside it, approve/clear actions, empty state "No head count entered for this day. Admin, Executive or
  the project manager adds it here; guards and helpers with no name on the roster are counted here, not both."
  Disabled approve says "A different approver must approve this line."
- Strings EN + ID: `public/locales/{en,id}/crews.json` (`headCount.*`), `workOrderPva.json` (`source.headcount_day`:
  "Head count" / "Jumlah orang"), `workOrders.json` (`costs.headcountLabel`), `refusals.json` and `src/lib/refusals.ts`
  for every `HC_*` code and `LCM_RATE_LOCKED` when met from a head-count line.
- Tests: `pages/crews/HeadCountSection.test.tsx`; e2e `pmo-portal/e2e/serial/AC-HC-011-headcount-day.spec.ts` after
  `AC-NLL-014-crew-member-class.spec.ts` (Engineer-foreman enters, Admin approves, Finance sees the cost).

### T7 docs
`docs/glossary.md`: Head-count line, Daily equivalent. Roadmap and the labour-cost spec "stacking" line gets a pointer.

## Traceability
| AC | Owning test |
|---|---|
| AC-HC-001..004, 008, 009 | `supabase/tests/<R>_headcount_cost.test.sql` |
| AC-HC-005..007 | `supabase/tests/1710_headcount_days.test.sql` |
| AC-HC-010 | `workOrderFinance.test.ts`, `workOrderLabourCost.test.ts` |
| AC-HC-011 | `HeadCountSection.test.tsx` + `e2e/serial/AC-HC-011-headcount-day.spec.ts` |
| AC-HC-012 | `2711`, `0173`, `0203` (unchanged files, must stay green) + `check:anon-definer-inventory` |
Regression guards that stay green: the NLL tests (`1720`, `1721`), `1251`, `1255`, `1298`, `1299`, `attendance_days`.

## Mutation checks
As spec section 5, M1..M7, run by the wave run (edit, chained `db reset && test db <file>`, expect `not ok` on the named
AC, restore, reset).

## Local gates (builder)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`,
`npx vitest related --run <changed source files>` + touched tests.
