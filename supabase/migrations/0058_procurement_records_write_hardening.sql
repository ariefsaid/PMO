-- 0058_procurement_records_write_hardening.sql
-- AUDIT-H1 (2026-07-04 seven-dimension audit, Security H-1) — procurement record forgery /
-- destructive-delete residual of the RED-3/RED-4 class.
--
-- VULNERABILITY: the four ERP-canonical record tables (purchase_requests / rfqs /
-- purchase_orders / payments, migration 0035) carry bare 4-role `for all` write policies with
-- table-wide default grants. Every legitimate write goes through SECURITY DEFINER RPCs
-- (create_purchase_request / create_rfq / create_purchase_order / create_payment, 0037;
-- transition_procurement record-writes, 0038) — but a 4-role insider could bypass them via raw
-- PostgREST to: forge `amount`, flip `status`, re-mint `pr_number`-class doc numbers, or
-- hard-DELETE payment evidence. The seven *_files tables (0028/0036) additionally allowed any
-- write-role to hard-DELETE file evidence rows (soft-archive via archived_at is the only legit
-- "remove" flow; no FE hard-delete path exists).
--
-- LEGIT-USAGE FINDING (verified before locking down): NO client path INSERTs/UPDATEs/DELETEs the
-- four record tables directly — src/lib/db/procurementRecords.ts + procurementLifecycle.ts are
-- RPC-only. So the strongest, simplest fix applies: revoke the client write grants entirely
-- (RPC-only writes by construction). SECURITY DEFINER RPCs execute with the function OWNER's
-- privileges, so they are unaffected by revoking `authenticated`'s table grants.
--
-- FIX:
--   1. Revoke INSERT/UPDATE/DELETE on the 4 record tables from authenticated + anon (SELECT stays).
--   2. CHECK (amount >= 0) on all 4 record tables — belt over the RPC layer for money columns.
--   3. Restrictive Admin-only DELETE policy on the 7 procurement *_files tables (mirrors
--      0052 projects_delete_admin_only / 0017 project_documents_delete_admin_only). INSERT/UPDATE
--      (upload-confirm, soft-archive) are unaffected; org guard still rides the permissive policy.
--
-- Reversibility (ADR-0006, pre-production): `supabase db reset`. Manual rollback:
--   grant insert, update, delete on purchase_requests, rfqs, purchase_orders, payments to authenticated;
--   alter table purchase_requests drop constraint purchase_requests_amount_nonneg;  (×4 tables)
--   drop policy <table>_delete_admin_only on <each *_files table>;

-- ── 1. Record tables: RPC-only writes (revoke client write grants; SELECT unaffected) ──
revoke insert, update, delete on purchase_requests from authenticated, anon;
revoke insert, update, delete on rfqs              from authenticated, anon;
revoke insert, update, delete on purchase_orders   from authenticated, anon;
revoke insert, update, delete on payments          from authenticated, anon;

-- ── 2. Money columns: non-negative (NULL allowed — amount is an optional field on all four) ──
alter table purchase_requests add constraint purchase_requests_amount_nonneg check (amount is null or amount >= 0);
alter table rfqs              add constraint rfqs_amount_nonneg              check (amount is null or amount >= 0);
alter table purchase_orders   add constraint purchase_orders_amount_nonneg   check (amount is null or amount >= 0);
alter table payments          add constraint payments_amount_nonneg          check (amount is null or amount >= 0);

-- ── 3. File-evidence tables: hard-DELETE is Admin-only (soft-archive stays the user flow) ──
create policy procurement_quotation_files_delete_admin_only on procurement_quotation_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy procurement_receipt_files_delete_admin_only on procurement_receipt_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy procurement_invoice_files_delete_admin_only on procurement_invoice_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy purchase_request_files_delete_admin_only on purchase_request_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy rfq_files_delete_admin_only on rfq_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy purchase_order_files_delete_admin_only on purchase_order_files
  as restrictive for delete using (auth_role() = 'Admin');
create policy payment_files_delete_admin_only on payment_files
  as restrictive for delete using (auth_role() = 'Admin');
