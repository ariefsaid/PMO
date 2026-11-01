begin;
create extension if not exists pgtap;
-- #1512 S5: material allowance rules (AC-STK-024, FR-STK-050, PQ-7). Plan docs/plans/2026-10-31-inventory-project-consumption.md (S5.2).

insert into organizations (id, name, default_currency, default_timezone) values
  ('15120000-0000-0000-0000-000000000001', 'STK Org',       'IDR', 'Asia/Jakarta'),
  ('15120000-0000-0000-0000-000000000002', 'STK Other Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('15120000-0000-0000-0000-0000000000a1', 'stk-admin@example.com'),
  ('15120000-0000-0000-0000-0000000000a2', 'stk-fin@example.com'),
  ('15120000-0000-0000-0000-0000000000a3', 'stk-pm@example.com'),
  ('15120000-0000-0000-0000-0000000000a4', 'stk-keep1@example.com'),   -- Engineer, keeps site A
  ('15120000-0000-0000-0000-0000000000a5', 'stk-keep2@example.com'),   -- Engineer, keeps site B
  ('15120000-0000-0000-0000-0000000000a6', 'stk-eng@example.com'),     -- Engineer, keeps nothing
  ('15120000-0000-0000-0000-0000000000b1', 'stk-xorg@example.com');    -- other-org Admin
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a1', '15120000-0000-0000-0000-000000000001', 'STK Admin', 'stk-admin@example.com', 'Admin', 'active'),
  ('15120000-0000-0000-0000-0000000000a2', '15120000-0000-0000-0000-000000000001', 'STK Fin',   'stk-fin@example.com',   'Finance', 'active'),
  ('15120000-0000-0000-0000-0000000000a3', '15120000-0000-0000-0000-000000000001', 'STK PM',    'stk-pm@example.com',    'Project Manager', 'active'),
  ('15120000-0000-0000-0000-0000000000a4', '15120000-0000-0000-0000-000000000001', 'STK Keep1', 'stk-keep1@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a5', '15120000-0000-0000-0000-000000000001', 'STK Keep2', 'stk-keep2@example.com', 'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000a6', '15120000-0000-0000-0000-000000000001', 'STK Eng',   'stk-eng@example.com',   'Engineer', 'active'),
  ('15120000-0000-0000-0000-0000000000b1', '15120000-0000-0000-0000-000000000002', 'STK XOrg',  'stk-xorg@example.com',  'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-000000000001', 'STK Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c1', '15120000-0000-0000-0000-000000000001', 'STK Ongoing',  'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3'),
  ('15120000-0000-0000-0000-0000000000c2', '15120000-0000-0000-0000-000000000001', 'STK On Hold',  'On Hold',         1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a3');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c1', 'W-1', 'Slab pour',   'm3', 50, 1000),
  ('15120000-0000-0000-0000-0000000000e2', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c2', 'W-2', 'Other pour',  'm3', 50, 1000);

-- S1 adds below (master data, as superuser so the fixture does not depend on the RLS under test):
insert into stock_units (id, org_id, code, name, whole_only) values
  ('15120000-0000-0000-0000-0000000000d1', '15120000-0000-0000-0000-000000000001', 'bag', 'Bag',   true),
  ('15120000-0000-0000-0000-0000000000d2', '15120000-0000-0000-0000-000000000001', 'm',   'Metre', false);
insert into stock_items (id, org_id, code, name, unit_id) values
  ('15120000-0000-0000-0000-000000001001', '15120000-0000-0000-0000-000000000001', 'CEM', 'Cement 50kg', '15120000-0000-0000-0000-0000000000d1'),
  ('15120000-0000-0000-0000-000000001002', '15120000-0000-0000-0000-000000000001', 'CAB', 'Cable 4mm',   '15120000-0000-0000-0000-0000000000d2');
insert into stock_warehouses (id, org_id, code, name, kind) values
  ('15120000-0000-0000-0000-000000002001', '15120000-0000-0000-0000-000000000001', 'CEN',    'Central',  'central'),
  ('15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-000000000001', 'SITE-A', 'Site A',   'site'),
  ('15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-000000000001', 'SITE-B', 'Site B',   'site'),
  ('15120000-0000-0000-0000-000000002009', '15120000-0000-0000-0000-000000000002', 'XCEN',   'X Central','central');
insert into stock_warehouse_keepers (org_id, warehouse_id, user_id) values
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002002', '15120000-0000-0000-0000-0000000000a4'),
  ('15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-000000002003', '15120000-0000-0000-0000-0000000000a5');

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- P_OTHER: a second Ongoing project managed by the Admin, with its own work item.
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c3', '15120000-0000-0000-0000-000000000001', 'STK Other', 'Ongoing Project', 1000000, 'exclusive', 0, '15120000-0000-0000-0000-0000000000f1', '15120000-0000-0000-0000-0000000000a1');
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('15120000-0000-0000-0000-0000000000e3', '15120000-0000-0000-0000-000000000001', '15120000-0000-0000-0000-0000000000c3', 'W-3', 'Other slab', 'm3', 50, 1000);

select plan(10);
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');                                    -- U_PM manages P_ON only
select lives_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001001', 100) $$,
  'FR-STK-050 the project''s own PM sets an allowance on a BoQ line of their project');
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e3', '15120000-0000-0000-0000-000000001001', 100) $$,
  '42501', null, 'AC-STK-024 a PM cannot set an allowance on another project''s BoQ line');
select lives_ok($$ update boq_material_allowances set planned_quantity = 120 where boq_item_id = '15120000-0000-0000-0000-0000000000e1' $$, 'FR-STK-050 and changes it');
select is((select planned_quantity::text from boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e1'), '120.000', 'FR-STK-050 the change landed');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');                                    -- U_ENG
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001002', 5) $$,
  '42501', null, 'AC-STK-024 an Engineer cannot set an allowance');
select is((select count(*)::int from boq_material_allowances), 1, 'FR-STK-050 an Engineer still reads the allowances of the org');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a2');                                    -- U_FIN (Finance rank and above may on any project)
select lives_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e3', '15120000-0000-0000-0000-000000001002', 7) $$, 'PQ-7 Finance sets one on any project');
select lives_ok($$ delete from boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e3' $$, 'FR-STK-050 and clears it');
select is((select count(*)::int from boq_material_allowances where boq_item_id = '15120000-0000-0000-0000-0000000000e3'), 0, 'FR-STK-050 the clear landed');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');                                    -- other org
select throws_ok($$ insert into boq_material_allowances (boq_item_id, item_id, planned_quantity) values ('15120000-0000-0000-0000-0000000000e1', '15120000-0000-0000-0000-000000001001', 1) $$,
  '42501', null, 'AC-STK-019 org B cannot set an allowance on org A''s BoQ line');
reset role;
select * from finish();
rollback;
