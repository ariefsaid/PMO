# Client Material Requisitions Implementation Plan (#2585)

> Fresh Orca worker per slice; Slice 2a (cost-attribution trigger, money rule) and Slice 2b (stock posting path) are each Director-dispatched, through Orca workers, and each ships alone, 2a first. Spec: `docs/specs/client-material-requisitions.spec.md` (sign OD-CSR-1..6, answer OQ-CSR-1..4 first). Blocked by #2523 (built on `feat/2523-stock-site-work`; landing on `dev` from `land/1215-r1` as **1029–1031**, 0982–0984 before renumbering; `stock_tags.zero_cost`, `stock_items.tag_id`, `guard_stock_line_zero_cost`, yard/staging kinds, and the `check_cost_attribution` body all come from the same 1029). Do not start Slice 2a until those are on `dev`. `stock_documents.work_order_id` (0951) is already on `dev`. Reuse, don't re-invent: `create_stock_document` / `post_stock_document` and `stock_write_entry` (0413, 0534), `stock_assert_keeper`, `stock_assert_standalone`, `work_order_lines` (0337, the allocation row to a `boq_items` line), `next_procurement_doc_number`, `notify_workflow_user` (0237), record history (0260), the material-request RPC style (1000/1001).

## Built on defaults (owner to confirm)
Built on the spec's recommended defaults; none was signed by the owner at build time.
- OD-CSR-1: status is only `draft | open | cancelled`; progress is derived from events.
- OD-CSR-2: a pickup is accepted only for an item whose tag is `zero_cost`; the RPC writes unit cost 0 itself and takes no cost parameter.
- OD-CSR-3: reserved may not exceed requested.
- OD-CSR-4: the pickup records and posts the receipt in one step by the receiving location's keeper (or Admin); no separate Draft receipt.
- OD-CSR-5: take-off is typed or imported; no calculation from drawings.
- OD-CSR-6: Migration C extends `check_cost_attribution` for `receive` into a site, yard or staging location and adds `warehouse_id` to the trigger column list; central receives stay refused; receives stay out of `work_order_cost_lines`. It also extends `guard_warehouse_move_with_work_orders` so a location cannot be moved away from the project of a receive that names a work order.
- OQ-CSR-1: no cap of requested at the allocation row's quantity.
- OQ-CSR-2: an ERP-owned inventory domain refuses the pickup.
- OQ-CSR-3: a wrong pickup is undone by a stock adjustment only; no reverse-pickup event.
- OQ-CSR-4: reservation proof is optional and not built in this branch; a delivery paper on a pickup is a free-text reference (`paper_reference`), no file upload.
- Cancel and reservation authority: who may create, send, cancel, reserve and release = Project Manager and above (rank >= 20) plus the requisition's creator for send and cancel; pickup = keeper of the receiving location or Admin (as `create_stock_document`).
- Migration numbers used: 1085 (C, cost attribution), 1086 (A, tables), 1087 (B, RPCs and rollup read function).

## As built (20 Nov)
- Migrations: `1085_receive_work_order_attribution.sql` (Migration C, also extends `guard_warehouse_move_with_work_orders` so a location holding a receive that names a work order cannot leave its project), `1086_client_requisitions.sql` (tables, append-only triggers on events and pickups, RLS + FORCE RLS, select-only grants), `1087_client_requisition_rpcs.sql` (the seven writers, internals, and `csr_work_order_rollup`). Rollbacks in `supabase/migrations/rollback/`.
- The pickup serialises per line with `pg_advisory_xact_lock('csr-line:' || line_id)` plus a shared row lock on the requisition (cancel takes it exclusive). Collected is summed from the pickup rows; reserved from the event log. The Slice 2a trigger-column mutation is proved by a direct `update ... set warehouse_id` test because `save_stock_draft` also sets other watched columns.
- Screens: the "Client material" section is `pages/work-order-detail/ClientMaterialSection.tsx` (#2518 is on `dev`); the take-off import button sits in the section header (a sheet's rows become the lines of one new draft requisition).
- Not built: proof attachment on a reservation (OQ-CSR-4), the delivery paper is a free-text reference.

## Design summary
Four tables and a read function. A requisition (header, `draft|open|cancelled`) has lines (item, take-off, requested, optional allocation row). Reservations and releases are append-only events. A pickup row links a line to the stock receipt that `create_stock_document` made (unposted, `p_post = false`) and the RPC then posted in the same transaction; the cost is hard-coded 0 by the RPC. Reserved, collected, still to collect and awaiting reservation are computed, never stored. The ledger stays single-writer: the RPC only calls the existing creation path. The same hand-worked month of numbers lives in a pure TypeScript function and the SQL read function so both are tested against AC-CSR-001.

## Migrations (numbers assigned by the Director; each with a rollback file; RLS + force RLS; `stamp_org_id`)
- **Migration A (tables):** `client_requisitions` (org, number, work_order_id, project_id copied from the work order, client_reference, status, client_request_id, created_by, sent_by/at, cancelled_by/at); `client_requisition_lines` (requisition, line_no, stock_item_id, work_order_line_id nullable, takeoff_quantity, requested_quantity, unit snapshot); `client_requisition_events` (**requisition**, line_id **nullable**, kind `created|sent|cancelled|reserved|released|pickup`, quantity nullable, client_reference, event_on, reason, recorded_by) — header events have no line, so the key is the requisition; `client_requisition_pickups` (line, quantity, picked_up_on, collector, stock_document_id, client_request_id, recorded_by). Select-only grants to authenticated; no insert/update/delete grant. Indexes: requisitions (work_order_id, status), lines (requisition_id), events (requisition_id, created_at) and (line_id, created_at), pickups (line_id), unique (org, created_by, client_request_id) per table that takes one. *Rollback:* drop the four tables.
- **Migration B (RPCs):** `csr_create` (idempotent), `csr_send`, `csr_cancel`, `csr_record_reservation` (cap, lock the line row), `csr_record_release`, `csr_record_pickup` (assert active + requisition not cancelled, lock line, check still-to-collect and zero-cost tag, **call `stock_assert_standalone` first** — `create_stock_document(p_post => false)` does not, 0413 — call `create_stock_document` with kind `receive`, lines at unit cost 0 hard-coded and `p_post` false, set `stock_documents.work_order_id` in the same transaction as 1001 does, then `post_stock_document`, then insert the pickup row), `csr_work_order_rollup(work_order_id)` (read, security invoker). Notification on reservation through `notify_workflow_user`. History: `client_requisition_events` (append-only trigger, as 1000/1001); not registered in `record_history_config` (0260), as material requests are not. pgTAP in `csr_pickup.test.sql`. *Rollback:* drop the functions.
- **Migration C (cost-attribution trigger, its own slice, ships alone; sequenced before Migration B):** `create or replace function public.check_cost_attribution()` with #2523's body (read it on `dev` at build time) plus, in the `stock_documents` case, `elsif new.kind = 'receive' then select w.project_id into v_project from public.stock_warehouses w where w.id = new.warehouse_id and w.org_id = new.org_id and w.kind in ('site','yard','staging')`, **and `warehouse_id` added to the `stock_documents` trigger's column list** (it lists `work_order_id, discipline_id, project_id, kind, to_warehouse_id` today; `save_stock_draft` can move a Draft receive's `warehouse_id`, so without it a draft receive naming a work order can be re-pointed to a central location after attribution). The receive document's receiving warehouse is `stock_documents.warehouse_id` (0413). A central warehouse yields a null project, so `COST_WO_NO_PROJECT` still fires. The view `work_order_cost_lines` (0951) is NOT touched: it selects `d.kind in ('issue','return','transfer')`, so receives stay out of it (AC-CSR-023). Interaction with `get_work_order_stock_balance` (0984 / 1031): the receipt appears there with quantity and a value of 0; it adds no cost line. *Rollback:* restore #2523's function body and the original column list.
- **Take-off import (no migration):** `pmo-portal/src/lib/import/clientTakeoffDescriptor.ts`, exported from `src/lib/import/index.ts`, after #2530's generic template slice adds `template?` to `ImportDescriptor` in `types.ts` (ADR-0027); its create calls the requisition repository.
- ADR candidate: none; if the pickup posts anything other than through `create_stock_document`, stop and write an ADR first.

## Slice 1 - pure rollup (Orca)
- [ ] `pmo-portal/src/lib/clientRequisitionRollup.ts` + `src/lib/__tests__/clientRequisitionRollup.test.ts`: the hand-worked line (AC-CSR-001), different units (002), empty (003) written first; exact decimals via the repo's `exactDecimal` helper only. `npx vitest run src/lib/__tests__/clientRequisitionRollup.test.ts`.

## Slice 2a - cost-attribution receive branch (Director, MONEY PATH, ships alone)
- [ ] pgTAP first, in a new file `supabase/tests/csr_cost_attribution.test.sql` (AC-CSR-020, 021, 023), modelled on the fixtures of `supabase/tests/0950_work_order_cost_attribution.test.sql`: (a) receive into a site/yard/staging location of project P naming a work order of P is accepted; (b) a work order of another project is refused `COST_WO_PROJECT`; (c) receive into a central location naming a work order is refused `COST_WO_NO_PROJECT`; (d) AC-CSR-023: after the receive, `work_order_cost_lines` has no row for it; (e) AC-CSR-020's re-point case: a Draft receive naming a work order of P, moved to a central warehouse by `save_stock_draft`, is refused.
- [ ] Migration C. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/csr_cost_attribution.test.sql supabase/tests/0950_work_order_cost_attribution.test.sql'` (AC-CSR-022: the existing file passes unchanged, which covers issue, return and transfer).
- [ ] Mutation checks (AC-CSR-022), each restored after, red results quoted: drop the `receive` branch; remove the project comparison for `receive`; treat a central warehouse as a project source; remove `warehouse_id` from the trigger's column list (the re-point case goes red).

## Slice 2b - schema, RPCs, posting (Director, MONEY PATH, ships alone, after 2a is on `dev`)
- [ ] pgTAP `supabase/tests/csr_requisition.test.sql`: AC-CSR-004, 005, 013, 014, 015, 016, 017 failing first.
- [ ] pgTAP `supabase/tests/csr_pickup.test.sql`: AC-CSR-006..012, 018, and AC-CSR-001 against `csr_work_order_rollup`.
- [ ] Migrations A and B. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/csr_requisition.test.sql supabase/tests/csr_pickup.test.sql'`.
- [ ] Mutation checks, each restored after: drop the zero-cost refusal (AC-CSR-009), drop the still-to-collect check (AC-CSR-006/007), grant insert on the events table (AC-CSR-016), skip the cancelled-requisition refusal (AC-CSR-013). Quote the red results.
- [ ] Extend `scripts/stock-single-writer.test.mjs` run to confirm no requisition migration writes `stock_ledger` or `stock_balances`.

## Slice 3 - repository and policy (Orca)
- [ ] `pmo-portal/src/lib/db/clientRequisitions.ts`, `src/lib/repositories/clientRequisitions.ts`; actions in `src/auth/policy.ts` (`clientRequisition`: view, create, send, cancel, recordReservation, recordPickup), role-matrix registration (#902). Reference slice: `src/lib/db/companies.ts`.
- [ ] Vitest for the repository mapping and `can()` rows; `classifyMutationError` cases for the refusals in the spec's Errors table.

- [ ] `pmo-portal/src/lib/import/clientTakeoffDescriptor.ts` + `__tests__/clientTakeoffDescriptor.test.ts` (FR-CSR-003: same validation as manual entry, idempotent re-import); mount `ImportButton` on the requisition form behind `can('create', 'clientRequisition')`.

## Slice 4 - screens (ui-implementer; `restructure`)
- [ ] Section "Client material" on the work order record page. #2518 builds that page on branch `feat/2518-work-order-page`: route `/work-orders/:id` (`pmo-portal/App.tsx`), page `pmo-portal/pages/WorkOrderDetail.tsx`, one file per section under `pmo-portal/pages/work-order-detail/` (`ScopeSection.tsx`, `CostSection.tsx`, `BillingSection.tsx`, `DocumentsSection.tsx`), each a `RecordSection` inside `RecordStack`. **Once #2518 is on `dev`:** add `pmo-portal/pages/work-order-detail/ClientMaterialSection.tsx` (same shape as `CostSection.tsx`: loading, error with retry, empty state) and mount it in `WorkOrderDetail.tsx` inside `RecordStack`, gated by `can('view', 'clientRequisition')`; strings in `pmo-portal/public/locales/{en,id}/workOrders.json`. **Fallback only if #2518 has not landed when this slice starts:** a `ClientMaterialDrawer` beside the existing drawers in `pmo-portal/pages/project-detail/tabs/WorkOrdersDrawers.tsx`, new file `pages/project-detail/tabs/WorkOrdersClientMaterial.tsx`, reached from the row in `WorkOrdersTab.tsx`; move it to the section when #2518 lands. Either way it shows the rollup, line table, reservation and pickup history. Requisition form `pages/ClientRequisitionForm.tsx` built with `EntityFormModal`/`useEntityForm`; record-reservation and record-pickup dialogs.
- [ ] en + id strings in the existing translation files (rebase them right before the PR, #1070); the organisation's tag word from #2529 never hardcoded. States: empty, error, over-limit, not a keeper, ERP-owned. Run `scripts/ux-proof.sh` on touched routes.

## Slice 5 - acceptance
- [ ] `e2e/AC-CSR-019-requisition-to-pickup.spec.ts` (read `docs/e2e-parallel-conventions.md`; tag isolation class); `scripts/e2e-local.sh AC-CSR-019`.

## Traceability
| AC | Owning test |
|---|---|
| AC-CSR-001 | Vitest `clientRequisitionRollup.test.ts` + pgTAP `csr_pickup.test.sql` |
| AC-CSR-002, 003 | Vitest `clientRequisitionRollup.test.ts` |
| AC-CSR-004, 013, 014, 015, 016, 017 | pgTAP `csr_requisition.test.sql` |
| AC-CSR-005, 006..012, 018 | pgTAP `csr_pickup.test.sql` (AC-CSR-005 needs a posted pickup to make collected non-zero, so it lives with the pickup proof) |
| AC-CSR-020, 021, 023 | pgTAP `csr_cost_attribution.test.sql` |
| AC-CSR-022 | pgTAP `0950_work_order_cost_attribution.test.sql` (unchanged) + the mutation runs on `csr_cost_attribution.test.sql` |
| FR-CSR-003 (no AC; unit) | Vitest `clientTakeoffDescriptor.test.ts` |
| AC-CSR-019 | Playwright `AC-CSR-019-requisition-to-pickup.spec.ts` |

## Final gate
In `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, `node scripts/affected-e2e.mjs` for UI. Database, from the repo root and under the lock: only the two touched pgTAP files. CI's `pgtap` job is the full proof.
