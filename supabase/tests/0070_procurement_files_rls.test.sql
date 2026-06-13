-- 0070_procurement_files_rls.test.sql — RLS on the 3 per-phase procurement file child tables.
--   AC-PF-001  in-org PM can insert a quotation-file row (org_id from default + uploaded_by stamped)
--   AC-PF-002  cross-org user sees 0 file rows (RLS read denial)
--   AC-PF-003  Engineer (non-writer) insert → 42501 (4-role write gate)
--   AC-PF-004  PM inserting a file whose parent quotation is in another org → denied (parent-org guard)
--   AC-PF-005  deleting the parent quotation cascades — its file rows are gone
--   AC-PF-011  in-org NON-WRITER (Engineer) CAN list file rows — deliberate org-wide SELECT
--              parity with the parent `procurements_select` (file metadata is no more sensitive
--              than the procurement rows in-org users already read)
begin;
select plan(6);

-- Fixtures (two orgs, inserted as table owner — bypasses RLS).
insert into organizations (id, name) values
  ('00700000-0000-0000-0000-000000000001','Proc-File Org A'),
  ('00700000-0000-0000-0000-000000000002','Proc-File Org B');

insert into auth.users (id, email) values
  ('00700000-0000-0000-0000-0000000000a1','pf-pm-a@example.com'),
  ('00700000-0000-0000-0000-0000000000a2','pf-eng-a@example.com'),
  ('00700000-0000-0000-0000-0000000000b1','pf-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00700000-0000-0000-0000-0000000000a1','00700000-0000-0000-0000-000000000001','PF PM A','pf-pm-a@example.com','Project Manager'),
  ('00700000-0000-0000-0000-0000000000a2','00700000-0000-0000-0000-000000000001','PF Eng A','pf-eng-a@example.com','Engineer'),
  ('00700000-0000-0000-0000-0000000000b1','00700000-0000-0000-0000-000000000002','PF PM B','pf-pm-b@example.com','Project Manager');

-- Vendor companies (procurement_quotations.vendor_id is NOT NULL).
insert into companies (id, org_id, name, type) values
  ('00700000-0000-0000-0000-000000000050','00700000-0000-0000-0000-000000000001','PF Vendor A','Vendor'),
  ('00700000-0000-0000-0000-000000000051','00700000-0000-0000-0000-000000000002','PF Vendor B','Vendor');

-- Org-A procurement + quotation (the valid in-org parent).
insert into procurements (id, org_id, title, status) values
  ('00700000-0000-0000-0000-000000000010','00700000-0000-0000-0000-000000000001','PF Proc A','Vendor Quoted');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date) values
  ('00700000-0000-0000-0000-000000000020','00700000-0000-0000-0000-000000000001',
   '00700000-0000-0000-0000-000000000010','00700000-0000-0000-0000-000000000050', 1000, '2026-01-01');

-- Org-B procurement + quotation (the cross-org parent for the parent-org guard test).
insert into procurements (id, org_id, title, status) values
  ('00700000-0000-0000-0000-000000000011','00700000-0000-0000-0000-000000000002','PF Proc B','Vendor Quoted');
insert into procurement_quotations (id, org_id, procurement_id, vendor_id, total_amount, received_date) values
  ('00700000-0000-0000-0000-000000000021','00700000-0000-0000-0000-000000000002',
   '00700000-0000-0000-0000-000000000011','00700000-0000-0000-0000-000000000051', 2000, '2026-01-01');

-- ── AC-PF-001: in-org PM can insert a quotation-file row ─────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00700000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into procurement_quotation_files (quotation_id, title, file_path, uploaded_by_id)
     values ('00700000-0000-0000-0000-000000000020', 'Quote PDF',
             '00700000-0000-0000-0000-000000000001/00700000-0000-0000-0000-000000000010/quotation/00700000-0000-0000-0000-000000000099/q.pdf',
             '00700000-0000-0000-0000-0000000000a1') $$,
  'AC-PF-001: in-org PM can insert a procurement_quotation_files row (org_id default + parent-org guard)');

-- ── AC-PF-004: PM inserting a file whose parent quotation is in org-B → denied ─
-- org_id defaults to the PM's org (A) but the parent quotation belongs to org-B → parent-org guard rejects.
select throws_ok(
  $$ insert into procurement_quotation_files (quotation_id, title)
     values ('00700000-0000-0000-0000-000000000021', 'Cross-org graft') $$,
  '42501', null,
  'AC-PF-004: PM inserting a file onto an org-B parent quotation rejected (parent-org guard 42501)');

reset role;

-- ── AC-PF-002: cross-org PM-B sees 0 file rows ──────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00700000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select results_eq(
  $$ select count(*)::int from procurement_quotation_files $$,
  $$ values (0) $$,
  'AC-PF-002: cross-org PM-B sees 0 procurement_quotation_files rows (RLS read denial)');
reset role;

-- ── AC-PF-003: Engineer (non-writer) insert → 42501 (4-role write gate) ──────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00700000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ insert into procurement_quotation_files (quotation_id, title)
     values ('00700000-0000-0000-0000-000000000020', 'Eng attempt') $$,
  '42501', null,
  'AC-PF-003: Engineer direct INSERT into procurement_quotation_files blocked (4-role write gate 42501)');

-- ── AC-PF-011: in-org NON-WRITER (Engineer A) CAN list the file row ─────────
-- Same JWT (Engineer A, org A). The SELECT policy is org-wide (org_id = auth_org_id()) in
-- DELIBERATE parity with the parent procurements_select — a non-writer who can see the
-- procurement can list its files. The AC-PF-001 insert left exactly one row.
select results_eq(
  $$ select count(*)::int from procurement_quotation_files
     where quotation_id = '00700000-0000-0000-0000-000000000020' $$,
  $$ values (1) $$,
  'AC-PF-011: in-org Engineer (non-writer) CAN list procurement_quotation_files rows (org-wide SELECT parity with parent procurement)');
reset role;

-- ── AC-PF-005: deleting the parent quotation cascades to its file rows ───────
-- Delete the parent (as table owner, bypassing RLS) then confirm the child rows are gone.
delete from procurement_quotations where id = '00700000-0000-0000-0000-000000000020';
select results_eq(
  $$ select count(*)::int from procurement_quotation_files where quotation_id = '00700000-0000-0000-0000-000000000020' $$,
  $$ values (0) $$,
  'AC-PF-005: deleting the parent quotation cascades — its file rows are deleted');

select finish();
rollback;
