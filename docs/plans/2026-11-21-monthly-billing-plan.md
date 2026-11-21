# Plan: Monthly billing plan (#2682)

Spec `docs/specs/monthly-billing-plan.spec.md`. Test-first; each step names its failing test first. Gates per `docs/cloud-session-rules.md` (shared DB: reset + own pgTAP in one lock hold).

## Tasks
1. **pgTAP red, settings** `supabase/tests/1375_billing_plan_settings.test.sql`: AC-MBP-006..009. Then migration `supabase/migrations/1375_billing_plan_settings.sql` (tables `org_billing_plan_settings`, `billing_plan_month_targets`; RLS enabled+forced, select for the four roles via `(select auth_role())`, no write grants; definers `set_billing_plan_settings(numeric,text,boolean)`, `set_billing_plan_month_target(date,numeric)`, Admin/Finance, `revoke all ... from public, anon`; grant execute to authenticated) and `supabase/migrations/rollback/1375_billing_plan_settings_down.sql`.
2. **pgTAP red, candidates** `supabase/tests/1376_billing_plan_candidates.test.sql`: AC-MBP-001..005 (parity with `get_project_billing` and `work_order_billing`). Then `supabase/migrations/1376_billing_plan_candidates_read.sql` (security invoker; lateral over `get_project_billing` for projects with a confirmed acceptance; union money-only orders from `work_order_billing`; 501 cap; `accepted_on` from `work_order_acceptances`) and its rollback.
3. **Isolation**: `scripts/isolation-probe-denominator.d/2682-monthly-billing-plan.json` (two tables, two definers); anon-definer inventory entries; run `node scripts/check-isolation-denominator.mjs` and `--self-test`.
4. **Unit red** `pmo-portal/src/lib/billingPlan.test.ts` (AC-MBP-010..012), then `pmo-portal/src/lib/billingPlan.ts` (cents arithmetic via `progressBilling` helpers, `remainingQuantity` reuse).
5. **Data layer**: `src/lib/db/billingPlan.ts` (+ test), repository entry in `src/lib/repositories`, hooks `useBillingPlanCandidates`, `useBillingPlanSettings`, `useSaveBillingPlanSettings`; permission `billingPlanSettings` in `src/auth/policy.ts` (Admin, Finance).
6. **RTL red** `pmo-portal/pages/BillingPlan.test.tsx` (AC-MBP-013..016) and Receivables link test file new (AC-MBP-017, existing Receivables tests untouched); then `pages/BillingPlan.tsx` (read `.claude/skills/restructure/SKILL.md` first), `BillingPlanLink`, settings modal on `EntityFormModal`, route `/finance/billing-plan` in `App.tsx`, strings en + id.
7. **e2e** `pmo-portal/e2e/AC-MBP-018-monthly-billing-plan.spec.ts` with isolation tag per `docs/e2e-parallel-conventions.md`.
8. **Docs**: `docs/glossary.md` (Candidate, Monthly target, Plan), spec status, `docs/decisions.md` pointer.

## Traceability
| AC | Test file | Layer |
|---|---|---|
| AC-MBP-001..005 | `supabase/tests/1376_billing_plan_candidates.test.sql` | pgTAP |
| AC-MBP-006..009 | `supabase/tests/1375_billing_plan_settings.test.sql` | pgTAP |
| AC-MBP-010..012 | `pmo-portal/src/lib/billingPlan.test.ts` | unit |
| AC-MBP-013..016 | `pmo-portal/pages/BillingPlan.test.tsx` | unit (RTL) |
| AC-MBP-017 | `pmo-portal/pages/finance/BillingPlanLink.test.tsx` | unit (RTL) |
| AC-MBP-018 | `pmo-portal/e2e/AC-MBP-018-monthly-billing-plan.spec.ts` | e2e |

## Mutation checks (money-path rules)
Settings writer: change the role check to allow any member, AC-MBP-006 must go red. Candidates: drop the `accepted > claimed` condition, AC-MBP-003 must go red.

## Seams left for #2675
Read returns `accepted_on`; settings row holds the reminder switch; page has an empty age-cell slot in the line row and the summary has room for one information line.
