# Work-order revenue plan: implementation plan (#2671)

Spec: `docs/specs/work-order-revenue-plan.spec.md`. Migrations: **1275, 1276, 1277** (range 1275-1279), each with `supabase/migrations/rollback/<n>_..._down.sql`.
No ADR (additive tables and reads; no irreversible or cross-cutting choice). Glossary: add Revenue plan, Plan to date, Gap, Working weekdays.

## Slices (test first, commit and push after each)

**S1 Schema and settings, `1275_work_order_revenue_plan.sql`.** Tables `org_revenue_plan_settings(org_id pk, enabled default false, working_weekdays smallint[] default '{1,2,3,4,5}', updated_by, updated_at)`,
`work_order_revenue_plan(id, org_id, project_id, work_order_id, plan_date, amount numeric check shape, source 'date'|'month', month_key date null, created_by/at, updated_by/at; unique (work_order_id, plan_date))`,
`work_order_revenue_plan_audit(id, org_id, work_order_id, plan_date, old_amount, new_amount, actor_id, at)`.
RLS on all three: SELECT `org_id = (select auth_org_id())` and `(select dsr_may_see_revenue(project_id))` for plan rows; grants SELECT only; org stamped by `stamp_org_id`. Setting write via RPC `set_revenue_plan_settings(enabled, weekdays)` (Admin only, weekdays 1..7 distinct, 1 to 7 entries).
Test `supabase/tests/1275_work_order_revenue_plan.test.sql` (AC-WRP-001..006, 012). Isolation denominator fragment `scripts/isolation-probe-denominator.d/2671-work-order-revenue-plan.json` (3 tables, every definer function).

**S2 Write RPCs, `1276_work_order_revenue_plan_writes.sql`.** `wo_revenue_plan_set_day(wo, date, amount)`, `wo_revenue_plan_set_month(wo, month, amount, keep_edited boolean)` (largest-remainder cents over working days, earliest dates take extra cent), `wo_revenue_plan_clear(wo, from, to)`.
All `security definer set search_path = public, pg_temp`, `revoke ... from public, anon`, grant authenticated; role check (Admin, Executive, Finance, project's PM), setting-on check, frozen-status check, audit row. Same pgTAP file as S1 plus mutation check (a).

**S3 Read RPCs, `1277_work_order_revenue_plan_reads.sql`.** `wo_revenue_plan_vs_actual(wo, as_of, from, to)` (summary plus date series) and `project_revenue_plan_vs_actual(project, as_of)` (per work order + per-currency totals). Gate with `dsr_may_see_revenue`; actual = validated, `superseded_at is null`, `archived_at is null`, summed from `dsr_progress_lines.frozen_amount` by `work_date`; not-yet-validated count from `submitted`. Setting off returns no rows.
Test `supabase/tests/1276_work_order_revenue_plan_reads.test.sql` (AC-WRP-007..010) + mutation check (b).

**S4 DAL, repository, derivation (Unit).** `pmo-portal/src/lib/db/workOrderRevenuePlan.ts` (+ test), repository entry in `src/lib/repositories/` per ADR-0017, hooks `src/hooks/useWorkOrderRevenuePlan.ts`; pure `src/lib/revenuePlan.ts` (gap wording, per-currency totals, cumulative series with exact decimals). Tests AC-WRP-008..011.

**S5 Work-order section.** `pmo-portal/pages/work-order-detail/RevenuePlanSection.tsx` (+ test), mounted in `pmo-portal/pages/WorkOrderDetail.tsx` only when the setting is on and the caller can see revenue (`can()` + the read). Entry form with `EntityFormModal`/`useEntityForm`/`TextField`; chart with recharts per DESIGN.md. Admin setting control on the existing organisation settings page (find via `scripts/prior-art.sh`).

**S6 Project roll-up.** `pmo-portal/pages/project-detail/RevenuePlanRollup.tsx` (+ test) in the project's work-order area.

**S7 Strings and evidence.** English and Bahasa Indonesia namespace `workOrderRevenuePlan` in `pmo-portal/public/locales/{en,id}/`; screenshots at 390 and 1440 px (scale 2) in `docs/evidence/1215/2671/`; `scripts/ux-proof.sh` on touched routes; glossary entries.

**S8 E2E.** `pmo-portal/e2e/AC-WRP-013-revenue-plan.spec.ts` via `scripts/e2e-local.sh`, isolation class per `docs/e2e-parallel-conventions.md`.

## AC ownership
| AC | Owner layer / file |
|---|---|
| AC-WRP-001 | pgTAP 1275 (+ Unit section hidden) |
| AC-WRP-002..006, 012 | pgTAP 1275 |
| AC-WRP-007, 008, 009, 010 | pgTAP 1276 (+ Unit for wording, restricted, currencies) |
| AC-WRP-011, 014 | Unit |
| AC-WRP-013 | E2E |

## Gates (quote result lines)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`; DB in one lock hold: reset + 1275 + 1276 + 0178 (two files) + 0646; `node --test scripts/check-isolation-denominator.test.mjs`; `node scripts/check-isolation-denominator.mjs --self-test`; touched e2e.
