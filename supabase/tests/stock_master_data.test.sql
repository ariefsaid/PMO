begin;
create extension if not exists pgtap;

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

create function public.stk_t_as_user(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
-- usage: select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a4'); ... reset role;

select plan(32);
-- 1-3: master-data writers (rank >= 20) can create; Engineer cannot (AC-STK-034)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');          -- U_PM
select lives_ok($$ insert into stock_units (code, name, whole_only) values ('kg','Kilogram',false) $$, 'FR-STK-007 a Project Manager creates a unit');
select lives_ok($$ insert into stock_items (code, name, unit_id) select 'STEEL','Rebar 12mm', id from stock_units where code='kg' $$, 'FR-STK-007 a Project Manager creates an item');
select lives_ok($$ insert into stock_warehouses (code, name, kind) values ('CENTRAL','Central store','central') $$, 'FR-STK-007 a Project Manager creates a warehouse');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');          -- U_ENG
select throws_ok($$ insert into stock_units (code, name) values ('pcs','Pieces') $$, '42501', null,
  'AC-STK-034 an Engineer cannot create a unit');
select throws_ok($$ insert into stock_items (code, name, unit_id) select 'X','X', id from stock_units limit 1 $$, '42501', null,
  'AC-STK-034 an Engineer cannot create an item');
select throws_ok($$ insert into stock_warehouses (code, name, kind) values ('W','W','site') $$, '42501', null,
  'AC-STK-034 an Engineer cannot create a warehouse');
reset role;
-- 7: codes unique per org ignoring case (FR-STK-001)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_units (code, name) values ('KG','Dup') $$, '23505', null, 'FR-STK-001 unit codes are unique ignoring case');
reset role;
-- 8-10: only an Admin changes keepers (AC-STK-034), audited (FR-STK-004)
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a2');          -- U_FIN
select throws_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a4', true) $$,
  '42501', null, 'AC-STK-034 Finance cannot assign a keeper');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');          -- U_ADMIN
select lives_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a4', true) $$,
  'AC-STK-034 an Admin assigns a keeper');
select throws_ok($$ insert into stock_warehouse_keepers (warehouse_id, user_id) select id, '15120000-0000-0000-0000-0000000000a5' from stock_warehouses where code='CENTRAL' $$,
  '42501', null, 'FR-STK-060 even an Admin has no direct write grant on keepers');
reset role;
select is((select count(*)::int from audit_events where action = 'stock.keeper.assign'), 1, 'FR-STK-004 the keeper assignment is audited with actor and time');
-- 12: tenancy of the parent id (AC-STK-019 for stock_items)
select set_config('stk.unit', (select id::text from stock_units where code = 'kg' and org_id = '15120000-0000-0000-0000-000000000001'), false);   -- superuser reads org A's unit id
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');          -- U_XORG cannot see it, only name it
select throws_ok($$ insert into stock_items (code, name, unit_id) values ('Y','Y', current_setting('stk.unit')::uuid) $$, 'P0001', null,
  'AC-STK-019 an item cannot point at another org''s unit (the parent is invisible to the caller, so it fails closed)');
reset role;
-- 13: org_id is never client-writable
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_units (org_id, code, name) values ('15120000-0000-0000-0000-000000000002','Z','Z') $$, '42501', null,
  'FR-STK-065 org_id in a payload is refused');
-- 14: master changes are audited (FR-STK-066)
reset role;
select ok(exists (select 1 from audit_events where action = 'stock.unit.create' and org_id = '15120000-0000-0000-0000-000000000001' and actor_id = '15120000-0000-0000-0000-0000000000a3'), 'FR-STK-066 master-data creation writes an audit event with the actor');
-- 15-16: delete is Admin only (policy stock_*_delete, rank >= 50); a hidden row is a silent no-op
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
insert into stock_units (code, name) values ('tmp', 'Temporary');
delete from stock_units where code = 'tmp';
reset role;
select ok(exists (select 1 from stock_units where code = 'tmp' and org_id = '15120000-0000-0000-0000-000000000001'), 'FR-STK-007 a Project Manager cannot delete a unit');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');
delete from stock_units where code = 'tmp';
reset role;
select ok(not exists (select 1 from stock_units where code = 'tmp' and org_id = '15120000-0000-0000-0000-000000000001'), 'FR-STK-007 an Admin deletes an unreferenced unit');
-- 17-24: review hardening (security review L2/L3) - each control below fails a named assertion when removed
reset role;
insert into auth.users (id, email) values ('15120000-0000-0000-0000-0000000000a7', 'stk-exec@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('15120000-0000-0000-0000-0000000000a7', '15120000-0000-0000-0000-000000000001', 'STK Exec', 'stk-exec@example.com', 'Executive', 'active');
insert into companies (id, org_id, name, type) values ('15120000-0000-0000-0000-0000000000f2', '15120000-0000-0000-0000-000000000002', 'STK X Client', 'Client');
insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id) values
  ('15120000-0000-0000-0000-0000000000c9', '15120000-0000-0000-0000-000000000002', 'STK X Project', 'Ongoing Project', 1000, 'exclusive', 0,
   '15120000-0000-0000-0000-0000000000f2', '15120000-0000-0000-0000-0000000000b1');
insert into stock_units (id, org_id, code, name) values ('15120000-0000-0000-0000-0000000000d9', '15120000-0000-0000-0000-000000000002', 'xu', 'X unit');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');          -- U_PM
select throws_ok($$ insert into stock_warehouses (code, name, kind, project_id) values ('XP','XP','site','15120000-0000-0000-0000-0000000000c9') $$,
  'P0001', null, 'AC-STK-019 a warehouse cannot point at another org''s project');
select throws_ok($$ update stock_items set unit_id = '15120000-0000-0000-0000-0000000000d9' where code = 'STEEL' $$,
  'P0001', null, 'AC-STK-019 re-pointing an item at another org''s unit is refused on UPDATE too');
update stock_units set whole_only = true where code = 'kg';
reset role;
select is((select detail->'changed'->'whole_only' from audit_events where action = 'stock.unit.update'
            and org_id = '15120000-0000-0000-0000-000000000001' order by created_at desc, id limit 1),
  '{"old": false, "new": true}'::jsonb, 'FR-STK-066 an edit audit event records the changed field, old and new');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');          -- U_ADMIN
select throws_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000b1', true) $$,
  'P0001', null, 'AC-STK-019 a keeper must be an active member of the caller''s org');
reset role;
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a7');          -- U_EXEC (rank 40, below Admin)
select throws_ok($$ select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a5', true) $$,
  '42501', null, 'AC-STK-034 an Executive cannot assign a keeper (Admin only)');
reset role;
-- 24-33: spec review hardening
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a6');          -- U_ENG: no master-data edit (AC-STK-034)
update stock_units set name = 'hijack' where code = 'kg';
update stock_items set name = 'hijack' where code = 'STEEL';
update stock_warehouses set name = 'hijack' where code = 'CENTRAL';
reset role;
select is((select name from stock_units where code = 'kg' and org_id = '15120000-0000-0000-0000-000000000001'), 'Kilogram', 'AC-STK-034 an Engineer cannot edit a unit');
select is((select name from stock_items where code = 'STEEL' and org_id = '15120000-0000-0000-0000-000000000001'), 'Rebar 12mm', 'AC-STK-034 an Engineer cannot edit an item');
select is((select name from stock_warehouses where code = 'CENTRAL' and org_id = '15120000-0000-0000-0000-000000000001'), 'Central store', 'AC-STK-034 an Engineer cannot edit a warehouse');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000b1');          -- U_XORG is an Admin, of the other org
delete from stock_units where code = 'kg'; delete from stock_items where code = 'STEEL'; delete from stock_warehouses where code = 'CENTRAL';
reset role;
select ok(exists (select 1 from stock_units where code = 'kg' and org_id = '15120000-0000-0000-0000-000000000001') and exists (select 1 from stock_items where code = 'STEEL' and org_id = '15120000-0000-0000-0000-000000000001')
          and exists (select 1 from stock_warehouses where code = 'CENTRAL' and org_id = '15120000-0000-0000-0000-000000000001'), 'AC-STK-019 another org''s Admin cannot delete this org''s master data');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');          -- U_PM
select throws_ok($$ insert into stock_items (code, name, unit_id) select 'steel','Dup', id from stock_units where code='kg' $$, '23505', null, 'FR-STK-002 item codes are unique ignoring case');
select throws_ok($$ insert into stock_warehouses (code, name, kind) values ('central','Dup','site') $$, '23505', null, 'FR-STK-003 warehouse codes are unique ignoring case');
reset role;
select ok(exists (select 1 from audit_events where action = 'stock.item.create' and org_id = '15120000-0000-0000-0000-000000000001' and actor_id = '15120000-0000-0000-0000-0000000000a3'), 'FR-STK-066 item creation is audited with the actor');
select ok(exists (select 1 from audit_events where action = 'stock.warehouse.create' and org_id = '15120000-0000-0000-0000-000000000001' and actor_id = '15120000-0000-0000-0000-0000000000a3'), 'FR-STK-066 warehouse creation is audited with the actor');
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a1');          -- U_ADMIN removes the keeper assigned in 9
select set_stock_warehouse_keeper((select id from stock_warehouses where code='CENTRAL'), '15120000-0000-0000-0000-0000000000a4', false);
reset role;
select ok(exists (select 1 from audit_events where action = 'stock.keeper.remove' and org_id = '15120000-0000-0000-0000-000000000001' and actor_id = '15120000-0000-0000-0000-0000000000a1')
          and exists (select 1 from audit_events where action = 'stock.keeper.assign' and org_id = '15120000-0000-0000-0000-000000000001' and actor_id = '15120000-0000-0000-0000-0000000000a1'),
  'FR-STK-004 keeper assignment and removal are each audited with the actor');
update profiles set status = 'disabled' where id = '15120000-0000-0000-0000-0000000000a3';
select public.stk_t_as_user('15120000-0000-0000-0000-0000000000a3');
select throws_ok($$ insert into stock_units (code, name) values ('late','Late') $$, '42501', null, 'FR-STK-007 a disabled Project Manager cannot write master data');
reset role;
select ok(not has_table_privilege('anon', 'public.stock_units', 'select') and not has_table_privilege('anon', 'public.stock_warehouse_keepers', 'select')
          and not has_function_privilege('anon', 'public.set_stock_warehouse_keeper(uuid,uuid,boolean)', 'execute'),
  'FR-STK-060 the anon role has no table access and cannot call the keeper RPC');
select * from finish();
rollback;
