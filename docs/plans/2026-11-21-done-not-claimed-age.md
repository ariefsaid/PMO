# Plan: Done but not yet claimed, age on the billing plan (#2675)

Spec `docs/specs/done-not-claimed-age.spec.md`. Test-first; each step names its failing test first. Migrations **1380, 1381 only**, each with a rollback in `supabase/migrations/rollback/`.

## Tasks
1. **Unit red** `pmo-portal/src/lib/billingPlan.test.ts` (AC-DNC-001/002, added cases only, existing untouched), then pure `doneNotClaimedAge` and `isOverLimit` in `pmo-portal/src/lib/billingPlan.ts` (or a new `doneNotClaimedAge.ts` if the file gets crowded).
2. **pgTAP red, setting** `supabase/tests/1380_done_not_claimed_setting.test.sql`: AC-DNC-006/007/011. Then `supabase/migrations/1380_done_not_claimed_setting.sql`: column `org_billing_plan_settings.done_not_claimed_after_days integer check (null or between 1 and 3650)` (no default); table `done_not_claimed_notices` (org_id, work_order_id, boq_item_id null, notified_at; unique index on org, work order, `coalesce(boq_item_id, zero uuid)`; RLS enabled and forced, `(select auth_org_id())`, restrictive role scope for the four money roles, select only); definer `set_billing_plan_reminder(boolean, integer)` (Admin/Finance, `assert_is_active_member`, revoke from public/anon). Rollback `rollback/1380_done_not_claimed_setting_down.sql`.
3. **pgTAP red, job** `supabase/tests/1381_done_not_claimed_job.test.sql`: AC-DNC-008/009/010. Then `supabase/migrations/1381_done_not_claimed_job.sql`: `notify_done_not_claimed()` (definer, `set search_path = public, pg_temp`, revoked from public/anon/authenticated, shape of 1363: per-org loop, `get_project_billing` lateral for projects with a confirmed acceptance, `work_order_billing` for money-only orders, `native_org_today`, stamp insert `on conflict do nothing` then `notify_workflow_user` to active Finance users, `log_audit`), and `cron.schedule('done-not-claimed', '23 1 * * *', ...)`. Rollback unschedules and drops.
4. **Guards**: `scripts/isolation-probe-denominator.d/2675-done-not-claimed-age.json` (table and the two definers), anon-definer inventory entries, `docs/retention.md` row `done-not-claimed`; run `npm run check:guards`.
5. **Data layer**: extend `src/lib/db/billingPlan.ts` (+ test): settings read returns `done_not_claimed_after_days`; new `saveBillingPlanReminder`; repository entry and hook `useSaveBillingPlanReminder`; `database.types.ts` entries by hand if the generator cannot run.
6. **RTL red** in `pmo-portal/pages/BillingPlan.test.tsx` (new cases only): AC-DNC-003/004/005; then fill the `billing-plan-age-slot` in `pages/BillingPlan.tsx`, the over-limit highlight and summary count, the day-limit field in the Plan settings form. Read `.claude/skills/restructure/SKILL.md` first. EN and ID strings.
7. **e2e** AC-DNC-012 in the existing plan serial spec lane (`pmo-portal/e2e/serial/AC-DNC-012-done-not-claimed-age.spec.ts`, isolation tag per `docs/e2e-parallel-conventions.md`).
8. **Docs**: spec status, `docs/glossary.md` (Age, Alert), pointer from the plan spec's seam note.

## Traceability
| AC | Test file | Layer |
|---|---|---|
| AC-DNC-001/002 | `pmo-portal/src/lib/billingPlan.test.ts` | unit |
| AC-DNC-003..005 | `pmo-portal/pages/BillingPlan.test.tsx` | unit (RTL) |
| AC-DNC-006/007/011 | `supabase/tests/1380_done_not_claimed_setting.test.sql` | pgTAP |
| AC-DNC-008..010 | `supabase/tests/1381_done_not_claimed_job.test.sql` | pgTAP |
| AC-DNC-012 | `pmo-portal/e2e/serial/AC-DNC-012-done-not-claimed-age.spec.ts` | e2e |

## Mutation checks
Setter: allow any member, AC-DNC-006 red. Job: drop the reminder-on filter, AC-DNC-008 red; drop the stamp, AC-DNC-009 red; drop the org filter, AC-DNC-010 red.
