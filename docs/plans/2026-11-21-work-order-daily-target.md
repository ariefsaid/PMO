# Work-order daily target: implementation plan (#2672)

Spec: `docs/specs/work-order-daily-target.spec.md`. Stacked on #2671. Migrations: **1280, 1281, 1282** (range 1280-1284), each with `supabase/migrations/rollback/<n>_..._down.sql`.
#2671's migrations (1275-1277) are not edited. No ADR (additive list and reads; the one-record choice is recorded in the spec). Glossary: Daily target, Non-working date, Month to date, Projection to month end.
Gate change (Director): no db reset, pgTAP, e2e, screenshots or mutation runs at build; write those tests and list the mutation plan in the report.

## Slices (test first, commit and push after each)
**S1 `1280_non_working_dates.sql`.** Table `org_non_working_dates(org_id default coalesce(auth_org_id(),...), work_date date check 2000..2100, label text check <=80, created_by, created_at; primary key (org_id, work_date))`, RLS SELECT `org_id = (select auth_org_id())`, grants SELECT only, `stamp_org_id` trigger. RPCs `non_working_date_add(date, label)` (idempotent upsert) and `non_working_date_remove(date)`: security definer, `set search_path = public, pg_temp`, Admin only, setting-on check, audit via `log_audit`, revoke from public/anon. `create or replace function org_is_working_day` = the #2671 body AND not exists in the list (same signature, same revokes). Test `supabase/tests/1280_non_working_dates.test.sql` (AC-WDT-001..004, 011). Isolation fragment `scripts/isolation-probe-denominator.d/2672-work-order-daily-target.json` (1 table, every definer function incl. 1281/1282).

**S2 `1281_work_order_daily_target_reads.sql`.** `wo_daily_target_vs_actual(p_work_order, p_as_of default null)` returns jsonb `{as_of, month, month_target, mtd_target, mtd_actual, mtd_gap, projection, projected_gap, elapsed_working_days, remaining_working_days, days:[{date, working, non_working_label, target, actual, gap, has_target, pending_reports}]}`. Gate order as `wo_revenue_plan_vs_actual`: active member, own org, `dsr_may_see_revenue` (42501 WRP_ROLE), `revenue_plan_enabled` else null. Actual from the same filter as `wrp_figures` by `work_date`. Integer-cent arithmetic for the projection (round half up at the end). Test `supabase/tests/1281_work_order_daily_target_reads.test.sql` (AC-WDT-005..007, 009).

**S3 `1282_project_daily_target_rollup.sql`.** `project_daily_target_vs_actual(p_project, p_as_of default null)`: per work order MTD target, MTD actual, projection, plus totals per currency (never blended). Same gate. Cases added to the 1281 file (AC-WDT-010).

**S4 DAL, repository, derivation (Unit).** Extend `pmo-portal/src/lib/db/workOrderRevenuePlan.ts` (+ test) with the two reads and the list calls; repository entries (ADR-0017); hooks in `src/hooks/useWorkOrderRevenuePlan.ts`; pure additions to `src/lib/revenuePlan.ts` (behind-target wording, restricted, per-currency totals, non-working marker). Tests AC-WDT-008, 010, 012.

**S5 Work-order Daily target view.** `pmo-portal/pages/work-order-detail/DailyTargetView.tsx` (+ test) inside the #2671 `RevenuePlanSection`; phone list / desktop table + recharts day bars; reuse the existing entry form. Read `.claude/skills/restructure/SKILL.md` and `DESIGN.md` first.

**S6 Project roll-up columns.** Extend `pmo-portal/pages/project-detail/RevenuePlanRollup.tsx` (+ test) with MTD target, MTD actual, projection.

**S7 Non-working dates editor.** `pmo-portal/pages/admin/NonWorkingDatesCard.tsx` (+ test) beside the #2671 switch on the Administration > Projects card (locate via `scripts/prior-art.sh`); `can()`-gated Admin; shared form primitives; `ConfirmDialog` on remove.

**S8 Strings, evidence, glossary.** Namespace `workOrderDailyTarget` in `pmo-portal/public/locales/{en,id}/`; AC-WDT-013 unit test; screenshots 390 and 1440 px (scale 2) in `docs/evidence/1215/2672/` (written to run; per the gate change, not captured at build unless the orchestrator says so); glossary entries.

**S9 E2E (written, not run).** `pmo-portal/e2e/serial/AC-WDT-014-daily-target.spec.ts` (serial: switches the org-wide setting), isolation class per `docs/e2e-parallel-conventions.md`.

## AC ownership
| AC | Owner layer / file |
|---|---|
| AC-WDT-001, 002, 003, 004, 011 | pgTAP 1280 (001 also Unit: section hidden) |
| AC-WDT-005, 006, 007, 009 | pgTAP 1281 (009 also Unit) |
| AC-WDT-010 | pgTAP 1281 + Unit |
| AC-WDT-008, 012, 013 | Unit |
| AC-WDT-014 | E2E |

## Build-time gates (per the gate change)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`, `node --test scripts/check-isolation-denominator.test.mjs`, `node scripts/check-isolation-denominator.mjs --self-test`. pgTAP, e2e, mutation checks (a)(b)(c) from the spec are written and listed, run by the orchestrator.
