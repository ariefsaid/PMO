-- #1513 S1: subcontract flag, PO lines, revision 1 (FR-SCA-001/002/003, OQ-1/2, PQ-1..4, PQ-11/12).
-- Fixture F1 of docs/plans/2026-11-01-subcontract-acceptance.md plus S1 extras.
begin;
create extension if not exists pgtap;
select plan(55);

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
  ('15130000-0000-0000-0000-0000000000b1', 'sca-xorg@example.com'),
  ('15130000-0000-0000-0000-0000000000c1', 'sca-solo@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15130000-0000-0000-0000-0000000000a1', '15130000-0000-0000-0000-00000000000a', 'SCA Admin', 'sca-admin@example.com', 'Admin', 'active'),
  ('15130000-0000-0000-0000-0000000000a2', '15130000-0000-0000-0000-00000000000a', 'SCA Fin1',  'sca-fin1@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a3', '15130000-0000-0000-0000-00000000000a', 'SCA Fin2',  'sca-fin2@example.com',  'Finance', 'active'),
  ('15130000-0000-0000-0000-0000000000a4', '15130000-0000-0000-0000-00000000000a', 'SCA PM',    'sca-pm@example.com',    'Project Manager', 'active'),
  ('15130000-0000-0000-0000-0000000000a5', '15130000-0000-0000-0000-00000000000a', 'SCA Eng',   'sca-eng@example.com',   'Engineer', 'active'),
  ('15130000-0000-0000-0000-0000000000a6', '15130000-0000-0000-0000-00000000000a', 'SCA Exec',  'sca-exec@example.com',  'Executive', 'active'),
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
-- S1 extras: second PO on f1 (PQ-3), a 1,000-approved purchase (PQ-2), a purchase with a bill (PQ-4), an unvalued
-- purchase (PQ-2), a cancelled one (PQ-12) and a goods purchase (OQ-2).
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000f4', '15130000-0000-0000-0000-00000000000a', 'SCA small sub', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f5', '15130000-0000-0000-0000-00000000000a', 'SCA billed sub', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 100000, 100000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f6', '15130000-0000-0000-0000-00000000000a', 'SCA unvalued sub', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 0, null, null, 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f7', '15130000-0000-0000-0000-00000000000a', 'SCA cancelled sub', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Cancelled', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000f8', '15130000-0000-0000-0000-00000000000a', 'SCA goods', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 1000, 1000, '15130000-0000-0000-0000-0000000000a6', 'Materials', 'IDR', false);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, currency) values
  ('15130000-0000-0000-0000-000000000104', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f4', 'PO-SCA-4', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000105', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f5', 'PO-SCA-5', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000106', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f1', 'PO-SCA-6', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000107', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f6', 'PO-SCA-7', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000108', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f7', 'PO-SCA-8', 'Issued', current_date, 'IDR'),
  ('15130000-0000-0000-0000-000000000110', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f8', 'PO-SCA-10', 'Issued', current_date, 'IDR');
insert into procurements (id, org_id, title, project_id, requested_by_id, status, total_value, approved_total_value,
                          approved_by_id, budget_category, currency, is_subcontract) values
  ('15130000-0000-0000-0000-0000000000fa', '15130000-0000-0000-0000-00000000000a', 'SCA connected sub', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 30000, 30000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true),
  ('15130000-0000-0000-0000-0000000000fb', '15130000-0000-0000-0000-00000000000a', 'SCA connected sub, no amount', '15130000-0000-0000-0000-0000000000d1', '15130000-0000-0000-0000-0000000000a4', 'Ordered', 30000, 30000, '15130000-0000-0000-0000-0000000000a6', 'Subcontractors', 'IDR', true);
insert into purchase_orders (id, org_id, procurement_id, po_number, status, date, amount, currency) values
  ('15130000-0000-0000-0000-000000000111', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fa', 'PO-SCA-11', 'Issued', current_date, 20000, 'IDR'),
  ('15130000-0000-0000-0000-000000000112', '15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000fb', 'PO-SCA-12', 'Issued', current_date, null, 'IDR');
insert into procurement_invoices (org_id, procurement_id, vi_number, invoice_date, status, tax_treatment, tax_amount)
  values ('15130000-0000-0000-0000-00000000000a', '15130000-0000-0000-0000-0000000000f5', 'VI-SCA-5', current_date, 'Received', 'exclusive', 0);

set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f2',
  '{"title":"SCA new sub","project_id":"15130000-0000-0000-0000-0000000000d1","budget_category":"Subcontractors","is_subcontract":true}'::jsonb,
  '[]'::jsonb) $$, 'FR-SCA-001 OQ-1 a purchase is created flagged subcontract');
select is((select is_subcontract from procurements where id = '15130000-0000-0000-0000-0000000000f2'), true, 'FR-SCA-001 OQ-1 the flag is stored');
select lives_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f2',
  '{"title":"SCA new sub","project_id":"15130000-0000-0000-0000-0000000000d1","budget_category":"Subcontractors","is_subcontract":true}'::jsonb,
  '[]'::jsonb) $$, 'FR-SCA-001 OQ-1 a retried identical create is idempotent');
select throws_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f2',
  '{"title":"SCA new sub","project_id":"15130000-0000-0000-0000-0000000000d1","budget_category":"Subcontractors"}'::jsonb, '[]'::jsonb) $$,
  '23505', null, 'FR-SCA-001 OQ-1 a retry that drops the flag is a different request');
select throws_ok($$ update procurements set is_subcontract = false where id = '15130000-0000-0000-0000-0000000000f2' $$, '42501', null, 'FR-SCA-001 OQ-1 the flag cannot be changed after creation (client grant)');
select throws_ok($$ select create_procurement_with_items('15130000-0000-0000-0000-0000000000f3',
  '{"title":"SCA bad","is_subcontract":"yes"}'::jsonb, '[]'::jsonb) $$, '22023', null, 'FR-SCA-001 OQ-1 a non-boolean flag is invalid input');
select is(has_column_privilege('authenticated', 'public.procurements', 'is_subcontract', 'UPDATE'), false, 'FR-SCA-001 OQ-1 no client update grant on the flag');
select is(has_table_privilege('authenticated','public.purchase_order_lines','INSERT') or has_table_privilege('authenticated','public.purchase_order_lines','UPDATE')
  or has_table_privilege('authenticated','public.purchase_order_lines','DELETE') or has_table_privilege('authenticated','public.purchase_order_revisions','INSERT')
  or has_table_privilege('authenticated','public.purchase_order_revisions','UPDATE') or has_table_privilege('authenticated','public.purchase_order_revisions','DELETE'),
  false, 'FR-SCA-002 clients hold no DML on PO lines or revisions');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"}]') $$, '42501', null, 'FR-SCA-001 Engineer cannot draft PO lines');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a6');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"}]') $$, '42501', null, 'FR-SCA-001 Executive cannot draft PO lines');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"}]') $$, 'P0002', null, 'FR-SCA-001 another tenant cannot see the PO');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":0,"rate":100000,"unit":"m3"}]') $$, '23514', null, 'FR-SCA-001 quantity must be above zero');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e9","quantity":1,"rate":1,"unit":"ls"}]') $$, '23514', null, 'FR-SCA-001 a BoQ item from another project is refused');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[]') $$, '23502', null, 'FR-SCA-001 at least one line is required');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1,"unit":"m3"},{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":2,"rate":1,"unit":"m3"}]') $$, '23505', null, 'FR-SCA-001 a BoQ item cannot appear twice');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":10,"rate":1,"unit":"m3"}]') $$, 'FR-SCA-001 a draft can be replaced (first draft)');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101',
  '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":100,"rate":100000,"unit":"m3"},{"boq_item_id":"15130000-0000-0000-0000-0000000000e2","quantity":50,"rate":40000,"unit":"m"}]') $$, 'FR-SCA-001 the PM drafts two BoQ lines (replacing the earlier draft)');
select is((select count(*)::int from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101'), 2, 'FR-SCA-001 the replaced draft leaves exactly two lines');
select is((select sum(amount) from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101'), 12000000::numeric, 'FR-SCA-001 the lines total 12,000,000');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a5');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000101') $$, '42501', null, 'FR-SCA-002 an Engineer cannot issue revision 1');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000101') $$, 'P0002', null, 'FR-SCA-002 another tenant cannot issue revision 1');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select is(issue_subcontract_po_lines('15130000-0000-0000-0000-000000000101'), 1, 'FR-SCA-002 revision 1 is issued');
select is((select amount from purchase_orders where id = '15130000-0000-0000-0000-000000000101'), 12000000::numeric, 'FR-SCA-003 the PO amount is derived from the effective revision');
select is(po_effective_revision('15130000-0000-0000-0000-000000000101'), 1, 'FR-SCA-002 the effective revision is 1');
select is((select count(*)::int from purchase_order_revisions where po_id = '15130000-0000-0000-0000-000000000101' and total = 12000000 and issued_by = '15130000-0000-0000-0000-0000000000a4' and issue_basis = 'standard'), 1, 'FR-SCA-002 revision 1 records total, issuer and basis');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000101', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":120,"rate":100000,"unit":"m3"}]') $$, '42501', null, 'FR-SCA-002 lines are frozen once revision 1 is issued');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000101') $$, '42501', null, 'FR-SCA-002 revision 1 cannot be issued twice');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101'), 2, 'FR-SCA-001 a Finance member reads the lines');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from purchase_order_lines) + (select count(*)::int from purchase_order_revisions where po_id = '15130000-0000-0000-0000-000000000101'), 0, 'FR-SCA-001 another tenant reads no lines or revisions');
reset role;
select throws_ok($$ update purchase_orders set amount = 1 where id = '15130000-0000-0000-0000-000000000101' $$, '23514', null, 'FR-SCA-003 a hand-edited amount that disagrees with the revision is refused, even for the owner');
select lives_ok($$ update purchase_orders set amount = 12000000 where id = '15130000-0000-0000-0000-000000000101' $$, 'FR-SCA-003 an amount equal to the revision total is accepted');
select throws_ok($$ update purchase_order_lines set quantity = 1 where po_id = '15130000-0000-0000-0000-000000000101' $$, '42501', null, 'FR-SCA-002 issued lines are immutable');
select throws_ok($$ delete from purchase_order_lines where po_id = '15130000-0000-0000-0000-000000000101' $$, '42501', null, 'FR-SCA-002 issued lines cannot be deleted');
select throws_ok($$ update procurements set is_subcontract = false where id = '15130000-0000-0000-0000-0000000000f2' $$, '42501', null, 'FR-SCA-001 OQ-1 the flag guard binds the owner too');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ update purchase_orders set amount = 1 where id = '15130000-0000-0000-0000-000000000101' $$, 'FR-SCA-003 PQ-11 the service-role ERP mirror may record the ERP PO amount');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a2');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000104', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":2000,"unit":"m3"}]') $$, 'PQ-2 draft above approval is allowed as a draft');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000104') $$, '23514', null, 'PQ-2 revision 1 above the approved amount is refused');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000104', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000,"unit":"m3"}]') $$, 'PQ-2 the draft is corrected down to the approved amount');
select is(issue_subcontract_po_lines('15130000-0000-0000-0000-000000000104'), 1, 'PQ-2 revision 1 equal to the approved amount is issued');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000107', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000,"unit":"m3"}]') $$, 'PQ-2 draft on an unvalued purchase');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000107') $$, '23514', null, 'PQ-2 lines cannot be issued on a purchase with no recorded value');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000105', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1000,"unit":"m3"}]') $$, 'PQ-4 draft on a purchase that already has a bill');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000105') $$, '23514', null, 'PQ-4 lines cannot be issued after a bill exists');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000106', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1,"unit":"m3"}]') $$, '23505', null, 'PQ-3 one lined PO per subcontract purchase');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000108', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1,"unit":"m3"}]') $$, '42501', null, 'PQ-12 a closed purchase takes no BoQ lines');
select throws_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000110', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":1,"unit":"m3"}]') $$, '42501', null, 'OQ-2 a goods purchase has no BoQ lines');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000110') $$, '42501', null, 'OQ-2 a goods purchase issues no BoQ revision');
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a1');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000107', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":10,"unit":"m3"}]') $$, 'FR-SCA-001 an Admin may draft PO lines');

-- PQ-11: a connected org's PO amount is the ERP's.
reset role;
insert into external_domain_ownership (org_id, external_tier, domain) values ('15130000-0000-0000-0000-00000000000a', 'erpnext', 'procurement');
set local role authenticated;
select pg_temp.act_as('15130000-0000-0000-0000-0000000000a4');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000111', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":25000,"unit":"m3"}]') $$, 'PQ-11 a connected PO drafts lines');
select throws_ok($$ select issue_subcontract_po_lines('15130000-0000-0000-0000-000000000111') $$, '23514', null, 'PQ-11 connected: lines that differ from the ERP PO amount are refused');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000111', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":20000,"unit":"m3"}]') $$, 'PQ-11 the draft is corrected to the ERP amount');
select is(issue_subcontract_po_lines('15130000-0000-0000-0000-000000000111'), 1, 'PQ-11 connected: lines equal to the ERP amount are issued');
select lives_ok($$ select set_subcontract_po_lines('15130000-0000-0000-0000-000000000112', '[{"boq_item_id":"15130000-0000-0000-0000-0000000000e1","quantity":1,"rate":20000,"unit":"m3"}]') $$, 'PQ-11 a connected PO with no mirrored amount drafts lines');
select is(issue_subcontract_po_lines('15130000-0000-0000-0000-000000000112'), 1, 'PQ-11 connected: revision 1 is issued without an ERP amount');
select is((select amount from purchase_orders where id = '15130000-0000-0000-0000-000000000112'), null::numeric, 'PQ-11 connected: PMO does not write the PO amount');
select * from finish();
rollback;
