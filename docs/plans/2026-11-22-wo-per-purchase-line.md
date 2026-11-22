# Plan: a work order on each purchase line

Spec: `docs/specs/wo-per-purchase-line.spec.md`. Branch `feat/gap-material-wo-per-purchase-line`. Migrations 1880-1883 only.
Build test-first; no database job from this lane (orchestrator runs reset + pgTAP + e2e once per wave).

## Design in one paragraph

One new nullable column, `procurement_items.work_order_id`. One write path (`set_cost_attribution`, new source
`procurement_item`), one rule trigger, one read helper (`procurement_line_cost_shares`) used by every cost consumer. The
request-level value stays where it is and becomes the default for lines that name none, resolved at read time. No switch.

## Migrations (each with a rollback in `supabase/migrations/rollback/`)

| # | File | Content | Restates (body from highest-numbered definition at head) |
|---|---|---|---|
| 1880 | `1880_procurement_line_work_order.sql` | `alter table procurement_items add column work_order_id uuid references work_orders(id)`; partial index; trigger function `check_procurement_line_work_order` (before insert or update of work_order_id; project from the case; codes `COST_WO_PROJECT`, `COST_WO_NO_PROJECT`, `COST_WO_CANCELLED`); trigger refusing a work-order change by a non-definer, non-service writer outside `set_cost_attribution` (same device as 0951 §4); `set_cost_attribution` gains source `procurement_item` (+ `COST_LINE_DISCIPLINE`) | `set_cost_attribution` from `1261` (check no later definition with `scripts/prior-art.sh set_cost_attribution`) |
| 1881 | `1881_procurement_line_work_order_reads.sql` | `procurement_line_cost_shares(p_org, p_procurement)` stable: per effective work order its line-amount share in whole cents (largest remainder); `work_order_cost_lines` purchase_request arm per effective work order; `procurement_items_masked` gains `work_order_id` (appended last) | `work_order_cost_lines` from `1262`; `procurement_items_masked` from `1216` |
| 1882 | `1882_work_order_cost_unpriced_lines.sql` | commitment rows for the request record per effective work order | `work_order_cost_amounts_unpriced` from `1115` |
| 1883 | `1883_work_order_cost_amounts_lines.sql` | bill and `purchase_balance` fallback slot takes the line shares (FR-WPL-005/006/007); outer wrappers (`1113`, `1252`, `1298`) NOT touched | `work_order_cost_amounts_unrounded` from `1263` |
| (1884, only if confirmed) | `approve_equipment_plan` writes the line column (FR-WPL-014) | from `1472` (latest; verify) |

Rollbacks: `rollback/1880_..._down.sql` etc., run in reverse; 1880's down drops the column (lines' work orders are lost, noted in
the file); 1881-1883 downs restore the prior bodies exactly. `npm run check:restated-functions` must pass.

## Cost consumers switched to the line value (complete list)

1. `work_order_cost_amounts_unrounded` bill allocation and `purchase_balance` (1883).
2. `work_order_cost_amounts_unpriced` request-record commitment rows (1882).
3. `work_order_cost_lines` request-record rows (1881).
4. `procurement_items_masked` (1881) so non-price roles still read the line work order.
5. TS: `src/lib/db/workOrderFinance.ts` (page order gains `work_order_id`; row key includes it), `src/lib/workOrderPlanVsActual.ts`
   (no dedupe on `record_id`), `src/lib/db/workOrderCosts.ts` (cost lines keyset on `record_id` becomes `(record_id, work_order_id)`),
   `src/lib/db/workOrderCostMoney.ts` (link per record unchanged), `ProcurementDetails` timeline (`work_order_id` of records) shows per-line work order.
6. Unchanged on purpose: `1182` (records only), project finance totals, material requests (their own work order).
7. Equipment plan approval (`1359`/`1472`): description text becomes the line column (if confirmed).

## UI (restructure skill; DESIGN.md tokens; shared form primitives; EN + ID; 390px and 1440px)

- `pages/procurement/LineItemsSection.tsx`: per-line work-order `Combobox` (project's work orders via `useProjectWorkOrders`),
  default "Same as the request"; phone: inside the line card; desktop: a column. Absent when the project has no work orders,
  with the reason where the column would be; disabled when not editable, saying why. `ItemDraft` gains `workOrderId`.
- `pages/ProcurementCreate.tsx`: after `create_procurement_with_items`, attribute lines through
  `workOrderCostRepository` (source `procurement_item`), the ADR-0104 two-step; a refusal says "saved, but the work order was not set" and why.
- `src/lib/repositories/workOrderCosts.ts` + `src/lib/db/workOrderCosts.ts`: add the source (generated types, no casts; run `check-typed-dals`).
- Strings: `pmo-portal/public/locales/{en,id}/` procurement namespace; refusals `COST_LINE_DISCIPLINE` in
  `public/locales/{en,id}/refusals.json` (existing `COST_WO_*` already present, confirm each tells what to do next).
- Glossary: `docs/glossary.md` "Request-level work order (default for lines)". ADR: none (extends ADR-0104; add an addendum).

## Tests by AC

| AC | Layer | File |
|---|---|---|
| 001-003, 009 | pgTAP | `supabase/tests/1880_procurement_line_work_order.test.sql` (+ mutation check: drop project check; drop role check) |
| 004-008 | pgTAP | `supabase/tests/1883_work_order_cost_lines_split.test.sql` (baseline-equality for 006 against seed) |
| 013 | pgTAP | extend equipment-plan test |
| 010 | unit | `src/lib/db/workOrderFinance.test.ts`, `src/lib/workOrderPlanVsActual.test.ts` |
| 011 | unit | `pages/procurement/LineItemsSection.test.tsx` (+ refusal catalogue parity test already in `src/lib/refusals.test.ts`) |
| 012 | e2e | `e2e/AC-WPL-012-work-order-per-purchase-line.spec.ts` (one journey; isolation tag per `docs/e2e-parallel-conventions.md`) |

## Gates (phase 2, in `pmo-portal/`)

`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed>`, `npx vitest related --run <changed>`.
