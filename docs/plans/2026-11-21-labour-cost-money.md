# Plan: labour cost in money per work order (#2670)

Spec `docs/specs/labour-cost-money.spec.md`. Branch `feat/2670-labour-cost-money`. Ships alone (money). Test-first;
each task is red, green, commit, push. DB commands under `PMO_DB_LOCK=/tmp/db.lock`, reset+test in one hold.

## Reuse
`work_order_cost_amounts` wrapper (1113) over `_unrounded` (0999) and `_unpriced` (1115, timesheet `no-rate`);
`org_terminology` (1024) RLS/stamp pattern; `stamp_org_id()`; `workOrderPlanVsActual.ts` `rollupProject`;
`PlanVsActualSection.tsx` / `WorkOrderPlanVsActual.tsx`; Administration sections (`/administration/:section`).

## Migrations (each with `supabase/migrations/rollback/<n>_*_down.sql`)
- **1250_labour_cost_settings.sql**: tables `labour_cost_settings` (org_id pk, enabled, updated_by/at), `labour_cost_classes`
  (id, org_id, code, name, archived_at; unique org+code), `labour_cost_rates` (id, org_id, subject_kind person|role,
  person_id, role_key text, class_id, basis, amount numeric(14,2), overtime_multiplier, day_hours, month_hours,
  effective_from, effective_to, archived_at, created_by; shape check person xor role; unique org+subject+effective_from
  among live rows). RLS enabled and forced, helpers wrapped `(select ...)`, `stamp_org_id` triggers. Reads: settings and
  classes every active member; rates Admin/Finance/Executive. No direct write grants on rates/settings; classes
  insert/update Admin/Finance. RPCs (security definer, Admin/Finance, org-scoped): `save_labour_cost_settings(boolean)`
  (seeds default classes first time), `save_labour_cost_rate(jsonb)`, `end_labour_cost_rate(uuid, date)`,
  `archive_labour_cost_rate(uuid)`; helper `labour_rate_for(org, person, date)` (person over role, latest start) and the
  lock check (`LCM_RATE_LOCKED`, errcode 23514).
- **1251_labour_cost_pricing.sql**: `labour_cost_priced_lines(p_project uuid)` (definer, internal; revoked from clients):
  Approved lines of the project, day window sum per person across projects for overtime, hourly equivalent, rounding;
  returns entry id, class id, amount, hours, rate found.
- **1252_work_order_cost_amounts_labour.sql**: rename the 1113 wrapper to `work_order_cost_amounts_pre_labour`; new
  `work_order_cost_amounts(uuid)` returns the old columns plus `labour_class_id uuid`; when the switch is off it returns
  the old rows with a null class; when on, the `timesheet_entry` rows that are priced become reason `counted` with currency,
  amount and class (person nulled for Project Manager). Same grants/gate as before.
- **1253** and **1254**: reserved (not used unless the build needs a fix-up migration).
- Update `pmo-portal/src/lib/supabase/database.types.ts` and add `scripts/isolation-probe-denominator.d/2670-labour-cost.json`
  (3 tables, definer functions); run `node scripts/check-isolation-denominator.mjs` + `--self-test`.

## Tasks and owning tests
| # | Work | Files | Owning test (AC) |
|---|---|---|---|
| 1 | Tables, RLS, RPCs, seed, lock rule | 1250 + rollback | `supabase/tests/1250_labour_cost_rates.test.sql`: AC-LCM-003, 012, 013, 014, 016 |
| 2 | Pricing and wrapper | 1251, 1252 + rollbacks | `supabase/tests/1251_labour_cost_amounts.test.sql`: AC-LCM-001, 002, 004-011, 015 |
| 3 | Mutation checks | n/a | break (a) the person-over-role order, (b) the lock rule, (c) the switch test; each pgTAP file must go red; restore green; quote lines |
| 4 | DAL + repository | `src/lib/db/labourCost.ts`, `src/lib/repositories/labourCost.ts`, hooks `src/hooks/useLabourCost.ts`, `can()` entry `labourCost` in `src/auth/policy.ts` | vitest `labourCost.test.ts`, policy test |
| 5 | Rollup by class | `src/lib/workOrderPlanVsActual.ts` (`CostAmountLine.labourClassId`, `WorkOrderFigures.labour[]`), `src/lib/db/workOrderFinance.ts` mapping | AC-LCM-011, 017 in `workOrderPlanVsActual.test.ts` (new cases only) |
| 6 | Administration "Labour cost" section | `pages/administration/LabourCost*.tsx`, route in `App.tsx`, locale files `en` and `id` (new namespace `labourCost`) | AC-LCM-018 vitest + `e2e/AC-LCM-018-labour-cost-rates.spec.ts` |
| 7 | Plan-vs-actual labour block | `pages/work-order-detail/PlanVsActualSection.tsx`, `pages/project-detail/WorkOrderPlanVsActual.tsx` (render only when switch on and priced labour exists) | AC-LCM-001, 019 vitest; screenshots `docs/evidence/1215/2670/` |
| 8 | Glossary, ADR-0105 "labour cost is internal costing", decisions note | `docs/glossary.md`, `docs/adr/` | n/a |

## Gates (quote result lines)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`;
DB one hold: reset + 1250, 1251 + 0178 anon_executable_definers + 0178 m365_member_gate + 0646 rls_initplan + the existing
0997 and 1115 files (must stay green untouched); isolation denominator test and self-test; touched e2e via `scripts/e2e-local.sh`.
