# Plan: Billed per month (spec `docs/specs/billed-per-month.spec.md`)

Test-first. One migration (1790): the shared calculation, `get_work_in_hand` restated to read it, and the one new read. No table, no view change, no setting.

## Tasks
1. **pgTAP** `supabase/tests/1790_work_order_billed_months.test.sql` (AC-BPM-001..005). Then `supabase/migrations/1790_work_order_billed_months.sql`: `work_order_billed_months_core(uuid[], date)` (security invoker, revoked from public/anon, granted to authenticated because its two invoker callers run as the caller); `get_work_in_hand` restated from `supabase/migrations/1148_work_in_hand.sql` (the only earlier definition; only the `w_ok` CTE changes, with a `-- drops:` marker); `get_work_order_billed_months` (security invoker; role gate Admin/Executive/Project Manager/Finance; P0002 when not found). Rollback `supabase/migrations/rollback/1790_work_order_billed_months_down.sql` restores the 1148 body and drops both new functions. `npm run check:restated-functions` passes.
2. **Types** `pmo-portal/src/lib/supabase/database.types.ts`: `get_work_order_billed_months` and `work_order_billed_months_core`.
3. **Data layer** `pmo-portal/src/lib/db/workOrderBilling.ts` `getWorkOrderBilledMonths` (+ `workOrderBilling.test.ts`, AC-BPM-007); repository `billedMonths` (`src/lib/repositories/workOrders.ts`, `contracts/workOrders.ts`); hook `useWorkOrderBilledMonths` in `src/hooks/useWorkOrderBilling.ts`.
4. **RTL** `pmo-portal/pages/work-order-detail/BillingSection.test.tsx` (AC-BPM-006/008), then the block in `pages/work-order-detail/BillingSection.tsx`, wired in `pages/WorkOrderDetail.tsx` (same `canBilling` gate). `pages/WorkOrderDetail.test.tsx` mock gains the new hook (steps unchanged).
5. **Strings** `pmo-portal/public/locales/{en,id}/workOrders.json` (`billing.perMonth.*`).
6. **e2e** `pmo-portal/e2e/AC-BPM-008-billed-per-month.spec.ts` (AC-BPM-009 journey; isolation tag).
7. **Docs** `docs/glossary.md` (Billed month).

## Traceability
| AC | Test file | Layer |
|---|---|---|
| AC-BPM-001..005 | `supabase/tests/1790_work_order_billed_months.test.sql` (+ unchanged `supabase/tests/work_in_hand.test.sql`) | pgTAP |
| AC-BPM-006, 008 | `pmo-portal/pages/work-order-detail/BillingSection.test.tsx` | unit (RTL) |
| AC-BPM-007 | `pmo-portal/src/lib/db/workOrderBilling.test.ts` | unit |
| AC-BPM-009 | `pmo-portal/e2e/AC-BPM-008-billed-per-month.spec.ts` | e2e |

## Screenshots for the orchestrator
`/work-orders/:id` as Finance at 390 px and 1440 px: billing in several months with the current month to date; nothing billed; a work order that cannot be totalled; read error.
