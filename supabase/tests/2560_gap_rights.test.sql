begin;
create extension if not exists pgtap;
select no_plan();
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('25600000-0000-0000-0000-00000000000a', 'RR PC Org', 'IDR', 'UTC', true),
  ('25600000-0000-0000-0000-00000000000b', 'RR PC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('25600000-0000-0000-0000-0000000000' || k)::uuid, 'rrpc-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b9']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25600000-0000-0000-0000-0000000000a1', '25600000-0000-0000-0000-00000000000a', 'Admin',        'rrpc-a1@example.com', 'Admin', 'active', null),
  ('25600000-0000-0000-0000-0000000000a2', '25600000-0000-0000-0000-00000000000a', 'PCM',          'rrpc-a2@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('25600000-0000-0000-0000-0000000000a3', '25600000-0000-0000-0000-00000000000a', 'Construction', 'rrpc-a3@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('25600000-0000-0000-0000-0000000000a4', '25600000-0000-0000-0000-00000000000a', 'PM',           'rrpc-a4@example.com', 'Project Manager', 'active', null),
  ('25600000-0000-0000-0000-0000000000a5', '25600000-0000-0000-0000-00000000000a', 'PM other',     'rrpc-a5@example.com', 'Project Manager', 'active', null),
  ('25600000-0000-0000-0000-0000000000a6', '25600000-0000-0000-0000-00000000000a', 'Planner',      'rrpc-a6@example.com', 'Engineer', 'active', 'planner'),
  ('25600000-0000-0000-0000-0000000000a7', '25600000-0000-0000-0000-00000000000a', 'PC engineer',  'rrpc-a7@example.com', 'Engineer', 'active', 'equipment_officer'),
  ('25600000-0000-0000-0000-0000000000a8', '25600000-0000-0000-0000-00000000000a', 'QS',           'rrpc-a8@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('25600000-0000-0000-0000-0000000000a9', '25600000-0000-0000-0000-00000000000a', 'Proj admin',   'rrpc-a9@example.com', 'Engineer', 'active', 'project_administrator'),
  ('25600000-0000-0000-0000-0000000000b1', '25600000-0000-0000-0000-00000000000a', 'Engineer',     'rrpc-b1@example.com', 'Engineer', 'active', null),
  ('25600000-0000-0000-0000-0000000000b2', '25600000-0000-0000-0000-00000000000a', 'Field',        'rrpc-b2@example.com', 'Engineer', 'active', 'field_user'),
  ('25600000-0000-0000-0000-0000000000b9', '25600000-0000-0000-0000-00000000000b', 'Other admin',  'rrpc-b9@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('25600000-0000-0000-0000-0000000000c1', '25600000-0000-0000-0000-00000000000a', 'RRPC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '25600000-0000-0000-0000-0000000000a4'),
  ('25600000-0000-0000-0000-0000000000c9', '25600000-0000-0000-0000-00000000000b', 'Other org project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25600000-0000-0000-0000-000000000e01', '25600000-0000-0000-0000-00000000000a', '25600000-0000-0000-0000-0000000000c1', 'L1', 'Pipe', 'm', 100, 10);
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"25600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
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
  perform set_config('request.jwt.claims', '{"sub":"25600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;

insert into rate_catalogue_items (org_id,project_id,item_code,description,unit) values
('25600000-0000-0000-0000-00000000000a','25600000-0000-0000-0000-0000000000c1','RATE','Rate','m');
select is(pg_temp.val('a2', $$select count(*)::text from rate_catalogue_items$$), '1', 'AC-GR-002 PCM reads another manager catalogue');
select is(pg_temp.err('a7', $$insert into equipment_assets(code,name) values ('GR','Asset')$$), 'ok', 'AC-GR-001 officer registers asset');
select is(pg_temp.err('a7', $$update equipment_assets set name='Updated' where code='GR'$$), 'ok', 'AC-GR-001 officer edits asset');
select is(pg_temp.val('a7', $$select name from equipment_assets where code='GR'$$), 'Updated', 'AC-GR-001 edit persists');
select is(pg_temp.val('a7', $$with d as (delete from equipment_assets where code='GR' returning id) select count(*)::text from d$$), '0', 'AC-GR-001 officer cannot delete');
select is(pg_temp.val('a3', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a3');
select is(pg_temp.val('a5', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a5');
select is(pg_temp.val('a6', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a6');
select is(pg_temp.val('a7', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a7');
select is(pg_temp.val('a8', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a8');
select is(pg_temp.val('a9', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue a9');
select is(pg_temp.val('b1', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue b1');
select is(pg_temp.val('b2', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue b2');
select is(pg_temp.val('b9', $$select count(*)::text from rate_catalogue_items$$), '0', 'AC-GR-002 denied catalogue b9');
select isnt(pg_temp.err('a6', $$insert into equipment_assets(code,name) values ('deny-a6','Denied')$$), 'ok', 'AC-GR-001 other job cannot register a6');
select isnt(pg_temp.err('a8', $$insert into equipment_assets(code,name) values ('deny-a8','Denied')$$), 'ok', 'AC-GR-001 other job cannot register a8');
select isnt(pg_temp.err('a9', $$insert into equipment_assets(code,name) values ('deny-a9','Denied')$$), 'ok', 'AC-GR-001 other job cannot register a9');
select isnt(pg_temp.err('b1', $$insert into equipment_assets(code,name) values ('deny-b1','Denied')$$), 'ok', 'AC-GR-001 other job cannot register b1');
select isnt(pg_temp.err('b2', $$insert into equipment_assets(code,name) values ('deny-b2','Denied')$$), 'ok', 'AC-GR-001 other job cannot register b2');
select is(pg_temp.val('b9', $$select count(*)::text from equipment_assets where code='GR'$$), '0', 'AC-GR-001 other org cannot see asset');
select isnt(pg_temp.err('a7', $$insert into equipment_assets(code,name,org_id) values ('spoof','Denied','25600000-0000-0000-0000-00000000000b')$$), 'ok', 'AC-GR-001 column grants prohibit org spoof');
select ok(exists(select 1 from information_schema.role_table_grants where grantee='authenticated' and table_name='rate_catalogue_items' and privilege_type='SELECT'), 'catalogue SELECT reachable');
select ok(not has_table_privilege('authenticated','rate_catalogue_items','INSERT'), 'catalogue direct writes remain refused');
select ok(has_function_privilege('authenticated','public.rate_catalogue_rate_at(uuid,uuid,date)','EXECUTE'), 'price invoker remains reachable');
select ok(not has_function_privilege('anon','public.rate_catalogue_rate_at(uuid,uuid,date)','EXECUTE'), 'anonymous routine refused');
select is((select count(*)::integer from pg_policies where schemaname='public' and policyname in ('equipment_officer_insert','equipment_officer_update','rate_catalogue_items_pcm_read','rate_catalogue_variants_pcm_read')),4, 'four scoped policies installed');
select ok(exists(select 1 from pg_policies where tablename='rate_catalogue_items' and policyname='light_account_deny_select' and permissive='RESTRICTIVE'), 'field read restriction retained');
select * from finish(); rollback;
