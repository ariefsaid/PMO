-- 0276_payments_recorded_by.sql — #910 (DD-VPAY-9, FR-VPAY-009, AC-VPAY-007).
-- `payments.recorded_by_id` — the payer-attribution stamp. On an ERP-connected org the payment row
-- IS the pay artifact (the dispatched Payment Entry mirrors here), so an unattributed money release
-- is an audit gap (money-path primer bucket 3 — separation of duties/attribution; the SI
-- author-set precedent, 0132). The served mirror writer (`upsertPaymentMirror`) stamps it from the
-- dispatch caller (`ctx.callerUserId`, the verified JWT sub) on the CREATE path only; machine writes
-- (sweep finalize/replay, cancel tombstones) stay null, and no UPDATE path ever rewrites it.
--
-- No client write path exists to forge it: `payments` carries NO direct client write grant
-- (0100:6-10; 0058 revoked insert/update/delete; 0075 grants select/references/trigger/truncate
-- only) — its only writers are the `create_payment` SECURITY DEFINER RPC (native path, unaffected:
-- the column is nullable with no default, so the RPC's insert simply leaves it null) and the
-- service-role mirror writer. No grant, RLS or RPC-signature change ships here.
--
-- Reversibility (ADR-0006): `rollback/0276_payments_recorded_by_down.sql` restores the
-- `record_history_config` classification and drops the column.
--
-- ⚑ Migration slot: 0276 is a placeholder — renumber at merge via `scripts/renumber-migration.sh`.

alter table public.payments
  add column if not exists recorded_by_id uuid references public.profiles(id);

-- `payments` is a tracked table (0260 record_history_config, entity 'payment'); the catalog gate
-- (record_changes_catalog_gate.test.sql) requires every column of a tracked table classified exactly
-- once. The payer identity is record content — classified CAPTURED as a ref, the same treatment as
-- `requested_by_id`/`vendor_id` — so the history shows who recorded each payment. Table-level SELECT
-- is already granted to authenticated (0075), so no grant change rides along.
update public.record_history_config
   set captured = captured || jsonb_build_object('recorded_by_id', 'ref')
 where entity_type = 'payment'
   and not (captured ? 'recorded_by_id');

notify pgrst, 'reload schema';
