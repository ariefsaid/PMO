-- #1513 S4: tenancy isolation across every subcontract table and writer (AC-SCA-013, NFR-SCA-003).
-- Fixture F1 + F2 + F3 of docs/plans/2026-11-01-subcontract-acceptance.md, plus one Requested variation, a linked work order
-- and one bill line in org A. Org B's Admin must read none of it and write none of it.
begin;
create extension if not exists pgtap;
select plan(24);

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
  ('15130000-0000-0000-0000-0000000000e3', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'L3', 'Not on PO', 'ls', 5,   10000),
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

-- Org A data to hide: a confirmed acceptance, a bill with one line, a Requested variation with a line, a linked work order.
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('15130000-0000-0000-0000-000000000401', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000d1', 'SCA WO one', 'Issued', 10000, 'exclusive', 0);
select pg_temp.confirmed_acceptance('15130000-0000-0000-0000-000000000101', 50, null);
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select pg_temp.bill(10);
reset role;
select set_config('pmo.po_variation_write', 'on', true);
insert into po_variations (id, po_id, procurement_id, project_id, number, origin, reason, amount, requested_by, work_order_id, linked_by, linked_at) values
  ('15130000-0000-0000-0000-000000000501', '15130000-0000-0000-0000-000000000101', '15130000-0000-0000-0000-0000000000f1',
   '15130000-0000-0000-0000-0000000000d1', 'VAR-1', 'pre_work', 'Tenancy probe', 100000, '15130000-0000-0000-0000-0000000000a4',
   '15130000-0000-0000-0000-000000000401', '15130000-0000-0000-0000-0000000000a4', now());
insert into po_variation_lines (variation_id, boq_item_id, additional_quantity, rate) values
  ('15130000-0000-0000-0000-000000000501', '15130000-0000-0000-0000-0000000000e1', 1, 100000);
select set_config('pmo.po_variation_write', '', true);

-- Sanity: org A's own Finance reads them (the zero counts below are isolation, not an empty fixture).
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select cmp_ok((select count(*)::int from subcontract_acceptances) + (select count(*)::int from purchase_order_lines)
  + (select count(*)::int from purchase_order_revisions) + (select count(*)::int from po_variations)
  + (select count(*)::int from po_variation_lines) + (select count(*)::int from procurement_invoice_lines), '>=', 7,
  'AC-SCA-013 fixture: org A reads its own rows');

select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from subcontract_acceptances), 0, 'AC-SCA-013 org B reads none of org A''s acceptances');
select is((select count(*)::int from subcontract_acceptance_lines), 0, 'AC-SCA-013 … nor their lines');
select is((select count(*)::int from purchase_order_lines), 0, 'AC-SCA-013 … nor PO lines');
select is((select count(*)::int from purchase_order_revisions), 0, 'AC-SCA-013 … nor revisions');
select is((select count(*)::int from po_variations), 0, 'AC-SCA-013 … nor variations');
select is((select count(*)::int from po_variation_lines), 0, 'AC-SCA-013 … nor variation lines');
select is((select count(*)::int from procurement_invoice_lines), 0, 'AC-SCA-013 … nor bill lines');
select is((select count(*)::int from subcontract_po_position('15130000-0000-0000-0000-000000000101')), 0,
  'AC-SCA-013 … and the position read returns nothing');
select is((select count(*)::int from project_subcontract_exposure('15130000-0000-0000-0000-0000000000d1')), 0,
  'AC-SCA-013 … nor the project exposure');
select throws_ok($$ select prepare_subcontract_acceptance('15130000-0000-0000-0000-000000000101', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1}]') $$, 'P0002', null,
  'AC-SCA-013 org B cannot write against org A''s PO');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'x') $$, 'P0002', null,
  'AC-SCA-013 org B cannot raise a variation on org A''s PO');
select throws_ok($$ select capture_subcontract_vendor_invoice('15130000-0000-0000-0000-0000000000f1', 'Received', current_date,
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":100000}]', p_amount => 100000,
  p_tax_treatment => 'exclusive', p_tax_amount => 0) $$, 'P0002', null, 'AC-SCA-013 org B cannot bill against org A''s purchase');
select throws_ok($$ select decide_po_variation((select id from po_variations limit 1), true, null) $$, 'P0002', null,
  'AC-SCA-013 org B cannot decide org A''s variation (it reads none, so the id is null → not found)');
select throws_ok($$ select decide_po_variation('15130000-0000-0000-0000-000000000501', true, null) $$, 'P0002', null,
  'AC-SCA-013 … nor by its known id');
select throws_ok($$ select issue_po_revision('15130000-0000-0000-0000-000000000501') $$, 'P0002', null,
  'AC-SCA-013 … nor issue its revision');
select throws_ok($$ select link_po_variation('15130000-0000-0000-0000-000000000501', null, 'x') $$, 'P0002', null,
  'AC-SCA-013 … nor link it');
select is((select count(*)::int from work_order_cost_variations('15130000-0000-0000-0000-000000000401')), 0,
  'AC-SCA-013 … and reads no cost variation on org A''s work order');
select is((select route from po_variation_route('15130000-0000-0000-0000-000000000501')), null,
  'AC-SCA-013 … nor its approval route');
select is((select status from po_variations where id = '15130000-0000-0000-0000-000000000501'), null,
  'AC-SCA-013 … and a known id reads nothing');

-- An offboarded org-A member reads nothing.
reset role;
update profiles set status = 'disabled' where id = '15130000-0000-0000-0000-0000000000a3';
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from subcontract_acceptances), 0, 'AC-SCA-013 a disabled member reads no acceptances');
select is((select count(*)::int from po_variations), 0, 'AC-SCA-013 … nor variations');
select is((select count(*)::int from purchase_order_lines), 0, 'AC-SCA-013 … nor PO lines');
select throws_ok($$ select request_po_variation('15130000-0000-0000-0000-000000000101', 'pre_work',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","additional_quantity":1}]', 'x') $$, '42501', null,
  'AC-SCA-013 … and cannot raise one');

select * from finish();
rollback;
