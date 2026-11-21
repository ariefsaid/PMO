# Two-step transfer with recount and handover confirmation: Implementation Plan (#2690)

Spec: `docs/specs/stock-two-step-transfer.spec.md`. Money path (stock ledger): ships alone, stacked on #2683 (migration 1300). Read first:
`supabase/migrations/0413_stock_posting_engine.sql` (`stock_write_entry`, `stock_apply_transfer`, `stock_lock_for_document`, `stock_insert_lines`),
`1029_stock_site_work_locations_tags.sql`, `1030_stock_document_files.sql` (bucket and policy pattern), `1300_stock_vendor_location.sql`,
`0416_stock_adjust_count.sql` (adjustment apply), `0360` (org setting RPC pattern), `1101_mrq_destination_kinds.sql`.

## Decisions
- **Engine untouched.** `stock_write_entry`, `stock_apply_transfer`, `stock_post_core`, `stock_validate_payload` are not edited. Each step is an
  ordinary transfer document (kind `transfer`, Posted) written by one new internal function `stock_post_leg` that inserts the Draft,
  calls `stock_insert_lines`, `stock_lock_for_document`, `stock_apply`, then flips it Posted (the same sequence as `stock_post_core`
  minus the keeper and paper checks, which the two-step RPCs do themselves). The ledger invariants therefore come from the engine.
- A per-transfer `transit` location (one `stock_warehouses` row, system-written) keeps value carried exactly and keeps total quantity
  and value conserved across locations at every step.
- Link: `stock_documents.two_step_id` (nullable, references `stock_transfers`). A one-step transfer has it null.
- Settings: `organizations.stock_transfer_mode`, `stock_tags.proof_required`, `stock_items.needs_quality_check`.
- Photos: new private bucket `stock-handover`, same shape as `stock-documents` (1030): `{org}/{transfer}/{confirmation}/{file}`, org-prefix
  policy, a definer readability helper, an object-must-exist guard trigger. The client uploads first (confirmation id generated client side),
  then the RPC links the paths.
- Reuse the Admin override pattern (`stock.self_receive` audit, like `stock.admin_post`) and `log_audit`.

## Migrations (numbers 1305-1309 only; rollbacks in `supabase/migrations/rollback/<n>_..._down.sql`)
1. **`1305_stock_two_step_settings.sql`**
   - `organizations.stock_transfer_mode text not null default 'one_step' check in ('one_step','two_step')`; `stock_transfer_mode_of(org)` stable definer;
     `set_stock_transfer_mode(text)` Admin only (rank >= 50), with the FR-TST-002 refusals (the refusal queries reference tables created in 1306, so
     they are written with dynamic existence via a small helper `stock_two_step_blockers(org)` replaced in 1306; here it returns none).
   - `stock_warehouses.kind` check adds `transit`; shape check: a transit location has no project and no vendor company;
     `guard_stock_transit_location` trigger (before insert or update of kind): only when GUC `pmo.stock_system_write = 'on'` (set locally by the send RPC) (`-- mut:transit_system_only`);
     trigger on `stock_documents` (before insert or update): a transit location in `warehouse_id` or `to_warehouse_id` only on kind transfer or the write-off adjustment, set by the RPCs.
   - `stock_items.needs_quality_check boolean not null default false` + insert/update column grants.
   - `stock_tags.proof_required text not null default 'none' check in ('none','paper','confirmation','either')`; backfill `paper` where `paper_required`;
     `sync_stock_tag_proof` before insert or update trigger (FR-TST-050); `stock_tags_proof_needs_zero_cost` generalises nothing: the 1029 check stays;
     `guard_stock_tag_proof_mode` refuses confirmation/either while org is one_step; grants insert/update (proof_required).
   - Audit trigger `audit_stock_tag` (1029) is left as is; proof change audited by a second small trigger.
2. **`1306_stock_transfers.sql`**
   - `stock_transfers` (id, org_id, number, from_warehouse_id, to_warehouse_id, transit_warehouse_id, work_order_id, to_user_id, note, status in
     Sent/Received/Closed/Cancelled, sent_by, sent_at, received_by, received_at, cancelled_by/at/reason, send_document_id, constraints on status shape), unique (org_id, number).
   - `stock_transfer_lines` (id, org_id, transfer_id, line_no, item_id, qty_sent, qty_counted, qty_accepted, qty_rejected, reject_reason, quality_result, short_resolution
     in delivered/returned/written_off, short_resolved_by/at, short_reason; check: counted <= sent, accepted + rejected = counted, all >= 0, quality fail => accepted = 0 `-- mut:accept_sum`, `-- mut:count_cap`).
   - `stock_documents.two_step_id`; `guard_stock_document_one_step` (before insert or update of status): kind transfer, two_step_id null, status Posted,
     org mode two_step -> `STK_TWO_STEP` (`-- mut:one_step_block`).
   - RLS: select for active members of the org; no client write grants (RPC only); `force row level security`; `(select auth_org_id())` wrappers; append-only guard on received counts.
   - Replace `stock_two_step_blockers(org)` now that the tables exist.
   - View `stock_transit_reconciliation` (security_invoker): per transit location and item, ledger balance vs outstanding (sent - accepted - rejected - resolved short).
3. **`1307_stock_handover_confirmations.sql`**
   - `stock_handover_confirmations` (id, org_id, transfer_id, stage send/receive, proof_type in_app/paper, signer_kind account/guest, signer_name, signer_user_id,
     recorded_by default auth.uid(), confirmed_at default now(), counts jsonb, goods_photo_path, signer_photo_path, paper_photo_path; shape check: in_app needs the two photos, paper needs paper photo;
     guest name 2-120 chars `-- mut:guest_name`); RLS select; no client write; append-only trigger (`-- mut:confirm_immutable`).
   - Bucket `stock-handover` (private, 5 MB, pdf/png/jpeg/webp), policies (read via `stock_handover_readable`, insert via `stock_can_handover`), guard trigger requiring the object (`STK_FILE_MISSING`), delete guard for linked objects.
4. **`1308_stock_two_step_rpcs.sql`** (all definer, `set search_path = public`, `(select ...)` wrappers; client RPCs granted to authenticated only)
   - internal: `stock_post_leg(transfer, from, to, lines jsonb, work_order)`, `stock_transfer_proof_met(transfer, stage_needed)`, `stock_assert_transfer_actor(...)`.
   - `send_stock_transfer(p_header jsonb, p_lines jsonb, p_draft_id uuid default null, p_confirmation jsonb default null, p_client_request_id uuid default null) returns uuid`
   - `receive_stock_transfer(p_transfer uuid, p_lines jsonb, p_confirmation jsonb default null) returns void` (self-receive `-- mut:self_receive`, proof `-- mut:proof_check`, quality `-- mut:quality_fail`)
   - `recall_stock_transfer(p_transfer uuid, p_reason text)`; `resolve_stock_transfer_shortfall(p_line uuid, p_resolution text, p_reason text)` (`-- mut:writeoff_admin`)
   - All refuse `STK_OWNED_BY_ERP` (`stock_assert_standalone`) and `STK_TWO_STEP_OFF`; idempotent on `p_client_request_id`; lock order: transfer row, then `stock_lock_for_document`.
5. **`1309_stock_proof_status_and_reorder.sql`**
   - `get_stock_movement_proof_status(p_only_missing boolean default false, p_from date default null, p_to date default null)` returns table (definer, `assert_is_active_member`, org-scoped, stable).
   - `create or replace get_reorder_suggestions` (copy 1300's body; the `dw.kind in (...)` clause reads the transfer's final destination kind when the leg's destination is a transit location).
   - `get_stock_on_hand` is not edited (it already returns `warehouse_kind`).
   - Inventory fragment `supabase/tests/inventory/anon-executable-definers/2690_two_step_transfer.txt` (the client-callable functions) and isolation fragment under `scripts/isolation-probe-denominator.d/` (read both script headers first).

## Tests (written first; run by the orchestrator on the integration branch)
- pgTAP `supabase/tests/1305_stock_two_step_settings.test.sql`: AC-TST-001, 002, 017, 019.
- pgTAP `supabase/tests/1306_stock_two_step_transfer.test.sql`: AC-TST-003..014, 018, 021 (fixtures as `stock_site_work.test.sql`: two orgs, central + site + yard, items incl. zero-cost and flagged, keepers, Admin).
- pgTAP `supabase/tests/1307_stock_handover_confirmations.test.sql`: AC-TST-015, 016, 018 (photo objects inserted into `storage.objects` by the fixture, as 1030's test does), 022 (isolation).
- pgTAP `supabase/tests/1309_stock_movement_proof_status.test.sql`: AC-TST-020, 021.
- Unit: `pmo-portal/pages/stock/StockTransferSend.test.tsx` (023), `StockTransferReceive.test.tsx` (024), `src/components/stock/HandoverCapture.test.tsx` (025), `StockSetup.twoStep.test.tsx` (026, new file; existing untouched), `StockMovementForm.oneStep.test.tsx` (027), `src/lib/db/stockTransfers.test.ts` (DAL mapping and error classes).
- E2E `pmo-portal/e2e/AC-TST-028-two-step-transfer-phone.spec.ts` (phone viewport, new; `@e2e-isolation` per `docs/e2e-parallel-conventions.md`; fixtures in `e2e/support/stockFixture.ts` widened only additively).
- Mutation checks: the `-- mut:` marker names in spec section 7; add each to `scripts/stock-mutation-proof.mjs`'s list the way 1300's were (read its header first).

## Front end
- DAL `pmo-portal/src/lib/db/stockTransfers.ts` + repository entry in `src/lib/repositories/stock.ts` (send, receive, recall, resolve, list, get, proof status, handover upload). Photo upload helper follows `StockDocumentAttachments.tsx` and the attendance photo capture (read both); `<input type="file" accept="image/*" capture>`.
- Pages (phone first, `restructure` skill, DESIGN.md tokens, shared form primitives): `pages/stock/StockTransfers.tsx` (list in three groups: In transit, Short, Closed), `StockTransferSend.tsx`, `StockTransferDetail.tsx` (receive form, shortfall resolution, confirmations), component `src/components/stock/HandoverCapture.tsx` (name, two photos, guest toggle "Signing on someone else's phone"). Routes in `pmo-portal/App.tsx`, nav gated by mode and `can()`; policy entries in `src/auth/policy.ts` (UX only, RLS and RPC enforce).
- `StockMovementForm.tsx`: when mode two_step and kind transfer, the primary action is "Send" and calls the send RPC; one-step unchanged.
- `StockSetup.tsx`: mode switch (Admin), `StockTagsPanel.tsx` proof select (replaces the paper checkbox label, same data), item form quality-check toggle. Hidden when inventory is ERP-connected.
- `StockOnHand.tsx`: a "In transit" group for transit rows; location pickers filter kind `transit`.
- Strings: `public/locales/{en,id}/stock.json` keys under `transfers.*`, `handover.*`, `setup.mode.*`, `setup.proof.*`, `setup.item.qualityCheck`. Types hand-updated in `src/lib/supabase/database.types.ts`.
- Glossary: **Two-step transfer**, **In transit**, **Shortfall**, **Handover confirmation** (extends *Handover proof*), **Proof rule**. No ADR: the transit-location choice is recorded in the spec (reversible, additive).
- Screenshots (send, receive with short, handover capture with guest) phone 390 and desktop 1440 at 2x under `docs/evidence/1215/2690/` (taken by the orchestrator wave under the gate change).

## Gate commands (builder, no database)
`npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <touched>`, `npx vitest run <new and touched test files>`.

## Risks to watch in phase 2
- Material-request draft transfers (1001/1101) read the draft's destination and work order; sending in place moves `to_warehouse_id`: check 1100's "prior quantity posted" read still matches.
- `check_cost_attribution` runs on the leg that reaches a site/yard/staging destination only; the send leg never names a work order.
- Archiving a transit location must pass the stock-guard (balance zero) and the `STK_ARCHIVED` check in later posts.
