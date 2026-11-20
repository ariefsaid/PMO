# Client Material Requisitions Implementation Plan (#2585)

> Fresh Orca worker per slice; Slice 2 is Director-dispatched (stock posting path) and ships alone. Spec: `docs/specs/client-material-requisitions.spec.md` (sign OD-CSR-1..5, answer OQ-CSR-1..4 first). Blocked by #2523 (built on `feat/2523-stock-site-work`, not yet on `dev`): do not start Slice 2 until its migrations 0982 to 0984 (`stock_tags.zero_cost`, `stock_items.tag_id`, `guard_stock_line_zero_cost`, yard/staging kinds) are on `dev`. `stock_documents.work_order_id` (0951) is already on `dev`. Reuse, don't re-invent: `create_stock_document` / `post_stock_document` and `stock_write_entry` (0413, 0534), `stock_assert_keeper`, `stock_assert_standalone`, `work_order_lines` (0337), `next_procurement_doc_number`, `notify_workflow_user` (0237), record history (0260), the material-request RPC style (1000/1001).

## Design summary
Four tables and a read function. A requisition (header, `draft|open|cancelled`) has lines (item, take-off, requested, optional contract item). Reservations and releases are append-only events. A pickup row links a line to the stock receipt that `create_stock_document` made with `p_post = true`; the cost is hard-coded 0 by the RPC. Reserved, collected, still to collect and awaiting reservation are computed, never stored. The ledger stays single-writer: the RPC only calls the existing creation path. The same hand-worked month of numbers lives in a pure TypeScript function and the SQL read function so both are tested against AC-CSR-001.

## Migrations (numbers assigned by the Director; each with a rollback file; RLS + force RLS; `stamp_org_id`)
- **Migration A (tables):** `client_requisitions` (org, number, work_order_id, project_id copied from the work order, client_reference, status, client_request_id, created_by, sent_by/at, cancelled_by/at); `client_requisition_lines` (requisition, line_no, stock_item_id, work_order_line_id nullable, takeoff_quantity, requested_quantity, unit snapshot); `client_requisition_events` (line, kind `reserved|released`, quantity, client_reference, event_on, reason, recorded_by); `client_requisition_pickups` (line, quantity, picked_up_on, collector, stock_document_id, client_request_id, recorded_by). Select-only grants to authenticated; no insert/update/delete grant. Indexes: requisitions (work_order_id, status), lines (requisition_id), events and pickups (line_id), unique (org, created_by, client_request_id) per table that takes one. *Rollback:* drop the four tables.
- **Migration B (RPCs):** `csr_create` (idempotent), `csr_send`, `csr_cancel`, `csr_record_reservation` (cap, lock the line row), `csr_record_release`, `csr_record_pickup` (lock line, check still-to-collect and zero-cost tag, assert standalone, assert the item's tag is `zero_cost`, call `create_stock_document` with kind `receive`, lines at unit cost 0 hard-coded and `p_post` false, set `stock_documents.work_order_id` in the same transaction as 1001 does, then `post_stock_document`, then insert the pickup row), `csr_work_order_rollup(work_order_id)` (read, security invoker). Notification on reservation through `notify_workflow_user`. History: `client_requisition_events` (append-only trigger, as 1000/1001); not registered in `record_history_config` (0260), as material requests are not. Also replaces `check_cost_attribution` with the 0982 body plus a `receive` branch (receiving warehouse of kind site/yard/staging gives the project) so the receipt may name the work order; pgTAP in `csr_pickup.test.sql`. *Rollback:* drop the functions.
- **Take-off import (no migration):** `pmo-portal/src/lib/import/clientTakeoffDescriptor.ts`, exported from `src/lib/import/index.ts`, after #2530's generic template slice adds `template?` to `ImportDescriptor` in `types.ts` (ADR-0027); its create calls the requisition repository.
- ADR candidate: none; if the pickup posts anything other than through `create_stock_document`, stop and write an ADR first.

## Slice 1 - pure rollup (Orca)
- [ ] `pmo-portal/src/lib/clientRequisitionRollup.ts` + `src/lib/__tests__/clientRequisitionRollup.test.ts`: the hand-worked line (AC-CSR-001), different units (002), empty (003) written first; exact decimals via the repo's `exactDecimal` helper only. `npx vitest run src/lib/__tests__/clientRequisitionRollup.test.ts`.

## Slice 2 - schema, RPCs, posting (Director, ships alone)
- [ ] pgTAP `supabase/tests/csr_requisition.test.sql`: AC-CSR-004, 005, 013, 014, 015, 016, 017 failing first.
- [ ] pgTAP `supabase/tests/csr_pickup.test.sql`: AC-CSR-006..012, 018, and AC-CSR-001 against `csr_work_order_rollup`.
- [ ] Migrations A and B. Run chained: `scripts/with-db-lock.sh bash -c 'supabase db reset && supabase test db supabase/tests/csr_requisition.test.sql supabase/tests/csr_pickup.test.sql'`.
- [ ] Extend `check_cost_attribution` with the `receive` branch (pgTAP: receipt with the work order of its site accepted; another project's work order refused; AC-CSR-018).
- [ ] Mutation checks, each restored after: drop the zero-cost refusal (AC-CSR-009), drop the still-to-collect check (AC-CSR-006/007), grant insert on the events table (AC-CSR-016). Quote the red results.
- [ ] Extend `scripts/stock-single-writer.test.mjs` run to confirm no requisition migration writes `stock_ledger` or `stock_balances`.

## Slice 3 - repository and policy (Orca)
- [ ] `pmo-portal/src/lib/db/clientRequisitions.ts`, `src/lib/repositories/clientRequisitions.ts`; actions in `src/auth/policy.ts` (`clientRequisition`: view, create, send, cancel, recordReservation, recordPickup), role-matrix registration (#902). Reference slice: `src/lib/db/companies.ts`.
- [ ] Vitest for the repository mapping and `can()` rows; `classifyMutationError` cases for the refusals in the spec's Errors table.

- [ ] `pmo-portal/src/lib/import/clientTakeoffDescriptor.ts` + `__tests__/clientTakeoffDescriptor.test.ts` (FR-CSR-003: same validation as manual entry, idempotent re-import); mount `ImportButton` on the requisition form behind `can('create', 'clientRequisition')`.

## Slice 4 - screens (ui-implementer; `restructure`)
- [ ] Section "Client material" on the work order record page (there is no work-order detail page: the work order is a row with drawers in the project's Work orders tab, `pmo-portal/pages/project-detail/tabs/WorkOrdersTab.tsx` and `WorkOrdersDrawers.tsx`; add a `ClientMaterialDrawer` beside the existing drawers, new file `pages/project-detail/tabs/WorkOrdersClientMaterial.tsx`) showing the rollup, line table, reservation and pickup history; requisition form `pages/ClientRequisitionForm.tsx` built with `EntityFormModal`/`useEntityForm`; record-reservation and record-pickup dialogs.
- [ ] en + id strings in the existing translation files (rebase them right before the PR, #1070); the organisation's tag word from #2529 never hardcoded. States: empty, error, over-limit, not a keeper, ERP-owned. Run `scripts/ux-proof.sh` on touched routes.

## Slice 5 - acceptance
- [ ] `e2e/AC-CSR-019-requisition-to-pickup.spec.ts` (read `docs/e2e-parallel-conventions.md`; tag isolation class); `scripts/e2e-local.sh AC-CSR-019`.

## Traceability
| AC | Owning test |
|---|---|
| AC-CSR-001 | Vitest `clientRequisitionRollup.test.ts` + pgTAP `csr_pickup.test.sql` |
| AC-CSR-002, 003 | Vitest `clientRequisitionRollup.test.ts` |
| AC-CSR-004, 005, 013, 014, 015, 016, 017 | pgTAP `csr_requisition.test.sql` |
| AC-CSR-006..012, 018 | pgTAP `csr_pickup.test.sql` |
| FR-CSR-003 (no AC; unit) | Vitest `clientTakeoffDescriptor.test.ts` |
| AC-CSR-019 | Playwright `AC-CSR-019-requisition-to-pickup.spec.ts` |

## Final gate
In `pmo-portal/`: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched files>`, the touched vitest files, `node scripts/affected-e2e.mjs` for UI. Database, from the repo root and under the lock: only the two touched pgTAP files. CI's `pgtap` job is the full proof.
