begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('25150000-0000-0000-0000-00000000000a', 'RR PC Org', 'IDR', 'UTC', true),
  ('25150000-0000-0000-0000-00000000000b', 'RR PC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('25150000-0000-0000-0000-0000000000' || k)::uuid, 'rrpc-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b9']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25150000-0000-0000-0000-0000000000a1', '25150000-0000-0000-0000-00000000000a', 'Admin',        'rrpc-a1@example.com', 'Admin', 'active', null),
  ('25150000-0000-0000-0000-0000000000a2', '25150000-0000-0000-0000-00000000000a', 'PCM',          'rrpc-a2@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('25150000-0000-0000-0000-0000000000a3', '25150000-0000-0000-0000-00000000000a', 'Construction', 'rrpc-a3@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('25150000-0000-0000-0000-0000000000a4', '25150000-0000-0000-0000-00000000000a', 'PM',           'rrpc-a4@example.com', 'Project Manager', 'active', null),
  ('25150000-0000-0000-0000-0000000000a5', '25150000-0000-0000-0000-00000000000a', 'PM other',     'rrpc-a5@example.com', 'Project Manager', 'active', null),
  ('25150000-0000-0000-0000-0000000000a6', '25150000-0000-0000-0000-00000000000a', 'Planner',      'rrpc-a6@example.com', 'Engineer', 'active', 'planner'),
  ('25150000-0000-0000-0000-0000000000a7', '25150000-0000-0000-0000-00000000000a', 'PC engineer',  'rrpc-a7@example.com', 'Engineer', 'active', 'engineer'),
  ('25150000-0000-0000-0000-0000000000a8', '25150000-0000-0000-0000-00000000000a', 'QS',           'rrpc-a8@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('25150000-0000-0000-0000-0000000000a9', '25150000-0000-0000-0000-00000000000a', 'Proj admin',   'rrpc-a9@example.com', 'Engineer', 'active', 'project_administrator'),
  ('25150000-0000-0000-0000-0000000000b1', '25150000-0000-0000-0000-00000000000a', 'Engineer',     'rrpc-b1@example.com', 'Engineer', 'active', null),
  ('25150000-0000-0000-0000-0000000000b2', '25150000-0000-0000-0000-00000000000a', 'Field',        'rrpc-b2@example.com', 'Engineer', 'active', 'field_user'),
  ('25150000-0000-0000-0000-0000000000b9', '25150000-0000-0000-0000-00000000000b', 'Other admin',  'rrpc-b9@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('25150000-0000-0000-0000-0000000000c1', '25150000-0000-0000-0000-00000000000a', 'RRPC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '25150000-0000-0000-0000-0000000000a4'),
  ('25150000-0000-0000-0000-0000000000c9', '25150000-0000-0000-0000-00000000000b', 'Other org project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25150000-0000-0000-0000-000000000e01', '25150000-0000-0000-0000-00000000000a', '25150000-0000-0000-0000-0000000000c1', 'L1', 'Pipe', 'm', 100, 10);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25150000-0000-0000-0000-000000000031', '25150000-0000-0000-0000-00000000000a', '25150000-0000-0000-0000-0000000000c1', 'RRPC WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('25150000-0000-0000-0000-000000000041', '25150000-0000-0000-0000-00000000000a', 'CA', 'Crew A');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25150000-0000-0000-0000-00000000000a', '25150000-0000-0000-0000-000000000031', '25150000-0000-0000-0000-000000000041', current_date - 10);
insert into labour_cost_classes (id, org_id, code, name) values
  ('25150000-0000-0000-0000-000000000061', '25150000-0000-0000-0000-00000000000a', 'guard', 'Guard');
update org_revenue_plan_settings set enabled = true where org_id = '25150000-0000-0000-0000-00000000000a';
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('25150000-0000-0000-0000-00000000000a', '25150000-0000-0000-0000-000000000031', '25150000-0000-0000-0000-000000000e01', 40);
insert into stock_units (id, org_id, code, name) values
  ('25150000-0000-0000-0000-000000000071', '25150000-0000-0000-0000-00000000000a', 'KG', 'Kilogram');
insert into stock_items (id, org_id, code, name, unit_id) values
  ('25150000-0000-0000-0000-000000000072', '25150000-0000-0000-0000-00000000000a', 'ROD', 'Welding rod', '25150000-0000-0000-0000-000000000071');
-- 0.5 kg of rod per metre of pipe, 10% margin: 40 m on the order -> 22 kg
insert into consumable_usage_standards (org_id, item_id, work_unit, boq_code_prefix, qty_per_unit, margin_pct) values
  ('25150000-0000-0000-0000-00000000000a', '25150000-0000-0000-0000-000000000072', 'm', null, 0.5, 10);

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"25150000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
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
  perform set_config('request.jwt.claims', '{"sub":"25150000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  return sqlstate;
end $$;

select set_config('request.jwt.claims','{}',true);
insert into people(id,org_id,code,name) values('25150000-0000-0000-0000-000000000088','25150000-0000-0000-0000-00000000000a','SRW','Worker');
update profiles set built_in_role='equipment_officer' where id='25150000-0000-0000-0000-0000000000a9';
insert into equipment_assets(id,org_id,code,name,default_unit) values
 ('25150000-0000-0000-0000-000000000091','25150000-0000-0000-0000-00000000000a','SRA','Asset','hours'),
 ('25150000-0000-0000-0000-000000000092','25150000-0000-0000-0000-00000000000b','SRB','Other asset','hours');
insert into equipment_status_days(org_id,asset_id,status_date,status) values
 ('25150000-0000-0000-0000-00000000000a','25150000-0000-0000-0000-000000000091',current_date,'ready');
-- AC-SR-001/003: job-role target entry, without contract-edit or cost-read rights.
select is(pg_temp.err('a2', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031', current_date, 120)$$), 'ok', 'AC-SR-001 PCM enters a day on a project managed by someone else');
select is(pg_temp.err('a6', $$select wo_revenue_plan_set_month('25150000-0000-0000-0000-000000000031', current_date, 1200)$$), 'ok', 'AC-SR-003 Planner enters monthly target');
select is(pg_temp.err('a6', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031', current_date, 75)$$), 'ok', 'AC-SR-003 Planner edits daily target');
select is((select amount from work_order_revenue_plan where work_order_id='25150000-0000-0000-0000-000000000031' and plan_date=current_date), 75::numeric, 'AC-SR-003 day edit persists');
select is(pg_temp.err('a6', $$select wo_revenue_plan_vs_actual('25150000-0000-0000-0000-000000000031')$$), 'ok', 'AC-SR-003 Planner reads just the work-order revenue plan');
select is(pg_temp.val('a6', $$select dsr_may_see_revenue('25150000-0000-0000-0000-0000000000c1')::text$$), 'false', 'AC-SR-003 general revenue gate stays closed');
select is(pg_temp.err('a6', $$select get_work_order_performance('25150000-0000-0000-0000-0000000000c1')$$), '42501 you cannot read revenue and cost on this project', 'AC-SR-003 Planner gains no cost performance read');
select is(pg_temp.err('a6', $$select project_revenue_plan_vs_actual('25150000-0000-0000-0000-0000000000c1')$$), '42501 WRP_ROLE', 'AC-SR-003 Planner gains no project revenue read');
select is(pg_temp.err('a2', $$select set_boq_item_discipline('25150000-0000-0000-0000-000000000e01',null)$$), '42501 you cannot change contract items on this project', 'AC-SR-001 PCM gains no contract-edit right');
select is(pg_temp.err('a7', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031', current_date, 1)$$), '42501 WRP_ROLE', 'AC-SR-001 unrelated Engineer still refused');
select is(pg_temp.err('b2', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031', current_date, 1)$$), '42501 LIGHT_ACCOUNT', 'AC-SR-001 field account refused');
select is(pg_temp.err('b9', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031', current_date, 1)$$), 'P0002 work order not found', 'AC-SR-001 other organisation refused');
select is(pg_temp.err('a6', $$select wo_daily_target_vs_actual('25150000-0000-0000-0000-000000000031')$$), '42501 WDT_ROLE', 'AC-SR-003 no other daily-target read is widened');
-- AC-SR-002: only work-order placement, never worker membership.
select is(pg_temp.err('a6', $$update work_order_crews set valid_to=current_date+7 where work_order_id='25150000-0000-0000-0000-000000000031'$$), 'ok', 'AC-SR-002 Planner ends a crew placement');
select is((select valid_to from work_order_crews where work_order_id='25150000-0000-0000-0000-000000000031'), current_date+7, 'AC-SR-002 placement edit persists');
select is(pg_temp.err('a6', $$insert into crew_members(crew_id,worker_id,valid_from) values('25150000-0000-0000-0000-000000000041','25150000-0000-0000-0000-000000000088',current_date)$$), '42501 new row violates row-level security policy for table "crew_members"', 'AC-SR-002 Planner cannot change worker membership');
select is(pg_temp.err('a8', $$update work_order_crews set valid_to=current_date+8 where work_order_id='25150000-0000-0000-0000-000000000031'$$), 'ok', 'AC-SR-002 unrelated role update touches no row');
select is((select valid_to from work_order_crews where work_order_id='25150000-0000-0000-0000-000000000031'), current_date+7, 'AC-SR-002 unrelated role changes nothing');
-- AC-SR-004: officer reads operational measures only.

select is(pg_temp.err('a9', $$select * from equipment_metrics(array['25150000-0000-0000-0000-000000000099']::uuid[],current_date,current_date,'month')$$), 'ok', 'AC-SR-004 Equipment Officer reads metrics');
select is(pg_temp.err('b1', $$select * from equipment_metrics(array['25150000-0000-0000-0000-000000000099']::uuid[],current_date,current_date,'month')$$), '42501 not authorized', 'AC-SR-004 unrelated engineer refused');
select is(pg_temp.val('a9', $$select count(*)::text from equipment_metrics(array['25150000-0000-0000-0000-000000000091','25150000-0000-0000-0000-000000000092']::uuid[],current_date,current_date,'month')$$), '1', 'AC-SR-004 only own-org asset is returned');
select is(pg_temp.val('a9', $$select availability_pct::text from equipment_metrics(array['25150000-0000-0000-0000-000000000091']::uuid[],current_date,current_date,'month')$$), '100.0', 'AC-SR-004 actual operational figure is returned');
select is(pg_temp.err('b2', $$select * from equipment_metrics(array['25150000-0000-0000-0000-000000000091']::uuid[],current_date,current_date,'month')$$), '42501 LIGHT_ACCOUNT', 'AC-SR-004 field account refused');
select is(pg_temp.err('a6', $$insert into work_order_crews(work_order_id,crew_id,valid_from) values('25150000-0000-0000-0000-000000000031','25150000-0000-0000-0000-000000000041',current_date+10)$$), 'ok', 'AC-SR-002 Planner creates a future placement');
select is(pg_temp.val('a6', $$select count(*)::text from work_order_crews where valid_from=current_date+10$$), '1', 'AC-SR-002 future placement persists');
select is(pg_temp.val('b9', $$select count(*)::text from work_order_crews where work_order_id='25150000-0000-0000-0000-000000000031'$$), '0', 'AC-SR-002 other organisation cannot read placement');
select is(pg_temp.err('b2', $$insert into work_order_crews(work_order_id,crew_id,valid_from) values('25150000-0000-0000-0000-000000000031','25150000-0000-0000-0000-000000000041',current_date+20)$$), '42501 new row violates row-level security policy for table "work_order_crews"', 'AC-SR-002 field account cannot plot crews');
select set_config('request.jwt.claims','{}',true);
update profiles set status='disabled' where id='25150000-0000-0000-0000-0000000000a6';
select is(left(pg_temp.err('a6', $$select wo_revenue_plan_set_day('25150000-0000-0000-0000-000000000031',current_date,1)$$),5), '42501', 'AC-SR-003 inactive Planner refused');
select * from finish(); rollback;
