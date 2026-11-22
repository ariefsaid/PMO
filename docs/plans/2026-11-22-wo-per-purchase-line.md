# Plan: a work order on each purchase line

Spec: `docs/specs/wo-per-purchase-line.spec.md`. Branch `feat/gap-material-wo-per-purchase-line`. Migrations 1880-1883 only
(1884 was not needed). Built test-first; no database job from this lane (the orchestrator runs reset + pgTAP + e2e once per wave).

## Design in one paragraph

One new nullable column, `procurement_items.work_order_id`. One write path (`set_cost_attribution`, new source
`procurement_item`), one rule trigger, one read helper (`procurement_line_parts`) used by the one money read that needs it. A line's
OWN work order wins; the record-level chain (bill, PO, receipt, request) is the default for lines that name none, resolved at
read time. No switch. Document lists and commitment rows keep each record under its own work order (no money, and a record's amount
must not be counted under several work orders).

## Migrations (each with a rollback in `supabase/migrations/rollback/`)

| # | File | Content | Restates (body from the highest-numbered definition at head) |
|---|---|---|---|
| 1880 | `1880_procurement_line_work_order.sql` | column + index; rule trigger `check_procurement_line_work_order` (`COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED`); audit trigger; purchase-move guard (`COST_LINE_PROJECT_MOVE`); `set_cost_attribution` gains source `procurement_item` and refuses a discipline on a line (`COST_LINE_DISCIPLINE`) | `set_cost_attribution` from `1261` plus the light-account guard `1461` injects (`-- drops:` marker: two lines gain the new source) |
| 1881 | `1881_procurement_line_cost_parts.sql` | `procurement_line_parts(org, purchase, default wo, default discipline)`; `procurement_items_masked` gains `work_order_id` (appended) | `procurement_items_masked` from `1216` |
| 1882 | `1882_work_order_cost_line_split.sql` | bill and `purchase_balance` allocation splits by line value (own work order wins, else the chain), whole cents, largest remainder | `work_order_cost_amounts_unrounded` from `1263` (no line dropped; `bill_amounts` and `remainders` CTEs now read `bill_base` / `remainder_base`) |
| 1883 | `1883_approve_equipment_plan_line_work_order.sql` | plan line's work order goes on the purchase line through `set_cost_attribution` | `approve_equipment_plan` from `1472` plus the light-account guard `1480` injects (`-- drops:` marker: the description's work-order text) |

Rollbacks restore the previous bodies exactly (1880's drops the column: line work orders are lost; roll back 1883, 1882, 1881 first).
Refusal catalogue: `COST_LINE_DISCIPLINE`, `COST_LINE_PROJECT_MOVE` and `_detail` next-step lines for `COST_WO_*` (en + id).

## Cost consumers switched to the line value (complete list)

1. `work_order_cost_amounts_unrounded`: vendor-bill allocation and `purchase_balance` (1882). Every wrapper (`1113`, `1252`, `1298`) reads it unchanged.
2. `procurement_items_masked` (1881) so roles without price access still read the line's work order.
3. `approve_equipment_plan` (1883): the work order as the line's column, not description text.
4. TS: `src/lib/db/workOrderFinance.ts` (page order and key gain `work_order_id`); `src/lib/workOrderPlanVsActual.ts` needs no change (it sums rows,
   proven by a unit test); `workOrderCosts.ts` (`AttributionSource`, `procurement_item`) and the repository's `attributeLines`.
5. Deliberately unchanged: `work_order_cost_lines` (1262) and `work_order_cost_amounts_unpriced` (1115) list documents under the record's own work order; `1182`;
   project finance totals; ERP-ledger mode.

## UI (restructure skill; DESIGN.md tokens; shared form primitives; EN + ID)

- `pages/procurement/LineWorkOrdersSection.tsx` (presentational) and `LineWorkOrdersPanel.tsx` (Items tab, saves through the one write path),
  `lineWorkOrderValue.ts` (helpers). The create form (`pages/ProcurementCreate.tsx`) shows the section once a line exists; after the case is
  saved the lines are attributed (`workOrderCostRepository.attributeLines`); a refusal says "saved, but ..." and why.
- Strings: `public/locales/{en,id}/procurement.json` (`lineWorkOrders`) and `refusals.json`.

## Tests by AC

| AC | Layer | File |
|---|---|---|
| 001-003, 009 | pgTAP | `supabase/tests/1880_procurement_line_work_order.test.sql` (mutation checks in the header) |
| 004-008 | pgTAP | `supabase/tests/1882_work_order_cost_line_split.test.sql` (mutation checks in the header) |
| 013 | pgTAP | `equipment_plan_orders.test.sql`, `1472_approve_equipment_plan_taken_reference.test.sql` (steps updated) |
| 010 | unit | `src/lib/db/workOrderFinance.test.ts`, `src/lib/workOrderPlanVsActual.test.ts` |
| 011 | unit | `pages/procurement/LineWorkOrdersPanel.test.tsx`, `lineWorkOrderValue.test.ts`, `src/lib/db/workOrderCosts.test.ts` |
| 012 | e2e | `e2e/AC-WPL-012-work-order-per-purchase-line.spec.ts` (written, not run here) |

## Gates (in `pmo-portal/`)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`,
`npm run check:restated-functions`, `npm run check:typed-dals`.
