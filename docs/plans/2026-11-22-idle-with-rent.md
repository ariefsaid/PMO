# Plan: idle cost of people and rented equipment (idle-with-rent)

Spec `docs/specs/idle-with-rent.spec.md`. Migrations 1730-1731. Branch `feat/gap-people-idle-with-rent` (from the labour-cost
branch plus land/fix-1122). Do not build until told: the head-count slice (1710-1719) merges first.

## Task 0 (before any code, after the head-count merge)
Read that slice's migration and reader at head. Decide the one join: its daily head-count lines enter `idle_headcount()` as
a second term (dedupe against attendance by worker where it names one). Confirm its priced lines carry person-hours in
`quantity` with unit `hours`; if not, the average-cost CTE must divide by person-hours it defines. Update AC-IWR-013.

## Task 1 - setting, helper (1730_idle_cost_scope.sql)
- `alter table idle_cost_settings add column scope text not null default 'labour_average' check (scope in ('labour_average','people_and_equipment'))`.
- `save_idle_cost_scope(p_scope text)`: SECURITY DEFINER, `labour_cost_gate()` (Admin/Finance, else 42501), 22023 on bad value,
  upsert like `save_idle_cost_setting`. Revoke public/anon, grant authenticated. Add to
  `supabase/tests/inventory/anon-executable-definers/idle-with-rent.txt` and `scripts/isolation-probe-denominator.d/` if the guard asks.
- `idle_headcount_days(p_org, p_project)` set-based (internal; revoked from all client roles; built): distinct present
  workers on `attendance_days`.
- Rollback `supabase/migrations/rollback/1730_idle_cost_scope_down.sql`.
- Test (RED first): `supabase/tests/1730_idle_cost_scope.test.sql` AC-IWR-001 (default), 010 (write refusal), helper count.

## Task 2 - reader (1731_work_order_idle_cost_with_people_equipment.sql)
- `drop function work_order_idle_cost(uuid)` then create with added columns `people_amount text, equipment_amount text,
  headcount_hours text` (return type changes, so no `create or replace`). Body taken from the database at head (read with
  `pg_get_functiondef`), not from 1721; `npm run check:restated-functions` must pass. Re-issue revoke/grant.
- Per-day CTE: idle minutes by (work order, date, reason) from validated, current, non-archived reports; heads from
  `idle_headcount`; people = minutes/60 x heads x WO hourly cost; equipment per day from approved, non-archived standby
  entries joined to `equipment_settings_effective(org, null)` (hire_rate, unit match, window), shared by minutes; round once per reason row.
- Scope `labour_average`: new columns null, `amount` as today. Rollback restores the 1721 body.
- Tests (RED first), `supabase/tests/1731_idle_with_rent.test.sql`: AC-IWR-001..010. Mutation checks 1-7 of the spec, run once each.
- Types: hand-edit `pmo-portal/src/lib/supabase/database.types.ts` (new columns nullable on the reader; `save_idle_cost_scope`).

## Task 3 - data access and refusal
- `pmo-portal/src/lib/db/idleCost.ts`: `IdleCostRow` gains `peopleAmount`, `equipmentAmount`, `headcountHours` (string or null,
  exact-decimal checked); `getIdleCostScope`, `setIdleCostScope`; repository `src/lib/repositories/idleCost.ts` and hook
  `src/hooks/useIdleCost.ts` follow. Test `src/lib/db/idleCost.test.ts` (map, reject malformed, null columns).
- `pmo-portal/src/lib/refusals.ts` + locale files: EN and ID sentence for the scope write refusal.

## Task 4 - UI (restructure skill, DESIGN.md tokens)
- `pages/work-order-detail/IdleCostBlock.tsx`: People and Equipment columns only when rows carry them; one total; reason with
  no rate says so; note text keeps "shown apart, not added to the direct cost". 390 px: columns collapse under the reason row.
  Test AC-IWR-011 in `IdleCostBlock.test.tsx`. AC-IWR-008 is owned by pgTAP in `supabase/tests/1731_idle_with_rent.test.sql`
  (absolute hand-calculated `work_order_cost_amounts` row set and total, both scopes); the plan-versus-actual vitest named in
  an earlier draft was never built and is not the owning layer.
- `pages/admin/IdleCostSwitch.tsx`: "Idle cost covers" select (shared `SelectField`), disabled with a reason for non-managers.
  Test AC-IWR-012. EN+ID in `public/locales/{en,id}/administration.json` and `workOrderPva.json`.
- e2e `pmo-portal/e2e/AC-IWR-012-idle-cost-scope.spec.ts` (follow docs/e2e-parallel-conventions.md); written, not run.

## Task 5 - docs and gates
- `docs/glossary.md`: update "Idle cost"; add "Head count on a day".
- Gates in `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`,
  `npx vitest related --run <changed sources>` + touched tests, `node scripts/anon-definer-inventory.mjs --check`,
  `npm run check:restated-functions`. pgTAP/e2e left for the wave run.

## Traceability
AC-IWR-001,002,003,004,005,006,007,009,010 pgTAP (1730/1731 tests); 008 pgTAP only — `1731_idle_with_rent.test.sql` asserts
the fixture's absolute `work_order_cost_amounts` row set and 2805000.00 total under both scopes (the earlier vitest half was
never built and is not owed); 011 vitest; 012 vitest + e2e; 013 pgTAP after the merge.

Deferred (source review MINOR-1): AC-IWR-005's round-once edge — a standby split that does not divide to the cent — has no
oracle. Adding it re-baselines the existing 300000 equipment total and the 150000 per-reason assertions, so it is recorded
here instead of churned into this slice.
