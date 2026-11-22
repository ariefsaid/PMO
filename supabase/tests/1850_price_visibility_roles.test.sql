-- 1850_price_visibility_roles.test.sql — who holds the price right when hiding prices is on (docs/specs/price-visibility-roles.spec.md).
-- Migrations under test: 1850_price_right_office_roles (data), 1851_price_right_no_legacy_exception (the one deciding function).
-- The expected list below is an independent literal; it is NOT read from the catalogue.
-- MUTATION CHECKS (run each, see the named assertion go red, restore):
--   delete from built_in_role_capabilities where role_key = 'planner' and capability = 'sees_prices'  -> 'AC-PVR-001 planner ...', 'AC-PVR-005 ...'
--   insert ('foreman','sees_prices') into built_in_role_capabilities                                   -> 'AC-PVR-001 foreman ...', 'AC-PVR-005 ...'
--   restore in actor_may_see_prices_now:  and not (actor_built_in_role() is null and auth_role() = 'Engineer')
--                                                                                                       -> 'AC-PVR-002 no job role at Engineer ...'
--   make actor_may_see_prices_now() return true                                                         -> 'AC-PVR-001 foreman ...', 'AC-PVR-001 field_user ...'
--   drop the org_hide_prices_enabled test from actor_may_see_prices_now (always run the role test)      -> 'AC-PVR-003 ...'
--   drop the is_active_member test                                                                      -> 'AC-PVR-004 an inactive member ...'
begin;
select plan(39);

insert into organizations (id, name) values
  ('18500000-0000-0000-0000-000000000001','PVR Org A'),
  ('18500000-0000-0000-0000-000000000002','PVR Org B (setting stays off)');
update organizations set built_in_roles_enabled = true where id = '18500000-0000-0000-0000-000000000001';

-- expected: role key, base level, sees prices with hiding on
create temp table pvr_role (n int primary key, key text, base text, sees boolean);
insert into pvr_role values
  (1,'executive','Executive',true),(2,'administrator','Admin',true),(3,'project_manager','Project Manager',true),
  (4,'deputy_project_manager','Project Manager',true),(5,'project_administrator','Engineer',true),
  (6,'project_control_manager','Project Manager',true),(7,'engineer','Engineer',true),(8,'planner','Engineer',true),
  (9,'quantity_surveyor','Engineer',true),(10,'billing_officer','Finance',true),(11,'construction_manager','Project Manager',true),
  (12,'site_supervisor','Engineer',true),(13,'foreman','Engineer',false),(14,'material_coordinator','Engineer',true),
  (15,'storekeeper','Engineer',true),(16,'procurement_manager','Project Manager',true),(17,'buyer','Engineer',true),
  (18,'finance_manager','Finance',true),(19,'finance_officer','Finance',true),(20,'quality_manager','Project Manager',true),
  (21,'quality_inspector','Engineer',true),(22,'safety_manager','Project Manager',true),(23,'safety_officer','Engineer',true),
  (24,'equipment_manager','Project Manager',true),(25,'equipment_officer','Engineer',true),(26,'hr_manager','Project Manager',true),
  (27,'hr_officer','Engineer',true),(28,'field_user','Engineer',false);
-- no job role at each base level: n 101..105
create temp table pvr_plain (n int primary key, base text);
insert into pvr_plain values (101,'Engineer'),(102,'Project Manager'),(103,'Finance'),(104,'Executive'),(105,'Admin');

insert into auth.users (id, email)
select ('18500000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid, 'pvr-' || n || '@example.com' from pvr_role;
insert into auth.users (id, email)
select ('18500000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid, 'pvr-' || n || '@example.com' from pvr_plain;
insert into auth.users (id, email) values
  ('18500000-0000-0000-0000-000000000901','pvr-inactive@example.com'),
  ('18500000-0000-0000-0000-000000000902','pvr-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status)
select ('18500000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid, '18500000-0000-0000-0000-000000000001', 'PVR ' || key,
       'pvr-' || n || '@example.com', base, 'active' from pvr_role;
insert into profiles (id, org_id, full_name, email, role, status)
select ('18500000-0000-0000-0000-0000000' || lpad(n::text, 5, '0'))::uuid, '18500000-0000-0000-0000-000000000001', 'PVR plain ' || base,
       'pvr-' || n || '@example.com', base, 'active' from pvr_plain;
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18500000-0000-0000-0000-000000000901','18500000-0000-0000-0000-000000000001','PVR inactive','pvr-inactive@example.com','Engineer','disabled'),
  ('18500000-0000-0000-0000-000000000902','18500000-0000-0000-0000-000000000002','PVR B','pvr-b@example.com','Engineer','active');
update profiles p set built_in_role = r.key
  from pvr_role r where p.id = ('18500000-0000-0000-0000-0000000' || lpad(r.n::text, 5, '0'))::uuid;

insert into procurements (id, org_id, title, status, requested_by_id) values
  ('18500000-0000-0000-0000-000000000a10','18500000-0000-0000-0000-000000000001','PVR Case','Draft','18500000-0000-0000-0000-000000000015');
insert into procurement_items (id, procurement_id, name, quantity, rate) values
  ('18500000-0000-0000-0000-000000000a11','18500000-0000-0000-0000-000000000a10','PVR Item',2,12.50);

-- one answer per person, computed once per setting state, as the signed-in person
create temp table pvr_seen (n int, setting boolean, sees boolean);
grant all on pvr_seen to authenticated;
grant select on pvr_role, pvr_plain to authenticated;
create or replace function pg_temp.pvr_run(p_setting boolean) returns void language plpgsql as $$
declare r record;
begin
  update organizations set hide_prices_from_requesters = p_setting where id = '18500000-0000-0000-0000-000000000001';
  for r in select n from pvr_role union all select n from pvr_plain loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"18500000-0000-0000-0000-0000000' || lpad(r.n::text, 5, '0') || '","role":"authenticated"}', true);
    insert into pvr_seen values (r.n, p_setting, public.actor_may_see_prices_now());
    execute 'reset role';
  end loop;
end $$;
select pg_temp.pvr_run(true);
select pg_temp.pvr_run(false);

-- AC-PVR-001 one assertion per job role, hiding on
select is((select sees from pvr_seen where n = 1 and setting), true, 'AC-PVR-001 executive sees prices, hiding on');
select is((select sees from pvr_seen where n = 2 and setting), true, 'AC-PVR-001 administrator sees prices, hiding on');
select is((select sees from pvr_seen where n = 3 and setting), true, 'AC-PVR-001 project_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 4 and setting), true, 'AC-PVR-001 deputy_project_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 5 and setting), true, 'AC-PVR-001 project_administrator sees prices, hiding on');
select is((select sees from pvr_seen where n = 6 and setting), true, 'AC-PVR-001 project_control_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 7 and setting), true, 'AC-PVR-001 engineer sees prices, hiding on');
select is((select sees from pvr_seen where n = 8 and setting), true, 'AC-PVR-001 planner sees prices, hiding on');
select is((select sees from pvr_seen where n = 9 and setting), true, 'AC-PVR-001 quantity_surveyor sees prices, hiding on');
select is((select sees from pvr_seen where n = 10 and setting), true, 'AC-PVR-001 billing_officer sees prices, hiding on');
select is((select sees from pvr_seen where n = 11 and setting), true, 'AC-PVR-001 construction_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 12 and setting), true, 'AC-PVR-001 site_supervisor sees prices, hiding on');
select is((select sees from pvr_seen where n = 13 and setting), false, 'AC-PVR-001 foreman does not see prices, hiding on');
select is((select sees from pvr_seen where n = 14 and setting), true, 'AC-PVR-001 material_coordinator sees prices, hiding on');
select is((select sees from pvr_seen where n = 15 and setting), true, 'AC-PVR-001 storekeeper sees prices, hiding on');
select is((select sees from pvr_seen where n = 16 and setting), true, 'AC-PVR-001 procurement_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 17 and setting), true, 'AC-PVR-001 buyer sees prices, hiding on');
select is((select sees from pvr_seen where n = 18 and setting), true, 'AC-PVR-001 finance_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 19 and setting), true, 'AC-PVR-001 finance_officer sees prices, hiding on');
select is((select sees from pvr_seen where n = 20 and setting), true, 'AC-PVR-001 quality_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 21 and setting), true, 'AC-PVR-001 quality_inspector sees prices, hiding on');
select is((select sees from pvr_seen where n = 22 and setting), true, 'AC-PVR-001 safety_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 23 and setting), true, 'AC-PVR-001 safety_officer sees prices, hiding on');
select is((select sees from pvr_seen where n = 24 and setting), true, 'AC-PVR-001 equipment_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 25 and setting), true, 'AC-PVR-001 equipment_officer sees prices, hiding on');
select is((select sees from pvr_seen where n = 26 and setting), true, 'AC-PVR-001 hr_manager sees prices, hiding on');
select is((select sees from pvr_seen where n = 27 and setting), true, 'AC-PVR-001 hr_officer sees prices, hiding on');
select is((select sees from pvr_seen where n = 28 and setting), false, 'AC-PVR-001 field_user does not see prices, hiding on');
select is((select count(*)::int from pvr_seen s join pvr_role r using (n) where s.setting and s.sees is distinct from r.sees), 0,
  'AC-PVR-001 all 28 roles were checked against the expected table and none differs');

-- AC-PVR-002 no job role, every base level, hiding on
select is((select count(*)::int from pvr_seen s join pvr_plain p using (n) where s.setting and s.sees), 5,
  'AC-PVR-002 a person with no job role sees prices at all five base levels, hiding on');
select is((select sees from pvr_seen where n = 101 and setting), true, 'AC-PVR-002 no job role at Engineer sees prices, hiding on');

-- AC-PVR-003 hiding off: nobody loses anything
select is((select count(*)::int from pvr_seen where not setting and sees), 33, 'AC-PVR-003 hiding off: all 28 roles and 5 no-job-role levels see prices');
select is((select count(*)::int from pvr_seen where not setting), 33, 'AC-PVR-003 hiding off: 33 people were checked');

-- AC-PVR-004 inactive member; other organisation
update organizations set hide_prices_from_requesters = true where id = '18500000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-000000000901","role":"authenticated"}';
select is(actor_may_see_prices_now(), false, 'AC-PVR-004 an inactive member sees no price, hiding on');
set local request.jwt.claims = '{"sub":"18500000-0000-0000-0000-000000000902","role":"authenticated"}';
select is(actor_may_see_prices_now(), true, 'AC-PVR-004 an organisation whose setting is off is unaffected');
reset role;

-- AC-PVR-005 the list is data: 26 rows, none for the two field roles; the function names no role
select is((select string_agg(role_key, ',' order by role_key) from built_in_role_capabilities where capability = 'sees_prices'),
  (select string_agg(key, ',' order by key) from pvr_role where sees), 'AC-PVR-005 the sees_prices rows are exactly the 26 non-field roles');
select is((select count(*)::int from pg_proc where proname = 'actor_may_see_prices_now' and pronamespace = 'public'::regnamespace
  and prosrc ~* '(foreman|field_user|storekeeper|planner|buyer|engineer)'), 0, 'AC-PVR-005 the deciding function names no role');

-- AC-PVR-006 office roles read the rate through the masked view; a foreman reads NULL (hiding on)
create temp table pvr_rate (n int, rate numeric);
grant all on pvr_rate to authenticated;
do $$ declare r record; begin
  for r in select n from pvr_role where n in (8, 15, 17, 5, 13) loop
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', '{"sub":"18500000-0000-0000-0000-0000000' || lpad(r.n::text, 5, '0') || '","role":"authenticated"}', true);
    insert into pvr_rate select r.n, (select rate from procurement_items_masked where id = '18500000-0000-0000-0000-000000000a11');
    execute 'reset role';
  end loop; end $$;
select is((select string_agg(n::text, ',' order by n) from pvr_rate where rate = 12.50), '5,8,15,17',
  'AC-PVR-006 a planner, buyer, storekeeper and project administrator read the rate, hiding on');
select is((select count(*)::int from pvr_rate where n = 13 and rate is null), 1, 'AC-PVR-006 a foreman never reads the rate, hiding on');

select * from finish();
rollback;
