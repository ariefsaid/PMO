# Plan: Billed per month (spec `docs/specs/billed-per-month.spec.md`)

Test-first. One migration (1790) only because the view lacks the date; no table, no function, no grant.

## Tasks
1. **pgTAP red** `supabase/tests/1790_billed_on_month.test.sql` (AC-BPM-001..003; model fixtures on `supabase/tests/0262_work_order_billing_figures.test.sql`). Then `supabase/migrations/1790_work_order_billing_lines_billed_on.sql`: `create or replace view public.work_order_billing_lines with (security_invoker = true)` = body of the latest definition (`supabase/migrations/1046_opening_balances.sql` section 6, highest number; orchestrator confirms with `pg_get_viewdef`) plus a trailing `billed_on date`: invoice branch `w.invoice_date`; claim branch `(pc.created_at at time zone coalesce((select o.default_timezone from public.organizations o where o.id = pc.org_id), 'UTC'))::date`; opening branch `ob.as_of`. Keep grants (`revoke all ... ; grant select ... to authenticated`). Rollback `supabase/migrations/rollback/1790_work_order_billing_lines_billed_on_down.sql` restores the 1046 body (drop view and recreate, since a column cannot be removed by `create or replace`; recreate dependent `work_order_billing` is NOT needed only if it does not depend on column order: `work_order_billing` selects named columns, so `drop view ... cascade` is avoided by `create or replace` with the same columns order in the down file and a drop+recreate of both views in one transaction). `npm run check:restated-functions` must pass.
2. **Types** `pmo-portal/src/lib/supabase/database.types.ts`: add `billed_on: string | null` to `work_order_billing_lines.Row` (alphabetical, mirror generated style).
3. **Unit red** `pmo-portal/src/lib/billedByMonth.test.ts` (AC-BPM-004), then `pmo-portal/src/lib/billedByMonth.ts`: pure grouping in integer cents (helpers as `billingPlan.ts`/`progressBilling.ts`), no money rule of its own.
4. **Data layer**: `listWorkOrderBilledLines(workOrderId)` in `pmo-portal/src/lib/db/workOrderBilling.ts` (+ test in `workOrderBilling.test.ts`): paged with `fetchAllPages`, `.select('record_id, billed, currency, billed_on')`, ordered by `record_id`, malformed month/amount is an error, never zero; repository entry `billedLines` in `src/lib/repositories/workOrders.ts` and the contract `src/lib/repositories/contracts/workOrders.ts`; hook `useWorkOrderBilledLines` in `src/hooks/useWorkOrderBilling.ts` (key under `'work-order-billing'` so existing billing invalidation refreshes it; enabled only with `canBilling`).
5. **RTL red** `pmo-portal/pages/work-order-detail/BillingSection.test.tsx` (new; AC-BPM-005/006), then extend `BillingSection.tsx` with a "Billed per month" block (stacked rows, tokens, loading/error/empty states, no new gate) and pass the query from `pages/WorkOrderDetail.tsx` (same `canBilling` gate). Read `.claude/skills/restructure/SKILL.md` first.
6. **Strings** `pmo-portal/public/locales/en/workOrders.json` and `id/workOrders.json` (`billing.perMonth.*`); locale parity guard.
7. **e2e** `pmo-portal/e2e/AC-BPM-008-billed-per-month.spec.ts` (isolation tag per `docs/e2e-parallel-conventions.md`).
8. **Docs**: `docs/glossary.md` (Billed month, No invoice date); spec status.

## Traceability
| AC | Test file | Layer |
|---|---|---|
| AC-BPM-001..003 | `supabase/tests/1790_billed_on_month.test.sql` | pgTAP |
| AC-BPM-004 | `pmo-portal/src/lib/billedByMonth.test.ts` | unit |
| AC-BPM-005, 006 | `pmo-portal/pages/work-order-detail/BillingSection.test.tsx` | unit (RTL) |
| AC-BPM-007 | locale parity guard + screenshots | unit + capture |
| AC-BPM-008 | `pmo-portal/e2e/AC-BPM-008-billed-per-month.spec.ts` | e2e |

## Screenshots for the orchestrator
`/work-orders/:id` as Finance at 390 px and 1440 px: billing in two months; one currency-mixed or un-totalled month; nothing billed; read error.
