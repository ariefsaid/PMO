-- #1513 S3: AC-SCA-007 / FR-SCA-021 / NFR-SCA-002 — the per-PO lock is under test, in two real sessions (model: 0151_timesheet_fence_concurrency).
-- A second session (dblink) holds the PO's advisory lock; the capture must BLOCK on it (55P03 under lock_timeout).
-- Delete subcontract_po_lock from the capture and the first capture sails through instead.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(5);

-- F1: org A (multi-member), org B (other tenant), org S (sole member). Inserted as superuser, before `set local role`.
insert into organizations (id, name, default_currency) values
  ('15130000-0000-0000-0000-00000000000a', 'SCA Org',       'IDR'),
  ('15130000-0000-0000-0000-00000000000b', 'SCA Other Org', 'IDR'),
  ('15130000-0000-0000-0000-00000000000c', 'SCA Solo Org',  'IDR');
insert into auth.users (id, email) values
  ('15130000-0000-0000-0000-0000000000a1', 'sca-admin@example.com'),
  ('15130000-0000-0000-0000-0000000000a2', 'sca-fin1@example.com'),
  ('15130000-0000-0000-0000-0000000000a3', 'sca-fin2@example.com'),
  ('15130000-0000-0000-0000-0000000000a4', 'sca-pm@example.com'),
  ('15130000-0000-0000-0000-0000000000a5', 'sca-eng@example.com'),
  ('15130000-0000-0000-0000-0000000000a6', 'sca-exec@example.com'),
  ('15130000-0000-0000-0000-0000000000a7', 'sca-pm-off@example.com'),
  ('15130000-0000-0000-0000-0000000000a8', 'sca-fin-off@example.com'),
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
  ('15130000-0000-0000-0000-0000000000a7', '15130000-0000-0000-0000-00000000000a', 'SCA PM Off', 'sca-pm-off@example.com', 'Project Manager', 'disabled'),
  ('15130000-0000-0000-0000-0000000000a8', '15130000-0000-0000-0000-00000000000a', 'SCA Fin Off', 'sca-fin-off@example.com', 'Finance', 'disabled'),
  ('15130000-0000-0000-0000-0000000000b1', '15130000-0000-0000-0000-00000000000b', 'SCA XOrg',  'sca-xorg@example.com',  'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000c1', '15130000-0000-0000-0000-00000000000c', 'SCA Solo',  'sca-solo@example.com',  'Finance', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-00000000000a', 'SCA Site',  'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d2', '15130000-0000-0000-0000-00000000000a', 'SCA Site Two', 'Ongoing Project', '15130000-0000-0000-0000-0000000000a4'),
  ('15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-00000000000c', 'SCA Solo Site', 'Ongoing Project', null);
-- Client BoQ items: L1 (100 m3), L2 (50 m) on project d1; L9 on the solo project.
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15130000-0000-0000-0000-0000000000e1', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L1', 'Excavation', 'm3', 100, 150000),
  ('15130000-0000-0000-0000-0000000000e2', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L2', 'Piping',     'm',  50,  90000),
  ('15130000-0000-0000-0000-0000000000e9', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'L9', 'Solo work',  'ls', 10,  10000);
-- Subcontract purchase SP (Ordered, approved 12,000,000, Subcontractors line) and its PO.
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f1', '15130000-0000-0000-0000-00000000000a', 'SCA earthworks subcontract',
   '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 12000000, 12000000,
   '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f9', '15130000-0000-0000-0000-00000000000c', 'SCA solo subcontract',
   '15130000-0000-0000-0000-0000000000d9', '15130000-0000-0000-0000-0000000000c1', 'Ordered', 100000, null,
   null, 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-1', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000f9', 'PO-SCA-9', 'Issued', current_date, 'IDR');
-- Signed Berita Acara documents (Issued, with a file) on each project.
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('15130000-0000-0000-0000-000000000201', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'Acceptance', 'BA period 1', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d1/15130000-0000-0000-0000-000000000201/ba1.pdf'),
  ('15130000-0000-0000-0000-000000000202', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d2', 'Acceptance', 'BA other project', 'Issued',
   '15130000-0000-0000-0000-00000000000a/15130000-0000-0000-0000-0000000000d2/15130000-0000-0000-0000-000000000202/ba2.pdf'),
  ('15130000-0000-0000-0000-000000000209', '15130000-0000-0000-0000-00000000000c', '15130000-0000-0000-0000-0000000000d9', 'Acceptance', 'BA solo', 'Issued',
   '15130000-0000-0000-0000-00000000000c/15130000-0000-0000-0000-0000000000d9/15130000-0000-0000-0000-000000000209/ba9.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- F2: revision 1 of PO …101 (L1 100 m3 @ 100,000 + L2 50 m @ 40,000 = 12,000,000) and of PO …109 (L9 10 ls @ 10,000).
insert into purchase_order_lines (po_id, revision, boq_item_id, quantity, rate, unit) values
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e1', 100, 100000, 'm3'),
  ('15130000-0000-0000-0000-000000000101', 1, '15130000-0000-0000-0000-0000000000e2',  50,  40000, 'm'),
  ('15130000-0000-0000-0000-000000000109', 1, '15130000-0000-0000-0000-0000000000e9',  10,  10000, 'ls');
insert into purchase_order_revisions (po_id, procurement_id, revision, status, total, issued_by, issue_basis) values
  ('15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1', 1, 'Issued', 12000000, '15130000-0000-0000-0000-0000000000a4', 'standard'),
  ('15130000-0000-0000-0000-000000000109', '15130000-0000-0000-0000-0000000000f9', 1, 'Issued',   100000, '15130000-0000-0000-0000-0000000000c1', 'standard');

-- F3: append a Confirmed acceptance as superuser (immutability triggers fire on UPDATE/DELETE only).
create or replace function pg_temp.confirmed_acceptance(p_po uuid, p_l1 numeric, p_l2 numeric) returns uuid
language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into subcontract_acceptances (id, org_id, project_id, po_id, acceptance_date, status, prepared_by, confirmed_by,
                                       confirmed_at, confirm_basis, document_id)
  values (v, '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', p_po, current_date, 'Confirmed',
          '15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-0000000000a2', clock_timestamp(), 'standard',
          '15130000-0000-0000-0000-000000000201');
  insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e1', p_l1);
  if p_l2 is not null then insert into subcontract_acceptance_lines values (v, '15130000-0000-0000-0000-0000000000e2', p_l2); end if;
  return v;
end $$;

-- Bills in tests are captured through the RPC with tax exclusive, zero tax.
create or replace function pg_temp.bill(p_l1 numeric, p_l2 numeric default null) returns uuid language sql as $$
  select (capture_subcontract_vendor_invoice(
    p_procurement_id => '15130000-0000-0000-0000-0000000000f1', p_status => 'Received', p_invoice_date => current_date,
    p_amount => round(coalesce(p_l1,0) * 100000, 2) + round(coalesce(p_l2,0) * 40000, 2),
    p_tax_treatment => 'exclusive', p_tax_amount => 0,
    p_lines => (select jsonb_agg(x) from (
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e1','quantity',p_l1,'rate',100000) x where p_l1 is not null
      union all
      select jsonb_build_object('boq_item_id','15130000-0000-0000-0000-0000000000e2','quantity',p_l2,'rate',40000) where p_l2 is not null) s))).id
$$;

-- One confirmed acceptance of L1 = 100; one bill of 90 already captured (headroom 10).
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 100, null);
-- The 90 is inserted directly (guard GUC on): capturing it through the RPC would leave this session holding the PO lock
-- for the rest of the transaction, and the second session below could then never take it.
select set_config('pmo.subcontract_capture', 'on', true);
with i as (insert into procurement_invoices (procurement_id, status, invoice_date, vi_number, amount, tax_treatment, tax_amount, po_id, currency)
  values ('15130000-0000-0000-0000-0000000000f1', 'Received', current_date, 'VI-SCA-1', 9000000, 'exclusive', 0,
          '15130000-0000-0000-0000-000000000101', 'IDR') returning id)
insert into procurement_invoice_lines (invoice_id, boq_item_id, quantity, rate)
  select id, '15130000-0000-0000-0000-0000000000e1', 90, 100000 from i;
select set_config('pmo.subcontract_capture', '', true);
select ok(regexp_replace(pg_get_functiondef('public.capture_subcontract_vendor_invoice(uuid,procurement_invoice_status,date,jsonb,text,numeric,text,text,numeric,numeric,text,integer,integer,text,numeric,text)'::regprocedure), '--[^\n]*', '', 'g')
  ~ 'for update[\s\S]*subcontract_po_lock\([\s\S]*subcontract_bill_cap_violation',
  'AC-SCA-007 the capture takes the purchase row lock, then the PO lock, before evaluating the cap (documented lock order)');
-- The second session holds the same advisory key (a hash: it needs no committed rows).
select dblink_connect('sca', format('dbname=%s user=%s password=postgres host=%s port=%s',
  current_database(), current_user,
  coalesce(host(inet_server_addr()), 'supabase_db_pmo-portal'), coalesce(inet_server_port(), 5432)));
select dblink_exec('sca', 'begin');
select ok((select count(*)::int from dblink('sca',
  format($q$select pg_advisory_xact_lock(%s)$q$, hashtextextended('subcontract-po:15130000-0000-0000-0000-000000000101', 0))) as t(x text)) = 1,
  'AC-SCA-007 setup: a second session holds the PO''s headroom lock');
set local lock_timeout = '300ms';
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select throws_ok($$ select pg_temp.bill(10) $$, '55P03', null, 'AC-SCA-007 a second capture blocks while another holds the PO''s headroom');
reset role;
select dblink_exec('sca', 'rollback');
set local lock_timeout = 0;
set local role authenticated; select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select pg_temp.bill(10) $$, 'AC-SCA-007 once released, exactly one capture of the last 10 succeeds');
select throws_ok($$ select pg_temp.bill(10) $$, 'SC001', null, 'AC-SCA-007 and the next one for the same 10 is refused');
reset role;
select dblink_disconnect('sca');
select * from finish();
rollback;
