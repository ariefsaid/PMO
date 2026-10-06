-- 0250_progress_billing_boq.test.sql — #766 AC-PB-001 (bill of quantities) + AC-PB-011 (org down-payment item).
-- Migration under test: 0250_progress_billing.sql. Every denial asserts errcode AND message.
-- Cast (org A): a1 Admin · a2 Finance · a4 PM · a5 Engineer · a6 Finance (disabled) · b1 Admin of org B.
begin;
create extension if not exists pgtap;
select plan(17);

insert into organizations (id, name) values
  ('07660000-0000-0000-0000-000000000001', 'PB Org'),
  ('07660000-0000-0000-0000-000000000002', 'PB Other Org');
insert into auth.users (id, email) values
  ('07660000-0000-0000-0000-0000000000a1', 'pb-admin@example.com'),
  ('07660000-0000-0000-0000-0000000000a2', 'pb-fin@example.com'),
  ('07660000-0000-0000-0000-0000000000a4', 'pb-pm@example.com'),
  ('07660000-0000-0000-0000-0000000000a5', 'pb-eng@example.com'),
  ('07660000-0000-0000-0000-0000000000a6', 'pb-off@example.com'),
  ('07660000-0000-0000-0000-0000000000b1', 'pb-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07660000-0000-0000-0000-0000000000a1', '07660000-0000-0000-0000-000000000001', 'PB Admin', 'pb-admin@example.com', 'Admin', 'active'),
  ('07660000-0000-0000-0000-0000000000a2', '07660000-0000-0000-0000-000000000001', 'PB Fin', 'pb-fin@example.com', 'Finance', 'active'),
  ('07660000-0000-0000-0000-0000000000a4', '07660000-0000-0000-0000-000000000001', 'PB PM', 'pb-pm@example.com', 'Project Manager', 'active'),
  ('07660000-0000-0000-0000-0000000000a5', '07660000-0000-0000-0000-000000000001', 'PB Eng', 'pb-eng@example.com', 'Engineer', 'active'),
  ('07660000-0000-0000-0000-0000000000a6', '07660000-0000-0000-0000-000000000001', 'PB Off', 'pb-off@example.com', 'Finance', 'disabled'),
  ('07660000-0000-0000-0000-0000000000b1', '07660000-0000-0000-0000-000000000002', 'PB XOrg', 'pb-xorg@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07660000-0000-0000-0000-0000000000f1', '07660000-0000-0000-0000-000000000001', 'PB Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id) values
  ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-000000000001', 'PB Project', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1'),
  ('07660000-0000-0000-0000-0000000000c2', '07660000-0000-0000-0000-000000000001', 'PB Project Two', 'Ongoing Project', 1000000, 'exclusive', 0, '07660000-0000-0000-0000-0000000000f1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('07660000-0000-0000-0000-0000000000d1', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c1', 'PB WO one', 'Issued', 500000, 'exclusive', 0),
  ('07660000-0000-0000-0000-0000000000d9', '07660000-0000-0000-0000-000000000001', '07660000-0000-0000-0000-0000000000c2', 'PB WO other project', 'Issued', 500000, 'exclusive', 0);

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($$ insert into boq_items (id, project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000e1', '07660000-0000-0000-0000-0000000000c1', 'SURVEY', 'Route survey', 'km', 10, 50000) $$,
  'AC-PB-001 a PM adds a bill of quantities line without stating the org');
select is((select org_id from boq_items where id = '07660000-0000-0000-0000-0000000000e1'),
  '07660000-0000-0000-0000-000000000001'::uuid, 'AC-PB-001 the line is stamped with the caller''s org');
select lives_ok($$ insert into boq_items (id, project_id, work_order_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000e2', '07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d1', 'STATION', 'Station build', 'unit', 5, 100000) $$,
  'AC-PB-001 a line may name a work order on the same project');
select throws_ok($$ insert into boq_items (project_id, work_order_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', '07660000-0000-0000-0000-0000000000d9', 'X', 'X', 'km', 1, 1) $$,
  '23514', 'the work order must be on the same project as the bill of quantities line',
  'AC-PB-001 a line cannot name another project''s work order');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 0, 1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_quantity_check"',
  'AC-PB-001 quantity must be above 0');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 'NaN', 1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_quantity_check"',
  'AC-PB-001 a NaN quantity is refused (NaN sorts above every number)');
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 1, -1) $$,
  '23514', 'new row for relation "boq_items" violates check constraint "boq_items_rate_check"',
  'AC-PB-001 a rate cannot be negative');
select lives_ok($$ update boq_items set quantity = 12 where id = '07660000-0000-0000-0000-0000000000e1' $$,
  'AC-PB-001 a PM may re-measure a line');
select throws_ok($$ update boq_items set project_id = '07660000-0000-0000-0000-0000000000c2' where id = '07660000-0000-0000-0000-0000000000e1' $$,
  '42501', 'permission denied for table boq_items', 'AC-PB-001 a line cannot be moved to another project');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ insert into boq_items (project_id, item_code, description, unit, quantity, rate)
  values ('07660000-0000-0000-0000-0000000000c1', 'X', 'X', 'km', 1, 1) $$,
  '42501', 'new row violates row-level security policy for table "boq_items"', 'AC-PB-001 an Engineer cannot add lines');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select is((select count(*)::int from boq_items), 0, 'AC-PB-001 an offboarded member reads no lines');
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from boq_items), 0, 'AC-PB-001 another org reads none of these lines');
reset role;
select is(has_table_privilege('anon', 'public.boq_items', 'SELECT'), false, 'AC-PB-001 anon cannot read the bill of quantities');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ update organizations set down_payment_item = 'DP-ITEM' where id = '07660000-0000-0000-0000-000000000001' $$,
  'AC-PB-011 an Admin sets the org''s down payment item');
reset role;
select is((select count(*)::int from audit_events where action = 'org.down_payment_item.change'
   and entity_id = '07660000-0000-0000-0000-000000000001'
   and detail = jsonb_build_object('from', null, 'to', 'DP-ITEM')), 1,
  'AC-PB-011 the change is audited with its before and after values');
set local role authenticated;
set local request.jwt.claims = '{"sub":"07660000-0000-0000-0000-0000000000a2","role":"authenticated"}';
with changed as (update organizations set down_payment_item = 'OTHER' where id = '07660000-0000-0000-0000-000000000001' returning id)
select is(count(*)::int, 0, 'AC-PB-011 Finance cannot change the down payment item') from changed;
reset role;
select throws_ok($$ update organizations set down_payment_item = repeat('x', 141) where id = '07660000-0000-0000-0000-000000000001' $$,
  '23514', 'new row for relation "organizations" violates check constraint "organizations_down_payment_item_check"',
  'AC-PB-011 the item code is at most 140 characters');

select * from finish();
rollback;
