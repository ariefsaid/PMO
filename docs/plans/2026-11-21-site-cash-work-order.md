# Plan — site cash and expense claims carry a work order (#2732)

Spec: `docs/specs/site-cash-work-order.spec.md` · branch `feat/2732-site-cash-work-order` · migrations 1260-1264 only.
Money path: ships alone. Reuses ADR-0104 wholesale; ADR only if the owner wants DD-SCWO-4 recorded (a short addendum to 0104).

## Migrations (each with `supabase/migrations/rollback/<n>_..._down.sql`)
1. `1260_expense_claim_cost_attribution.sql` - two nullable columns + partial indexes on `expense_claims`; extend
   `check_cost_attribution()` (claim branch: project = `new.project_id`; kind `advance` raises `COST_ADVANCE`) and attach
   the trigger (`zz_cost_attribution_check`); exempt attribution-only updates in `assert_expense_claim_update` (0247, keep
   body verbatim + one branch); project-move guard on `expense_claims`; `record_history_config` captures the fields.
2. `1261_set_cost_attribution_expense_claim.sql` - `set_cost_attribution` re-created from 0951 (keep every branch) plus
   source `expense_claim`; who-may per DD-SCWO-3; audit row per record.
3. `1262_work_order_cost_lines_expense_claim.sql` - view re-created from 1037's body plus the claim branch (kind claim).
4. `1263_work_order_cost_amounts_expense_claims.sql` - `work_order_cost_amounts_unrounded` (the 0999 body, as renamed by
   1113) gains the claim rows (DD-SCWO-4: PMO mode additive; ledger mode carved out of `project_actuals` only when the
   approval posting is `pushed`); `unpriced` adds the not-posted claim rows. 1113's rounding wrapper is untouched.
5. `1264` reserved (regenerated types or a fix; unused if not needed).
Isolation denominator: no new table/RPC (the view and RPCs exist); run `node scripts/check-isolation-denominator.mjs` and add
nothing unless it demands it. `database.types.ts`: add the two columns (hand edit, as 0951 did).

## Seam and screens (pmo-portal/)
- `src/lib/db/workOrderCosts.ts`: add `expense_claim` to `CostSource`, `COST_SOURCES`, the line mapper.
- `src/lib/db/expenses.ts` + `src/lib/repositories/expenses.ts`: carry attribution; after create call
  `workOrderCostRepository.attributeOrRefuse('expense_claim', created, attribution)`.
- `pages/expenses/ExpenseClaimFormModal.tsx`: render `CostAttributionFields` once a project is chosen (kind claim only; hidden
  for advances); form state, "saved, but" handling via `AttributionRefusedError`.
- `pages/ExpenseClaimDetail.tsx`: show and correct attribution (`can()`-gated, same roles as 0951).
- `src/lib/workOrderPlanVsActual.ts`: treat `expense_claim` lines as direct cost; no change to the shared-cost maths.
- Strings: `public/locales/{en,id}/costAttribution.json` (source label) and `expenses` strings. Work-order cost-line list
  (`pages/work-order-detail`): source label for claims.
- Screenshots (phone 390, desktop 1440, dsf 2) of the claim form and claim detail -> `docs/evidence/1215/2732/`.

## Traceability (test-first; owner of each AC)
| AC | Owning test |
|---|---|
| AC-SCWO-001..009, 012, 014 | pgTAP `supabase/tests/1260_site_cash_work_order.test.sql` |
| AC-SCWO-010 | `src/lib/workOrderPlanVsActual.test.ts` (+ pgTAP 009) |
| AC-SCWO-011 | `pages/expenses/ExpenseClaimFormModal.workOrder.test.tsx` |
| AC-SCWO-013 | `pages/ExpenseClaimDetail.workOrder.test.tsx` + one curated e2e `e2e/AC-SCWO-013-claim-work-order.spec.ts` |
Mutation checks (quote red then green): drop the project test in `check_cost_attribution`; drop the `COST_ADVANCE` raise;
`v_allowed` forced true in `set_cost_attribution`; remove the freeze exemption's column list; count unposted ledger claims.

## Verify commands
- DB, one hold: `PMO_DB_LOCK=/tmp/db.lock scripts/with-db-lock.sh bash -c 'npx -y supabase@2.122.1 db reset && npx -y supabase@2.122.1 test db supabase/tests/1260_site_cash_work_order.test.sql supabase/tests/0950_work_order_cost_attribution.test.sql supabase/tests/0997_work_order_plan_vs_actual.test.sql supabase/tests/expense_claims_schema_rls.test.sql supabase/tests/imprest_cash.test.sql supabase/tests/0178_anon_executable_definers.test.sql supabase/tests/0178_m365_member_gate.test.sql supabase/tests/0646_rls_initplan.test.sql'`
- `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <files>`, `npx vitest related --run <files>`.
- `node --test scripts/check-isolation-denominator.test.mjs`; e2e `scripts/e2e-local.sh --reset AC-SCWO-013`.
