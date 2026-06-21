-- 0078_procurement_record_files_rls.test.sql — RLS + multi-file + storage path/org gate for the
-- 4 per-record procurement file tables (purchase_request_files, rfq_files, purchase_order_files,
-- payment_files) introduced in migration 0036.
--
--   AC-PR-007  four file tables exist with required columns (id, org_id, parent FK on delete cascade,
--              title, file_path, uploaded_by_id, created_at, archived_at)
--   AC-PR-008  two purchase_request_files rows attach to one PR record; both persist (count = 2)
--   AC-PR-010  storage write policy (storage_objects_proc_file_write, 0028 §5) already admits the
--              new record-type path segment unchanged:
--                • in-org writer + segment-3 = 'purchase_order' → lives_ok
--                • segment-1 = org-B path by org-A user  → 42501
--                • segment-2 = out-of-org procurement    → 42501
--              Also proves cross-org file-row INSERT (parent-org guard) → 42501, and explicit
--              org-B org_id override on each of the four new file tables → 42501 (mirrors 0070
--              AC-PROCFILE-ORG-OVERRIDE).
begin;
select plan(24);

-- ── Fixtures (two orgs, inserted as table owner — bypasses RLS) ───────────────
insert into organizations (id, name) values
  ('00780000-0000-0000-0000-000000000001','RecFile Org A'),
  ('00780000-0000-0000-0000-000000000002','RecFile Org B');

insert into auth.users (id, email) values
  ('00780000-0000-0000-0000-0000000000a1','rf-pm-a@example.com'),
  ('00780000-0000-0000-0000-0000000000a2','rf-eng-a@example.com'),
  ('00780000-0000-0000-0000-0000000000b1','rf-pm-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00780000-0000-0000-0000-0000000000a1','00780000-0000-0000-0000-000000000001','RF PM A','rf-pm-a@example.com','Project Manager'),
  ('00780000-0000-0000-0000-0000000000a2','00780000-0000-0000-0000-000000000001','RF Eng A','rf-eng-a@example.com','Engineer'),
  ('00780000-0000-0000-0000-0000000000b1','00780000-0000-0000-0000-000000000002','RF PM B','rf-pm-b@example.com','Project Manager');

-- Org-A procurement (in-org parent for storage and row tests).
insert into procurements (id, org_id, title, status) values
  ('00780000-0000-0000-0000-000000000010','00780000-0000-0000-0000-000000000001','RF Proc A','Requested');

-- Org-B procurement (cross-org parent for storage segment-2 rejection test).
insert into procurements (id, org_id, title, status) values
  ('00780000-0000-0000-0000-000000000011','00780000-0000-0000-0000-000000000002','RF Proc B','Requested');

-- Record rows (as table owner, explicit org_id to avoid trigger dependence on seed-org default).
insert into purchase_requests (id, org_id, procurement_id, status) values
  ('00780000-0000-0000-0000-000000000020','00780000-0000-0000-0000-000000000001',
   '00780000-0000-0000-0000-000000000010','Draft');
insert into rfqs (id, org_id, procurement_id, status) values
  ('00780000-0000-0000-0000-000000000021','00780000-0000-0000-0000-000000000001',
   '00780000-0000-0000-0000-000000000010','Draft');
insert into purchase_orders (id, org_id, procurement_id, status) values
  ('00780000-0000-0000-0000-000000000022','00780000-0000-0000-0000-000000000001',
   '00780000-0000-0000-0000-000000000010','Draft');
insert into payments (id, org_id, procurement_id, status) values
  ('00780000-0000-0000-0000-000000000023','00780000-0000-0000-0000-000000000001',
   '00780000-0000-0000-0000-000000000010','Scheduled');

-- Org-B record (for cross-org parent-org guard test).
insert into purchase_requests (id, org_id, procurement_id, status) values
  ('00780000-0000-0000-0000-000000000024','00780000-0000-0000-0000-000000000002',
   '00780000-0000-0000-0000-000000000011','Draft');

-- ── AC-PR-007: four file tables exist with required columns ──────────────────
-- purchase_request_files
select has_column('public','purchase_request_files','id',           'AC-PR-007 purchase_request_files.id exists');
select has_column('public','purchase_request_files','org_id',       'AC-PR-007 purchase_request_files.org_id exists');
select has_column('public','purchase_request_files','purchase_request_id','AC-PR-007 purchase_request_files.purchase_request_id exists');
select has_column('public','purchase_request_files','title',        'AC-PR-007 purchase_request_files.title exists');
select has_column('public','purchase_request_files','file_path',    'AC-PR-007 purchase_request_files.file_path exists');
select has_column('public','purchase_request_files','uploaded_by_id','AC-PR-007 purchase_request_files.uploaded_by_id exists');
select has_column('public','purchase_request_files','created_at',   'AC-PR-007 purchase_request_files.created_at exists');
select has_column('public','purchase_request_files','archived_at',  'AC-PR-007 purchase_request_files.archived_at exists');
-- rfq_files
select has_column('public','rfq_files','rfq_id',        'AC-PR-007 rfq_files.rfq_id exists');
select has_column('public','rfq_files','archived_at',   'AC-PR-007 rfq_files.archived_at exists');
-- purchase_order_files
select has_column('public','purchase_order_files','purchase_order_id','AC-PR-007 purchase_order_files.purchase_order_id exists');
select has_column('public','purchase_order_files','archived_at',   'AC-PR-007 purchase_order_files.archived_at exists');
-- payment_files
select has_column('public','payment_files','payment_id',   'AC-PR-007 payment_files.payment_id exists');
select has_column('public','payment_files','archived_at',  'AC-PR-007 payment_files.archived_at exists');

-- FK on-delete-cascade: purchase_request_files.purchase_request_id → purchase_requests
select fk_ok('public','purchase_request_files','purchase_request_id','public','purchase_requests','id',
  'AC-PR-007 purchase_request_files.purchase_request_id FK → purchase_requests.id');

-- ── AC-PR-008: two purchase_request_files rows under one PR record both persist ─
-- Insert two file rows as table owner (bypasses RLS).
insert into purchase_request_files (purchase_request_id, title, file_path, uploaded_by_id, org_id) values
  ('00780000-0000-0000-0000-000000000020','PR Spec PDF','00780000-0000-0000-0000-000000000001/00780000-0000-0000-0000-000000000010/purchase_request/00780000-0000-0000-0000-000000000091/pr.pdf',
   '00780000-0000-0000-0000-0000000000a1','00780000-0000-0000-0000-000000000001'),
  ('00780000-0000-0000-0000-000000000020','PR Budget XLS','00780000-0000-0000-0000-000000000001/00780000-0000-0000-0000-000000000010/purchase_request/00780000-0000-0000-0000-000000000092/budget.xlsx',
   '00780000-0000-0000-0000-0000000000a1','00780000-0000-0000-0000-000000000001');

select results_eq(
  $$ select count(*)::int from purchase_request_files
     where purchase_request_id = '00780000-0000-0000-0000-000000000020' $$,
  $$ values (2) $$,
  'AC-PR-008: two purchase_request_files rows under one PR record both persist (count = 2)');

-- ── AC-PR-010 (storage): in-org writer with new record-type path segment (purchase_order) → lives_ok ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00780000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'procurement-files',
         '00780000-0000-0000-0000-000000000001/00780000-0000-0000-0000-000000000010/purchase_order/00780000-0000-0000-0000-0000000000c1/po.pdf',
         '00780000-0000-0000-0000-0000000000a1') $$,
  'AC-PR-010: in-org PM can write procurement-files object with segment-3=purchase_order (0028 write policy admits new record type)');

-- ── AC-PR-010 (storage): segment-1 = org-B path by org-A user → 42501 ────────
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'procurement-files',
         '00780000-0000-0000-0000-000000000002/00780000-0000-0000-0000-000000000010/purchase_order/00780000-0000-0000-0000-0000000000c2/po.pdf',
         '00780000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-PR-010: org-A user writing to org-B segment-1 path → 42501 (storage write policy)');

-- ── AC-PR-010 (storage): segment-2 = out-of-org procurement → 42501 ──────────
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name, owner)
       values (gen_random_uuid(), 'procurement-files',
         '00780000-0000-0000-0000-000000000001/00780000-0000-0000-0000-000000000011/purchase_order/00780000-0000-0000-0000-0000000000c3/po.pdf',
         '00780000-0000-0000-0000-0000000000a1') $$,
  '42501', null,
  'AC-PR-010: org-B procurement in segment-2 of org-A path → 42501 (segment-2 in-org proc guard)');

-- ── AC-PR-010 (row RLS): cross-org file row INSERT onto org-B parent → 42501 ─
-- org_id defaults → stamp-trigger reads from parent (org B), preserved → WITH CHECK rejects.
select throws_ok(
  $$ insert into purchase_request_files (purchase_request_id, title)
     values ('00780000-0000-0000-0000-000000000024','Cross-org graft') $$,
  '42501', null,
  'AC-PR-010: org-A PM inserting purchase_request_files onto org-B parent PR → 42501 (parent-org guard)');

reset role;

-- ── AC-PR-010 (org-override ×4): explicit org-B org_id on each new file table → 42501 ──
-- Mirror 0070 AC-PROCFILE-ORG-OVERRIDE. The stamp trigger preserves explicit cross-org org_id
-- so WITH CHECK (org_id = auth_org_id()) rejects it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00780000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into purchase_request_files (org_id, purchase_request_id, title)
     values ('00780000-0000-0000-0000-000000000002',
             '00780000-0000-0000-0000-000000000020','Org-override PR file') $$,
  '42501', null,
  'AC-PR-010: org-A PM supplying explicit org_id=org-B on purchase_request_files INSERT → 42501');

select throws_ok(
  $$ insert into rfq_files (org_id, rfq_id, title)
     values ('00780000-0000-0000-0000-000000000002',
             '00780000-0000-0000-0000-000000000021','Org-override RFQ file') $$,
  '42501', null,
  'AC-PR-010: org-A PM supplying explicit org_id=org-B on rfq_files INSERT → 42501');

select throws_ok(
  $$ insert into purchase_order_files (org_id, purchase_order_id, title)
     values ('00780000-0000-0000-0000-000000000002',
             '00780000-0000-0000-0000-000000000022','Org-override PO file') $$,
  '42501', null,
  'AC-PR-010: org-A PM supplying explicit org_id=org-B on purchase_order_files INSERT → 42501');

select throws_ok(
  $$ insert into payment_files (org_id, payment_id, title)
     values ('00780000-0000-0000-0000-000000000002',
             '00780000-0000-0000-0000-000000000023','Org-override Payment file') $$,
  '42501', null,
  'AC-PR-010: org-A PM supplying explicit org_id=org-B on payment_files INSERT → 42501');

reset role;

select finish();
rollback;
