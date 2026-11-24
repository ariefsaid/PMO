-- 2046_project_control_role_rights.test.sql — project-control job-role rights (migration 2046).
-- The Project Control Manager reads revenue and cost-performance on every project of its organisation and changes none of it; a
-- Project Manager-level person with another job role or none keeps the own-projects scope; the Planner and the project-control
-- Engineer read no amounts. The Planner keeps sections; the Engineer plans consumables; the Project Administrator records head counts
-- and never approves them.
-- MUTATION NOTES (remove the condition tagged in 2046; the named assertion must go red; restore):
--   mut:rr_pcm_revenue ............ 'RR-PC-01 the Project Control Manager reads cost-performance on a project it does not manage'
--   mut:rr_planner_sections ....... 'RR-PC-06 the Planner adds a work order section'
--   mut:rr_engineer_consumables ... 'RR-PC-09 the Engineer generates a work order''s consumable plan'
--   mut:rr_admin_headcount ........ 'RR-PC-11 the Project Administrator records a crew''s head count'
begin;
create extension if not exists pgtap;
select plan(25);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('20460000-0000-0000-0000-00000000000a', 'RR PC Org', 'IDR', 'UTC', true),
  ('20460000-0000-0000-0000-00000000000b', 'RR PC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('20460000-0000-0000-0000-0000000000' || k)::uuid, 'rrpc-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b9']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20460000-0000-0000-0000-0000000000a1', '20460000-0000-0000-0000-00000000000a', 'Admin',        'rrpc-a1@example.com', 'Admin', 'active', null),
  ('20460000-0000-0000-0000-0000000000a2', '20460000-0000-0000-0000-00000000000a', 'PCM',          'rrpc-a2@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('20460000-0000-0000-0000-0000000000a3', '20460000-0000-0000-0000-00000000000a', 'Construction', 'rrpc-a3@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('20460000-0000-0000-0000-0000000000a4', '20460000-0000-0000-0000-00000000000a', 'PM',           'rrpc-a4@example.com', 'Project Manager', 'active', null),
  ('20460000-0000-0000-0000-0000000000a5', '20460000-0000-0000-0000-00000000000a', 'PM other',     'rrpc-a5@example.com', 'Project Manager', 'active', null),
  ('20460000-0000-0000-0000-0000000000a6', '20460000-0000-0000-0000-00000000000a', 'Planner',      'rrpc-a6@example.com', 'Engineer', 'active', 'planner'),
  ('20460000-0000-0000-0000-0000000000a7', '20460000-0000-0000-0000-00000000000a', 'PC engineer',  'rrpc-a7@example.com', 'Engineer', 'active', 'engineer'),
  ('20460000-0000-0000-0000-0000000000a8', '20460000-0000-0000-0000-00000000000a', 'QS',           'rrpc-a8@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('20460000-0000-0000-0000-0000000000a9', '20460000-0000-0000-0000-00000000000a', 'Proj admin',   'rrpc-a9@example.com', 'Engineer', 'active', 'project_administrator'),
  ('20460000-0000-0000-0000-0000000000b1', '20460000-0000-0000-0000-00000000000a', 'Engineer',     'rrpc-b1@example.com', 'Engineer', 'active', null),
  ('20460000-0000-0000-0000-0000000000b2', '20460000-0000-0000-0000-00000000000a', 'Field',        'rrpc-b2@example.com', 'Engineer', 'active', 'field_user'),
  ('20460000-0000-0000-0000-0000000000b9', '20460000-0000-0000-0000-00000000000b', 'Other admin',  'rrpc-b9@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('20460000-0000-0000-0000-0000000000c1', '20460000-0000-0000-0000-00000000000a', 'RRPC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '20460000-0000-0000-0000-0000000000a4'),
  ('20460000-0000-0000-0000-0000000000c9', '20460000-0000-0000-0000-00000000000b', 'Other org project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('20460000-0000-0000-0000-000000000e01', '20460000-0000-0000-0000-00000000000a', '20460000-0000-0000-0000-0000000000c1', 'L1', 'Pipe', 'm', 100, 10);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20460000-0000-0000-0000-000000000031', '20460000-0000-0000-0000-00000000000a', '20460000-0000-0000-0000-0000000000c1', 'RRPC WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('20460000-0000-0000-0000-000000000041', '20460000-0000-0000-0000-00000000000a', 'CA', 'Crew A');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('20460000-0000-0000-0000-00000000000a', '20460000-0000-0000-0000-000000000031', '20460000-0000-0000-0000-000000000041', current_date - 10);
insert into labour_cost_classes (id, org_id, code, name) values
  ('20460000-0000-0000-0000-000000000061', '20460000-0000-0000-0000-00000000000a', 'guard', 'Guard');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20460000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"20460000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.perf() returns text language sql as $$ select $p$select get_work_order_performance('20460000-0000-0000-0000-0000000000c1')$p$ $$;
create function pg_temp.section(p_code text) returns text language sql as $$
  select format('insert into work_order_sections (work_order_id, code, name) values (%L, %L, %L)', '20460000-0000-0000-0000-000000000031', p_code, 'Section ' || p_code) $$;
create function pg_temp.headcount() returns text language sql as $$
  select $h$select record_headcount_day('20460000-0000-0000-0000-000000000031', '20460000-0000-0000-0000-000000000041', current_date, '20460000-0000-0000-0000-000000000061', 4)$h$ $$;

-- ── revenue: the Project Control Manager reads, changes nothing ─────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.perf()), 'ok', 'RR-PC-01 the Project Control Manager reads cost-performance on a project it does not manage');
select is(pg_temp.val('a2', $$select dsr_may_see_revenue('20460000-0000-0000-0000-0000000000c1')::text$$), 'true', 'RR-PC-01 and its revenue');
select is(pg_temp.err('a2', $$select set_boq_item_discipline('20460000-0000-0000-0000-000000000e01', null)$$), '42501 you cannot change contract items on this project',
  'RR-PC-02 the Project Control Manager changes no revenue figure');
select is(pg_temp.err('a2', $$select get_work_order_performance('20460000-0000-0000-0000-0000000000c9')$$), 'P0002 project not found',
  'RR-PC-02 another organisation''s project is absent');
select is(pg_temp.err('a3', pg_temp.perf()), '42501 you cannot read revenue and cost on this project', 'RR-PC-03 a Construction Manager who does not manage the project is refused, as today');
select is(pg_temp.err('a5', pg_temp.perf()), '42501 you cannot read revenue and cost on this project', 'RR-PC-03 a Project Manager with no job role who does not manage it is refused, as today');
select is(pg_temp.err('a4', pg_temp.perf()), 'ok', 'RR-PC-03 the project''s own manager still reads it');
select is(pg_temp.err('a4', $$select set_boq_item_discipline('20460000-0000-0000-0000-000000000e01', null)$$), 'ok', 'RR-PC-03 and still changes it');
select is(pg_temp.err('a6', pg_temp.perf()), '42501 you cannot read revenue and cost on this project', 'RR-PC-04 the Planner reads no amounts');
select is(pg_temp.err('a7', pg_temp.perf()), '42501 you cannot read revenue and cost on this project', 'RR-PC-04 the project-control Engineer reads no amounts');
select is(pg_temp.val('a6', $$select dsr_may_see_revenue('20460000-0000-0000-0000-0000000000c1')::text$$), 'false', 'RR-PC-04 the revenue gate refuses the Planner');

-- ── sections ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a6', pg_temp.section('S1')), 'ok', 'RR-PC-06 the Planner adds a work order section');
select is(pg_temp.err('a6', $$update work_order_sections set name = 'Tie-in' where code = 'S1'$$), 'ok', 'RR-PC-06 and edits it');
select is((select name from work_order_sections where code = 'S1' and work_order_id = '20460000-0000-0000-0000-000000000031'), 'Tie-in', 'RR-PC-06 the edit is stored');
select is(pg_temp.err('a8', pg_temp.section('S2')), '42501 new row violates row-level security policy for table "work_order_sections"',
  'RR-PC-07 a Quantity Surveyor at the same access level cannot add a section');
select is(pg_temp.err('b1', pg_temp.section('S2')), '42501 new row violates row-level security policy for table "work_order_sections"',
  'RR-PC-07 an Engineer with no job role still cannot');
select is(pg_temp.err('b2', pg_temp.section('S2')), '42501 new row violates row-level security policy for table "work_order_sections"',
  'RR-PC-07 a field account cannot');

-- ── consumable plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a7', $$select cus_generate_plan('20460000-0000-0000-0000-000000000031')$$), 'ok', 'RR-PC-09 the Engineer generates a work order''s consumable plan');
select is(pg_temp.err('a8', $$select cus_generate_plan('20460000-0000-0000-0000-000000000031')$$), '42501 CUS_FORBIDDEN', 'RR-PC-10 a Quantity Surveyor cannot');
select is(pg_temp.err('b1', $$select cus_generate_plan('20460000-0000-0000-0000-000000000031')$$), '42501 CUS_FORBIDDEN', 'RR-PC-10 an Engineer with no job role still cannot');

-- ── head counts ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a8', pg_temp.headcount()), '42501 not authorized', 'RR-PC-12 a Quantity Surveyor cannot record a head count');
select is(pg_temp.err('b1', pg_temp.headcount()), '42501 not authorized', 'RR-PC-12 an Engineer with no job role still cannot');
select is(pg_temp.err('a9', pg_temp.headcount()), 'ok', 'RR-PC-11 the Project Administrator records a crew''s head count');
select is(pg_temp.val('a9', 'select count(*)::text from headcount_days'), '1', 'RR-PC-11 and reads it');
select isnt(pg_temp.err('a9', $$select approve_headcount_day((select id from headcount_days limit 1))$$), 'ok',
  'RR-PC-12 the Project Administrator never approves a head count');

select * from finish();
rollback;
