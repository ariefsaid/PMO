# Plan — work orders on the cost side (#2517)

Spec: `docs/specs/work-order-cost-attribution.spec.md` · ADR-0103 · branch `feat/2517-work-order-cost-spine` ·
migrations 0950–0952 (range 0950–0954).

## Tasks (as built)

1. **0950 discipline list** — `supabase/migrations/0950_cost_disciplines.sql` (+ rollback): table, live-code unique
   index, `stamp_org_id`, RLS (read: active members; write: Admin), column grants.
2. **0951 attribution** — `supabase/migrations/0951_work_order_cost_attribution.sql` (+ rollback): two columns and
   partial indexes on seven tables; `check_cost_attribution()` trigger on each; procurement move guard; posted-stock
   exemption in `guard_stock_document_immutable`; `set_cost_attribution(text, uuid[], uuid, uuid)`; view
   `work_order_cost_lines`.
3. **0952 timesheet week save** — `supabase/migrations/0952_timesheet_week_attribution.sql` (+ rollback): 0268's
   `save_timesheet_week` plus one attribution UPDATE after the upsert.
4. **pgTAP** — `supabase/tests/0950_work_order_cost_attribution.test.sql` (44 assertions, two orgs).
   Verify: `npx supabase@2.122.1 test db supabase/tests/0950_work_order_cost_attribution.test.sql`.
5. **Isolation manifest** — `scripts/isolation-probe-denominator.json`: table `cost_disciplines`, definer
   `set_cost_attribution(text,uuid[],uuid,uuid)`. Verify: `node scripts/check-isolation-denominator.mjs`.
6. **Types** — `pmo-portal/src/lib/supabase/database.types.ts` (hand-edited: no local DB in the build session;
   regenerate on the next `supabase gen types`).
7. **Seam** — `src/lib/db/workOrderCosts.ts`, `src/lib/repositories/workOrderCosts.ts`, `src/hooks/useWorkOrderCosts.ts`.
   Verify: `npx vitest run src/lib/db/workOrderCosts.test.ts`.
8. **Pickers** — `src/components/workOrders/CostAttributionFields.tsx` (+ `costAttributionError.ts`), strings
   `costAttribution.*` in `public/locales/{en,id}/common.json`.
9. **Forms** — equipment usage Add row (`pages/equipment/EquipmentUsage.tsx`); stock issue/transfer
   (`pages/stock/StockMovementForm.tsx`, attribution in `repositories/stock.ts` before a connected post); purchase
   request/order (`RecordCaptureForm.tsx` → `ProcurementLedger.tsx` handleCreate); goods receipt/vendor bill
   (`RecordCaptureForm.tsx` staged → `useProcurementDecision.tsx` commitConfirm); timesheet rows
   (`pages/timesheets/TimesheetRowAttribution.tsx`, `useTimesheetWeekEditor.ts`, `src/lib/timesheet-edit.ts`,
   `src/lib/db/timesheets.ts`).

## Traceability

| AC | Owning test |
|---|---|
| AC-WCA-001..011, 015 | pgTAP `0950_work_order_cost_attribution.test.sql` |
| AC-WCA-012, 013 | `src/lib/db/workOrderCosts.test.ts`, `src/components/workOrders/costAttributionError.test.ts` |
| AC-WCA-014 | `src/components/workOrders/CostAttributionFields.test.tsx` |
| AC-WCA-016 | `src/lib/timesheet-edit.test.ts` |

## Mutation checks (to run where Docker is available)

- `check_cost_attribution`: replace `v_wo_project is distinct from v_project` with `false` → AC-WCA-002 must go red.
- `set_cost_attribution`: set `v_priv := true` → AC-WCA-008 denials must go red.
- `guard_stock_document_immutable`: drop the `- 'work_order_id' - 'discipline_id'` exemption → AC-WCA-010 (posted
  issue attribution) must go red; return `new` unconditionally → the STK_IMMUTABLE assertion must go red.
