# Transfer between work orders: Implementation Plan (#2691)

Spec: `docs/specs/stock-work-order-transfer.spec.md`. Money path (stock ledger, work-order cost). Ships alone, stacked on #2690. Read first:
`supabase/migrations/0413` (`stock_apply`, `stock_lock_for_document`, `stock_insert_lines`, `stock_post_core` as re-created in 1309), `0414`
(`stock_apply_issue`, `stock_apply_return`), `1029` (`check_cost_attribution`), `1031` (`get_work_order_stock_balance`), `1100` (`mrq_prior_quantity`),
`1102`, `1308` (`send_stock_transfer`, the pattern: validate, system-write switch, `log_audit`).

## Decisions
- **Engine untouched.** The RPC inserts a Draft return and a Draft issue (`stock_insert_lines`), links them to the WOT, then posts each with
  `stock_post_core` (keeper check, dates, ERP check, archive locks, engine apply, `stock.admin_post` audit). No posting code is copied.
- WOT = `stock_wo_transfers` header only; the two stock documents hold the lines. `stock_documents.wo_transfer_id` links them (nullable).
- `pmo.stock_system_write` (1305) is switched on locally while inserting the two linked drafts and off again before posting, so the guard
  that only the RPC sets `wo_transfer_id` holds and the transit-location guard is NOT bypassed for the posts.

## Migrations (numbers 1310-1314 only; rollbacks in `supabase/migrations/rollback/<n>_..._down.sql`)
1. **`1310_stock_wo_transfers.sql`** - table `stock_wo_transfers` (id, org_id, number, project_id, warehouse_id, from_work_order_id,
   to_work_order_id, note, occurred_on, created_by, created_at, client_request_id; unique (org_id, number); check from <> to; idempotency unique
   index (org_id, created_by, client_request_id)); RLS enabled and forced, select policy with `(select auth_org_id())` and `(select is_active_member())`;
   all client writes revoked; `guard_stock_wo_transfer` before update or delete (always refuse). `stock_documents.wo_transfer_id uuid references
   stock_wo_transfers(id)` + partial index; `guard_stock_document_wo_transfer` before insert or update of wo_transfer_id (`mut:wot_system_only`):
   refuses unless `stock_system_write_on()` and kind in (return, issue).
2. **`1311_stock_wo_transfer_available.sql`** - `stock_wo_net_issued(org, wo, item)` stable definer (posted issue lines of that work order less posted
   returns citing them, per issue line, oldest first) and client read `get_work_order_returnable(p_work_order_id)` returning jsonb rows
   (item id/code/name, unit, net quantity, default boq item, value only when `stock_can_see_cost()`), bounded by `auth_org_id()`.
3. **`1312_stock_wo_transfer_post.sql`** - `post_stock_wo_transfer(p_header jsonb, p_lines jsonb, p_client_request_id uuid default null) returns uuid`
   (security definer; `assert_is_active_member`; idempotent replay; `stock_assert_standalone`; checks of FR-WOT-003/004/005 with the named errors;
   locks A's issue lines `for no key update` in id order before allocating; `stock_assert_keeper` and `stock_assert_dates` via the posts;
   numbers via `next_procurement_doc_number(org, 'WOT')`; `log_audit('stock.wo_transfer', ...)`). Deferred constraint trigger
   `stock_wo_transfers_pair_check` on `stock_wo_transfers` (after insert, deferrable initially deferred) calling `check_stock_wo_transfer_pair` (`mut:wot_pair_check`).
   Revoke from public/anon; grant execute to authenticated for the RPC and `get_work_order_returnable`.
4. **`1313_stock_wo_transfer_balances.sql`** - re-create `get_work_order_stock_balance` (1031 body verbatim, plus the received term for the issue half
   and the moved-out term for the return half of a WOT document at the project's `site`/`yard`/`staging` locations, quantity and value) and
   `mrq_prior_quantity` (1100 body verbatim plus `coalesce(sum(-l.qty_delta), 0)` over ledger rows of documents with `wo_transfer_id` and `work_order_id = p_work_order_id`).
5. **`1314_stock_wo_transfer_setting.sql`** - `organizations.stock_wo_transfers boolean not null default false`, `stock_wo_transfers_on(org)`, `set_stock_wo_transfers(boolean)` (Admin, standalone, audited `stock.wo_transfers`), test `1314_stock_wo_transfer_setting.test.sql`. `post_stock_wo_transfer` refuses `STK_WOT_OFF` while off.

Inventories: `supabase/tests/inventory/anon-executable-definers/2691-work-order-transfer.txt` lists `post_stock_wo_transfer`;
`scripts/isolation-probe-denominator.d/2691-work-order-transfer.json` lists the table (`has_org`, own-org-only) and the definer functions
(`stock_wo_net_issued(uuid,uuid,uuid)`, `get_work_order_returnable(uuid)`, `post_stock_wo_transfer(jsonb,jsonb,uuid)`, `guard_*`, `check_stock_wo_transfer_pair(uuid)`).
Read both script headers when writing them.

## Tests (written first)
- `supabase/tests/1310_stock_wo_transfer.test.sql` - AC-WOT-001, 004, 005, 007, 008, 009, 010, 011, 013, 014, 015 (fixtures: two work orders, a site, yard,
  staging, vendor and central location, keeper and non-keeper, two organisations, a two-step org).
- `supabase/tests/1314_stock_wo_transfer_setting.test.sql` - AC-WOT-019.
- `supabase/tests/1311_stock_wo_transfer_balances.test.sql` - AC-WOT-002, 003, 006, 012 (reconciliation sum, value conservation, no-WOT identity).
- `pmo-portal/src/lib/db/stockWorkOrderTransfer.test.ts` and `pmo-portal/pages/stock/StockWorkOrderTransfer.test.tsx` - AC-WOT-016, 017 (en and id key parity, entry point gating).
- `pmo-portal/e2e/serial/AC-WOT-018-work-order-transfer-phone.spec.ts` (tag `@e2e-isolation` per `docs/e2e-parallel-conventions.md`) - AC-WOT-018.
- Not run in this lane (DB, e2e, screenshots are run on the integration branch); only static gates run here.

## Front end
- `pmo-portal/src/lib/db/stockWorkOrderTransfer.ts` (rpc wrappers: `postWorkOrderTransfer`, `getReturnable`, `getWorkOrderTransfer`, `listWorkOrderTransfers`) ->
  `src/lib/repositories/stockWorkOrderTransfer.ts` (`wrap`, ADR-0017) -> `src/hooks/useStockWorkOrderTransfer.ts`.
- Screen `pmo-portal/pages/stock/StockWorkOrderTransfer.tsx` (route `/stock/work-order-transfer`): phone-first single column, `restructure` skill: pick location, from work order,
  to work order (project fixed by the first pick), then lines (item combobox limited to what A holds, quantity with "available n" and a client-side cap, optional work item), note;
  one primary action "Move to <B>" with a `ConfirmDialog` stating the two effects. Shared primitives only (`useEntityForm`, `Combobox`, `FieldError`), `classifyMutationError`.
  Detail `StockWorkOrderTransferDetail.tsx` (route `/stock/work-order-transfer/:id`) shows both halves and links.
- Entry: a link "Move leftover to another work order" on `StockDocuments.tsx`, shown only when the org setting `stock_wo_transfers` is on AND the user is a stock writer (`can('create','stockDocument',{record:{isKeeper}})`); the routes render the "off" empty state otherwise. Admin toggle on the Stock setup transfers panel. The "part of WOT-nnnn" link on `StockDocumentDetail.tsx` and the ledger row (FR-WOT-013).
- `src/auth/policy.ts` unchanged (existing `stockDocument.create`). `App.tsx`: two lazy routes (namespace `stock`).
- Strings: `pmo-portal/public/locales/en/stock.json` and `id/stock.json` (keys `workOrderTransfer.*`), parity tested.
- Glossary: `docs/glossary.md` adds "Work-order transfer (WOT)".

## Gates (this lane)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <changed files>`, `npx vitest run <new and touched files>` in `pmo-portal/`. Before push: attribution grep against `origin/feat/2690-two-step-transfer-recount`.
