# Plan: a work order on each purchase line (trace only)

Spec: `docs/specs/wo-per-purchase-line.spec.md`. Branch `feat/gap-material-wo-per-purchase-line` (merged with `origin/land/fix-1122`). Migrations
1880-1883. Built test-first; no database job from this lane (the orchestrator runs reset + pgTAP + e2e once per wave).

## Design

Two nullable columns on `procurement_items` (`work_order_id`, `discipline_id`), checked by the one existing rule (`check_cost_attribution`, run
as one more trigger), written through the one existing path (`set_cost_attribution`, source `procurement_item`). A rule copies an all-lines-agree
work order to the purchase header (1580's `procurements.work_order_id`), so today's cost reads, which resolve from the header-stamped records,
are untouched. Shown on the request (Items tab) and the order print. No cost read, view or money consumer is restated.

## Migrations (each with a rollback in `supabase/migrations/rollback/`)

| # | File | Content | Restates |
|---|---|---|---|
| 1880 | `1880_procurement_line_work_order.sql` | columns + index; trigger `zz_cost_attribution_check` -> existing `check_cost_attribution`; audit trigger; purchase-move guard (`COST_LINE_PROJECT_MOVE`); `set_cost_attribution` source `procurement_item` | `set_cost_attribution` from `1261` + the `1461` light guard (`-- drops:` marker, two lines gain the source) |
| 1881 | `1881_procurement_line_attribution_masked.sql` | masked line view appends the two non-money columns | `procurement_items_masked` from `1216` |
| 1882 | `1882_approve_equipment_plan_line_work_order.sql` | plan line's work order goes on the line column | `approve_equipment_plan` from `1472` + the `1480` light guard (`-- drops:` marker) |
| 1883 | `1883_line_work_order_copied_to_header.sql` | after-row trigger copies an all-lines-agree work order to the header | none (new function) |

Rollbacks restore the previous bodies exactly; 1880's drops the columns (line attribution is lost): roll back 1883, 1882, 1881 first.
Refusal catalogue: `COST_LINE_PROJECT_MOVE` and `_detail` next-step lines for `COST_WO_*` (en + id).

## What is deliberately NOT changed

`work_order_cost_amounts*` (1113/1252/1263/1298), `work_order_cost_lines` (1262), `work_order_cost_amounts_unpriced` (1115), project finance
totals, ERP-ledger mode, `check_cost_attribution` itself (1580's body is reused as is).

## UI (restructure skill; DESIGN.md tokens; shared form primitives; EN + ID; 390/1440)

`pages/procurement/LineWorkOrdersSection.tsx` (presentational), `LineWorkOrdersPanel.tsx` (Items tab, saves through the one write path),
`lineWorkOrderValue.ts`; `pages/ProcurementCreate.tsx` (section once a line exists; lines attributed after the case is saved;
`workOrderCostRepository.attributeLines`); `pages/PurchaseOrderPrint.tsx` (each line's work order and discipline under the item).
Strings: `public/locales/{en,id}/procurement.json` (`lineWorkOrders`, `purchaseOrderPrint.discipline`) and `refusals.json`.

## Tests by AC

| AC | Layer | File |
|---|---|---|
| 001-004 | pgTAP | `supabase/tests/1880_procurement_line_work_order.test.sql` (mutation checks in the header) |
| 005-006 | pgTAP | `supabase/tests/1883_line_work_order_copied_to_header.test.sql` (mutation check in the header) |
| 009 | pgTAP | `equipment_plan_orders.test.sql`, `1472_approve_equipment_plan_taken_reference.test.sql` (steps updated) |
| 007 | unit | `pages/procurement/LineWorkOrdersPanel.test.tsx`, `lineWorkOrderValue.test.ts`, `src/lib/db/workOrderCosts.test.ts` |
| 008 | e2e | `e2e/AC-WPL-012-work-order-per-purchase-line.spec.ts` (written, not run here) |

## Gates (in `pmo-portal/`)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`,
`npm run check:restated-functions`, `npm run check:typed-dals`.
