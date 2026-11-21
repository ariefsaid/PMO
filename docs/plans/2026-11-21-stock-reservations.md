# Stock reservations and borrowing: Implementation Plan (#2693)

Spec: `docs/specs/stock-reservations.spec.md`. Stock-ledger and approval rules; ships alone; stacked on #2691. Migrations **1315-1319 only**, rollbacks in
`supabase/migrations/rollback/<n>_..._down.sql`. Read first: `0412` (`stock_master_writer`), `0413` (`stock_assert_keeper`, `stock_assert_standalone`), `1000`/`1001`/`1045`
(`approval_chain_steps`, `mrq_submit`, `mrq_decide_step`, `mrq_set_chain`), `1101` (destination kinds), `1300` (`get_stock_on_hand`, not edited), `1314` (setting pattern), `0646` initplan rule.
**Restated functions: none.** Later lane branches restate `mrq_submit` (1332), `create_procurement_with_items` (1351) and the match-line recorders (1357), so none of those, nor `mrq_decide_step`, `mrq_set_chain` or `mrq_waiting_for_me`, is re-created here; behaviour attaches by triggers on `material_requests` and new functions.

## Decisions
- Separate book; the ledger, `stock_balances`, `stock_write_entry` and `get_stock_on_hand` are not touched. Free is computed on read.
- Consumption by an AFTER UPDATE trigger on `material_requests` when status becomes `approved` (no edit to `mrq_decide_step`).
- Borrowing step = a row appended to the round's `material_request_steps` by an AFTER UPDATE trigger on submit (last position), role and label from org settings; shipped step rules apply to it as to any step.

## Migrations
1. **`1315_stock_reservations.sql`** - `organizations.stock_reservations boolean not null default false`, `reservation_borrow_mode text not null default 'approve' check in ('approve','warn')`, `reservation_borrow_role public.user_role null`, `reservation_borrow_label text null check (length(btrim(...)) between 1 and 80)`.
   Table `stock_reservations` (id, org_id, work_order_id, item_id, warehouse_id, quantity numeric(18,4) > 0, consumed_qty, released_qty, `check (consumed_qty + released_qty <= quantity)` `mut:rsv_overdraw`,
   status `active|released|expired|consumed`, expires_on date null, note, created_by, created_at, client_request_id; partial unique index on (org_id, work_order_id, item_id, warehouse_id) where status = 'active';
   unique (org_id, created_by, client_request_id)). Table `stock_reservation_events` (append-only: reservation_id, action, qty, request_id null, actor_id, reason, created_at) with the
   `guard_*_append_only` trigger. RLS enabled and forced, member-only select with `(select auth_org_id())` and `(select is_active_member())`; all client writes revoked; stamp-org triggers; `stock_reservations_on(org)` helper.
2. **`1316_stock_reservation_rpcs.sql`** - `reserve_stock`, `release_reservation`, `release_stale_reservations`, `set_stock_reservations(on, mode, role, label)` (Admin, standalone, `log_audit('stock.reservations')`),
   internal `rsv_free(org, item, warehouse)` and `rsv_active(...)` (decisions 2-3). Advisory lock `rsv:<org>:<item>:<warehouse>` in `reserve_stock` (`mut:rsv_exceeds_free`, `mut:rsv_perm`, `mut:rsv_off`).
3. **`1317_stock_free_reserved_read.sql`** - `get_stock_free_reserved(p_warehouse_id, p_item_id)` stable definer (`mut:rsv_org`), jsonb as spec decision 10; returns `[]` while off.
4. **`1318_mrq_borrowing.sql`** - `material_requests.borrowing boolean not null default false`; lines `reserved_use_qty`, `borrowed_qty` numeric default 0; `rsv_split_line(org, work_order, item, qty, exclude_request)`
   (decision 5a); trigger `rsv_borrow_on_submit` AFTER UPDATE on `material_requests` when `new.status = 'pending' and old.status = 'draft'` (no-op while off): splits lines, marks `borrowing`, and in `approve` mode inserts the last
   `material_request_steps` row (`mut:rsv_borrow_step`, `RSV_NO_BORROW_APPROVER`) with status `waiting`; trigger `rsv_consume_on_approval` AFTER UPDATE when `new.status = 'approved' and old.status = 'pending'`: recheck
   (`mut:rsv_borrow_recheck`, `RSV_BORROW_CHANGED`), consume own then lend (`mut:rsv_consume`). Both `security definer`, org-bounded. Must be proven to fire under the latest lane `mrq_submit` (1332): they depend only on the status transition.
5. **`1319_stock_reservation_hardening.sql`** - reserved for review fixes (deferred check that no reservation's consumed + released exceeds quantity; none if unused, then the number stays unused).

Rollbacks drop in reverse; `mrq_submit` and `mrq_set_chain` rollbacks restore the head bodies.

## Tests (written now, run by the orchestrator)
- pgTAP `supabase/tests/1315_stock_reservations.test.sql` (AC-001..007, 015), `1318_mrq_borrowing.test.sql` (AC-008..014, 016 smoke); existing material-request and stock files re-run unedited.
- Inventories: `supabase/tests/inventory/anon-executable-definers/2693-reservations.txt` (client-callable definers), `scripts/isolation-probe-denominator.d/2693-reservations.json` (both tables, helper definers).
- Vitest: `pmo-portal/src/lib/db/stockReservations.test.ts`, `pmo-portal/pages/stock/StockOnHand.reservations.test.tsx`, `StockReservationForm.test.tsx`, `StockReservationSettings.test.tsx`, request screen test for the borrowed badge (AC-003, 017).
- E2E `pmo-portal/e2e/AC-RSV-018-reservation-borrow.spec.ts` (AC-018).

## Frontend (all behind the setting; shared primitives, DESIGN.md tokens, `useXxxText` pattern like `materialRequests/useMaterialRequestText.ts`)
- `pmo-portal/src/lib/db/stockReservations.ts` (+ repository entry `src/lib/repositories/stockReservations.ts`; `can()` actions `stock.reserve`, `stock.reservation.settings` in `src/auth/policy.ts`).
- `pmo-portal/pages/stock/StockOnHand.tsx`: when on, "x free + y reserved" and a one-tap sheet (new `StockReservationList.tsx`); `StockReservationForm.tsx` (EntityFormModal); settings card
  `StockReservationSettings.tsx` in Stock setup beside `StockTransferSettings.tsx`; `WorkOrderStockBalance.tsx` shows the work order's reservations; `MaterialRequestNew/Detail.tsx` show borrowed quantity and step;
  `MaterialRequestSettings.tsx` gets the "only when borrowing" step toggle. Strings English and Bahasa Indonesia.
- Phone (390) and desktop (1440) screenshots are taken by the orchestrator at integration (gate change); paths `docs/evidence/1215/2693/`.

## Traceability
Each AC above is owned at the layer in the spec table; glossary adds: reservation, free stock, borrowing. No ADR (no irreversible or cross-cutting choice beyond OD-SCOPE-9).
