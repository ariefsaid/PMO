# Plan: idle hours turned into cost per work order (#2673)

Spec `docs/specs/idle-hours-cost.spec.md`. Branch `feat/2673-idle-hours-cost`, stacked on #2670. Test-first.
DB and e2e are written but not run by the builder (Director gate change); the orchestrator runs them per wave.

## Reuse
`dsr_idle_periods` / `dsr_idle_reasons` / `daily_site_reports` (1040); `work_order_cost_amounts` (1252) for priced hours and
amounts; `labour_cost_enabled(org)` (1250); labour cost Administration section (#2670); `workOrderPlanVsActual.ts`,
`PlanVsActualSection.tsx`; `src/lib/db/labourCost.ts` as the DAL pattern.

## Migrations (each with `supabase/migrations/rollback/<n>_*_down.sql`)
- **1255_idle_cost_settings.sql**: `idle_cost_settings` (org_id pk default `auth_org_id()`, enabled default false,
  updated_at/by); RLS enabled+forced, select by active member of org `(select ...)` wrapped; no write grant; RPC
  `save_idle_cost_setting(boolean)` definer, Admin/Finance (42501 otherwise); helper `idle_cost_enabled(org)` =
  setting on AND `labour_cost_enabled(org)`.
- **1256_work_order_idle_cost.sql**: `work_order_idle_cost(p_project_id uuid)` definer stable, roles Admin/Executive/Finance/
  Project Manager, project org-checked (P0002), returns empty unless `idle_cost_enabled`; returns work_order_id, reason_id,
  reason_label, minutes, hours, hourly_cost text, amount text, currency, reason (`counted`|`no-rate`). Eligible reports:
  validated, `superseded_at is null`, `archived_at is null`. Hourly cost = sum(amount)/sum(hours) over the work order's
  `counted` timesheet rows from `work_order_cost_amounts`. Revoke from public/anon; grant authenticated.
- Update `pmo-portal/src/lib/supabase/database.types.ts`; add `scripts/isolation-probe-denominator.d/2673-idle-cost.json`
  (1 table, 2 definer functions); run `check-isolation-denominator` (+ its test and self-test).

## Tasks and owning tests
| # | Work | Files | Owning test (AC) |
|---|---|---|---|
| 1 | Setting table, RPC, helper | 1255 + rollback | `supabase/tests/1255_idle_cost.test.sql`: AC-IHC-001, 002, 008 |
| 2 | Idle cost read | 1256 + rollback | same file: AC-IHC-003-007, 009 |
| 3 | Mutation notes (not run by builder) | n/a | break (a) the both-switch gate, (b) the validated-only filter, (c) the Admin/Finance check; each must turn the file red |
| 4 | DAL, repository, hook | `src/lib/db/idleCost.ts`, `src/lib/repositories/idleCost.ts`, `src/hooks/useIdleCost.ts` | vitest `idleCost.test.ts` |
| 5 | Rollup (idle apart from direct cost) | `src/lib/workOrderPlanVsActual.ts` | AC-IHC-010 new cases in `workOrderPlanVsActual.test.ts` |
| 6 | Idle block on work order and project view | `PlanVsActualSection.tsx` (+ small component `IdleCostBlock.tsx`), i18n en + id | AC-IHC-001, 010 vitest; no look-pinning |
| 7 | Switch in Labour cost section | existing Labour cost Administration component, i18n | AC-IHC-011 vitest + `e2e/AC-IHC-011-idle-cost-switch.spec.ts` |
| 8 | Glossary entry, screenshots (orchestrator runs), evidence path `docs/evidence/1215/2673/` | `docs/glossary.md` | n/a |

Gates (builder): `npm run check:guards`, `npm run typecheck`, eslint on changed files, touched vitest files.
