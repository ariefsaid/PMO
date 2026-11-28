-- Post-migration catalogue and real-JWT contract, independent of migration-file text.
-- Named-role admission edges are exhaustively enumerated from live pg_proc/pg_policies.
-- Existing budget/BOQ visibility is not revoked: "only" below means the new role admission,
-- not a claim that these jobs had no financial access before this change.
-- Mutation recipe (inside a rollback transaction): add a Planner revenue-table policy;
-- remove PCM from the live writable-WO body; remove Officer from the live metrics body.
-- Each must fail its named AC-SRCAT assertion; never commit a mutated rule.
begin;
create extension if not exists pgtap;
select no_plan();
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('25190000-0000-0000-0000-00000000000a', 'RR PC Org', 'IDR', 'UTC', true),
  ('25190000-0000-0000-0000-00000000000b', 'RR PC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email)
select ('25190000-0000-0000-0000-0000000000' || k)::uuid, 'rrpc-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8','a9','b1','b2','b9']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('25190000-0000-0000-0000-0000000000a1', '25190000-0000-0000-0000-00000000000a', 'Admin',        'rrpc-a1@example.com', 'Admin', 'active', null),
  ('25190000-0000-0000-0000-0000000000a2', '25190000-0000-0000-0000-00000000000a', 'PCM',          'rrpc-a2@example.com', 'Project Manager', 'active', 'project_control_manager'),
  ('25190000-0000-0000-0000-0000000000a3', '25190000-0000-0000-0000-00000000000a', 'Construction', 'rrpc-a3@example.com', 'Project Manager', 'active', 'construction_manager'),
  ('25190000-0000-0000-0000-0000000000a4', '25190000-0000-0000-0000-00000000000a', 'PM',           'rrpc-a4@example.com', 'Project Manager', 'active', null),
  ('25190000-0000-0000-0000-0000000000a5', '25190000-0000-0000-0000-00000000000a', 'PM other',     'rrpc-a5@example.com', 'Project Manager', 'active', null),
  ('25190000-0000-0000-0000-0000000000a6', '25190000-0000-0000-0000-00000000000a', 'Planner',      'rrpc-a6@example.com', 'Engineer', 'active', 'planner'),
  ('25190000-0000-0000-0000-0000000000a7', '25190000-0000-0000-0000-00000000000a', 'PC engineer',  'rrpc-a7@example.com', 'Engineer', 'active', 'engineer'),
  ('25190000-0000-0000-0000-0000000000a8', '25190000-0000-0000-0000-00000000000a', 'QS',           'rrpc-a8@example.com', 'Engineer', 'active', 'quantity_surveyor'),
  ('25190000-0000-0000-0000-0000000000a9', '25190000-0000-0000-0000-00000000000a', 'Proj admin',   'rrpc-a9@example.com', 'Engineer', 'active', 'project_administrator'),
  ('25190000-0000-0000-0000-0000000000b1', '25190000-0000-0000-0000-00000000000a', 'Engineer',     'rrpc-b1@example.com', 'Engineer', 'active', null),
  ('25190000-0000-0000-0000-0000000000b2', '25190000-0000-0000-0000-00000000000a', 'Field',        'rrpc-b2@example.com', 'Engineer', 'active', 'field_user'),
  ('25190000-0000-0000-0000-0000000000b9', '25190000-0000-0000-0000-00000000000b', 'Other admin',  'rrpc-b9@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency, contract_value, tax_treatment, tax_amount, project_manager_id) values
  ('25190000-0000-0000-0000-0000000000c1', '25190000-0000-0000-0000-00000000000a', 'RRPC project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, '25190000-0000-0000-0000-0000000000a4'),
  ('25190000-0000-0000-0000-0000000000c9', '25190000-0000-0000-0000-00000000000b', 'Other org project', 'Ongoing Project', 'IDR', 1000000, 'exclusive', 0, null);
insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('25190000-0000-0000-0000-000000000e01', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000c1', 'L1', 'Pipe', 'm', 100, 10);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25190000-0000-0000-0000-000000000031', '25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-0000000000c1', 'RRPC WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('25190000-0000-0000-0000-000000000041', '25190000-0000-0000-0000-00000000000a', 'CA', 'Crew A');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25190000-0000-0000-0000-00000000000a', '25190000-0000-0000-0000-000000000031', '25190000-0000-0000-0000-000000000041', current_date - 10);
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"25190000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
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
  perform set_config('request.jwt.claims', '{"sub":"25190000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
exception when others then
  execute 'reset role';
  return sqlstate;
end $$;


select set_config('request.jwt.claims','{}',true);
insert into auth.users(id,email) values
 ('25190000-0000-0000-0000-0000000000c1','catalog-finance@example.com'),
 ('25190000-0000-0000-0000-0000000000c2','catalog-executive@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('25190000-0000-0000-0000-0000000000c1','25190000-0000-0000-0000-00000000000a','Finance','catalog-finance@example.com','Finance','active'),
 ('25190000-0000-0000-0000-0000000000c2','25190000-0000-0000-0000-00000000000a','Executive','catalog-executive@example.com','Executive','active');
update org_revenue_plan_settings set enabled=true where org_id='25190000-0000-0000-0000-00000000000a';
update profiles set built_in_role='equipment_officer' where id='25190000-0000-0000-0000-0000000000a9';
insert into work_order_revenue_plan(org_id,project_id,work_order_id,plan_date,amount,source)
values('25190000-0000-0000-0000-00000000000a','25190000-0000-0000-0000-0000000000c1','25190000-0000-0000-0000-000000000031',current_date,100,'date');
insert into equipment_assets(id,org_id,code,name,default_unit)
values('25190000-0000-0000-0000-000000000091','25190000-0000-0000-0000-00000000000a','CAT-A','Catalogue asset','hours');

-- Real head catalogue, captured before changing SQL role. These are not migration parsers.
create temp table cat_functions as
select p.oid, p.proname::text, p.prosrc, p.prosecdef, p.proargtypes,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prokind='f';
create temp table cat_policies as select * from pg_policies where schemaname='public';

-- Effective function ACLs AND explicit catalogue grants, including inherited/PUBLIC reachability.
select is(array(select grantee::text from information_schema.routine_privileges
 where routine_schema='public' and routine_name=f.name order by grantee),
 case when f.name in ('wrp_writable_work_order','run_document_expiry_warnings')
 then array['postgres','service_role'] else array['authenticated','postgres','service_role'] end,
 'AC-SRCAT-ACL exact routine grantees: '||f.name)
from unnest(array['wrp_writable_work_order','wo_revenue_plan_vs_actual','wo_revenue_plan_set_day',
 'wo_revenue_plan_set_month','wo_revenue_plan_clear','equipment_metrics','run_document_expiry_warnings']) f(name);
select ok(not has_function_privilege('anon',oid,'EXECUTE'),
 'AC-SRCAT-ANON no effective anonymous execute: '||proname)
from cat_functions where proname in ('wrp_writable_work_order','wo_revenue_plan_vs_actual',
 'wo_revenue_plan_set_day','wo_revenue_plan_set_month','wo_revenue_plan_clear','equipment_metrics','run_document_expiry_warnings');
select ok(prosecdef,'AC-SRCAT-ACL definer boundary retained: '||proname)
from cat_functions where proname in ('wrp_writable_work_order','wo_revenue_plan_vs_actual','equipment_metrics','run_document_expiry_warnings');
select is(array(select privilege_type::text from information_schema.role_table_grants
 where table_schema='public' and table_name=t.name and grantee='authenticated' order by privilege_type),
 case when t.name='work_order_revenue_plan' then array['SELECT'] else array['DELETE','SELECT'] end,
 'AC-SRCAT-ACL exact authenticated table grants: '||t.name)
from unnest(array['work_order_revenue_plan','work_order_crews','crew_members','equipment_assets']) t(name);
select is((select count(*)::int from information_schema.role_table_grants
 where table_schema='public' and table_name in ('work_order_revenue_plan','work_order_crews','crew_members','equipment_assets')
 and grantee in ('anon','PUBLIC')),0,'AC-SRCAT-ANON no anonymous or PUBLIC table grants');
select is(array(select column_name::text from information_schema.column_privileges
 where table_schema='public' and table_name='work_order_crews' and grantee='authenticated' and privilege_type='UPDATE' order by column_name),
 array['valid_from','valid_to'],'AC-SRCAT-ACL placements expose date updates only, no reassignment columns');

select ok(not has_any_column_privilege('anon',format('public.%I',t.name),'SELECT,INSERT,UPDATE,REFERENCES'),
 'AC-SRCAT-ANON no effective anonymous column access: '||t.name)
from unnest(array['work_order_revenue_plan','work_order_crews','crew_members','equipment_assets']) t(name);
select is(array(select column_name::text from information_schema.column_privileges
 where table_schema='public' and table_name='work_order_crews' and grantee='authenticated' and privilege_type='INSERT' order by column_name),
 array['crew_id','id','section_id','valid_from','valid_to','work_order_id'],
 'AC-SRCAT-ACL exact placement creation columns retain server organisation stamp');
-- Exhaustive new admission edges across ALL public functions and policies at migrated head.
select is(array(select proname from cat_functions where prosrc ~* $re$actor_holds_job_role[[:space:]]*\([[:space:]]*'planner'$re$ order by proname),
 array['check_task_work_order','enforce_assignee_status_only','guard_work_order_section','wo_revenue_plan_vs_actual','wrp_writable_work_order'],
 'AC-SRCAT-PLANNER no other direct Planner function admission');
select is(array(select proname from cat_functions where prosrc ~* $re$actor_holds_job_role[[:space:]]*\([[:space:]]*'equipment_officer'$re$ order by proname),
 array['create_rented_equipment_asset','equipment_can_edit_terms','equipment_metrics'],
 'AC-SRCAT-OFFICER only operational metrics, rented-asset registration and the rental-terms check admit Equipment Officer');
select is(array(select m[1] from cat_functions f cross join lateral
 regexp_matches(f.prosrc,$re$actor_holds_job_role[[:space:]]*\([[:space:]]*'([^']+)'$re$,'gi') m
 where f.proname='wrp_writable_work_order' order by m[1]),
 array['planner','project_control_manager'],'AC-SRCAT-WRITES only the two named job roles extend the target writer');
select is(array(select proname from cat_functions where prosrc ~* $re$wrp_writable_work_order[[:space:]]*\($re$ order by proname),
 array['wo_revenue_plan_clear','wo_revenue_plan_set_day','wo_revenue_plan_set_month'],
 'AC-SRCAT-WRITES only day/month/clear commands inherit the target writer admission');
select is(array(select proname from cat_functions where prosrc ~* $re$(wo_revenue_plan_vs_actual|equipment_metrics)[[:space:]]*\($re$ order by proname),
 array[]::text[],'AC-SRCAT-READS no other function inherits either newly admitted read');
select is(array(select tablename||':'||policyname from cat_policies
 where coalesce(qual,'')||coalesce(with_check,'') ~* $re$actor_holds_job_role[[:space:]]*\([[:space:]]*'planner'$re$ order by tablename,policyname),
 array['task_dependencies:task_dependencies_planner_write','tasks:tasks_planner_update',
 'work_order_crews:work_order_crews_insert','work_order_crews:work_order_crews_update',
 'work_order_sections:work_order_sections_insert','work_order_sections:work_order_sections_update'],
 'AC-SRCAT-PLANNER no financial table policy admits Planner (task links and dependencies are scheduling, not money)');
-- DD-R1124-17 deliberately adds only asset-register create/edit and rental terms (register a rented asset, edit and read its terms) for the Equipment Officer.
select is(array(select tablename||':'||policyname||':'||cmd from cat_policies
 where coalesce(qual,'')||coalesce(with_check,'') ~* $re$actor_holds_job_role[[:space:]]*\([[:space:]]*'equipment_officer'$re$ order by tablename,policyname,cmd),
 array['equipment_assets:equipment_officer_insert:INSERT','equipment_assets:equipment_officer_update:UPDATE',
 'equipment_rental_terms:equipment_rental_terms_select:SELECT'],
 'AC-SRCAT-OFFICER only asset-register insert/update and the rental-terms read admit Officer');
select ok(exists(select 1 from cat_policies where tablename='work_order_revenue_plan'
 and cmd='SELECT' and qual like '%dsr_may_see_revenue%'),
 'AC-SRCAT-PLANNER direct plan table still uses the general revenue gate');
select ok(exists(select 1 from cat_policies where tablename=t.name and cmd=c.cmd
 and permissive='RESTRICTIVE' and coalesce(qual,with_check) like '%actor_is_light%'),
 'AC-SRCAT-FIELD restrictive field policy on '||t.name||' '||c.cmd)
from unnest(array['work_order_revenue_plan','work_order_crews','crew_members']) t(name)
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) c(cmd)
where t.name<>'work_order_revenue_plan' or c.cmd='SELECT';

-- Execute against real fixtures: identical authenticated SQL role, different real profiles.
select is(pg_temp.err('a6',$$select wo_revenue_plan_vs_actual('25190000-0000-0000-0000-000000000031')$$),
 'ok','AC-SRCAT-PLANNER authenticated Planner reaches precisely the work-order read');
select is(pg_temp.val('a6',$$select count(*)::text from work_order_revenue_plan$$),'0',
 'AC-SRCAT-PLANNER no direct financial-plan table read, despite authenticated SELECT grant');
select is(pg_temp.val('a6',$$select dsr_may_see_revenue('25190000-0000-0000-0000-0000000000c1')::text$$),'false',
 'AC-SRCAT-PLANNER the shared gate for other financial tables and readers stays false');
select is(left(pg_temp.err('a6',c.sql),5),'42501','AC-SRCAT-PLANNER other financial entry refused: '||c.name)
from (values
 ('project plan',$$select project_revenue_plan_vs_actual('25190000-0000-0000-0000-0000000000c1')$$),
 ('daily targets',$$select wo_daily_target_vs_actual('25190000-0000-0000-0000-000000000031')$$),
 ('project daily targets',$$select project_daily_target_vs_actual('25190000-0000-0000-0000-0000000000c1')$$),
 ('cost performance',$$select get_work_order_performance('25190000-0000-0000-0000-0000000000c1')$$),
 ('discipline revenue',$$select project_discipline_revenue('25190000-0000-0000-0000-0000000000c1')$$),
 ('earned and billed',$$select project_work_order_earned_billed('25190000-0000-0000-0000-0000000000c1')$$),
 ('validated revenue',$$select work_order_validated_revenue('25190000-0000-0000-0000-000000000031')$$)
) c(name,sql);
select is(pg_temp.err('a9',$$select * from equipment_metrics(array['25190000-0000-0000-0000-000000000091']::uuid[],current_date,current_date,'month')$$),
 'ok','AC-SRCAT-OFFICER authenticated Officer reaches availability');
select is(left(pg_temp.err('a9',$$select get_work_order_performance('25190000-0000-0000-0000-0000000000c1')$$),5),'42501',
 'AC-SRCAT-OFFICER no cost performance read');
select is(pg_temp.val('a9',$$select count(*)::text from work_order_revenue_plan$$),'0','AC-SRCAT-OFFICER no direct plan table read');

select is(pg_temp.val('b2',$$select count(*)::text from work_order_revenue_plan$$),'0','AC-SRCAT-FIELD direct financial table remains hidden');
-- Senior-role/owning-PM legacy rights are retained; only PCM and Planner are added.
select is(pg_temp.err(a.actor,$$select wo_revenue_plan_set_day('25190000-0000-0000-0000-000000000031',current_date,100)$$),a.result,
 'AC-SRCAT-WRITES target writer matrix: '||a.job)
from (values ('a1','Admin','ok'),('c1','Finance','ok'),('c2','Executive','ok'),('a2','PCM','ok'),('a4','own PM','ok'),('a6','Planner','ok'),
 ('a3','Construction Manager','42501 WRP_ROLE'),('a5','unassigned PM','42501 WRP_ROLE'),
 ('a7','Engineer','42501 WRP_ROLE'),('a8','QS','42501 WRP_ROLE'),('a9','Equipment Officer','42501 WRP_ROLE'),
 ('b1','no job role','42501 WRP_ROLE'),('b2','field account','42501 LIGHT_ACCOUNT'),('b9','other organisation','P0002 work order not found')) a(actor,job,result);
select is(pg_temp.err('a6',$$update work_order_crews set valid_to=current_date+5 where work_order_id='25190000-0000-0000-0000-000000000031'$$),
 'ok','AC-SRCAT-PLANNER placement edit is reachable through column grants and RLS');
select is((select valid_to from work_order_crews where work_order_id='25190000-0000-0000-0000-000000000031'),current_date+5,
 'AC-SRCAT-PLANNER catalogue-authorized placement edit persists');
select is(pg_temp.val('a6',$$select crew_can_manage()::text$$),'false','AC-SRCAT-PLANNER no shared crew/member writer right');
select is(left(pg_temp.err('b2',$$select wo_revenue_plan_vs_actual('25190000-0000-0000-0000-000000000031')$$),5),'42501',
 'AC-SRCAT-FIELD no plan RPC admission');
select is(left(pg_temp.err('b2',$$select * from equipment_metrics(array['25190000-0000-0000-0000-000000000091']::uuid[],current_date,current_date,'month')$$),5),'42501',
 'AC-SRCAT-FIELD no availability RPC admission');

select is(pg_temp.err('b2',$$update work_order_crews set valid_to=current_date+9 where work_order_id='25190000-0000-0000-0000-000000000031'$$),
 'ok','AC-SRCAT-FIELD placement UPDATE touches no row');
select is((select valid_to from work_order_crews where work_order_id='25190000-0000-0000-0000-000000000031'),current_date+5,
 'AC-SRCAT-FIELD no placement update gained through authenticated column grant');
-- View-as is presentation state, not a new database identity. Deliberately supply misleading
-- presentation claims while keeping the real signed-in sub; even these cannot change rights.
create function pg_temp.claimed(p_actor text,p_sql text) returns text language plpgsql as $$
declare v text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','25190000-0000-0000-0000-0000000000'||p_actor,
 'role','authenticated','effective_role','Admin','view_as_role','Admin','built_in_role','planner',
 'app_metadata',jsonb_build_object('role','Admin','built_in_role','planner'))::text,true);
 execute 'set local role authenticated'; execute p_sql into v; execute 'reset role'; return v;
exception when others then execute 'reset role'; return sqlstate;
end $$;
select is(pg_temp.claimed('b1',$$select actor_built_in_role()$$),null::text,'AC-SRCAT-VIEW real job key ignores presentation claims');
select is(pg_temp.claimed('b1',$$select wo_revenue_plan_set_day('25190000-0000-0000-0000-000000000031',current_date,1)$$),'42501',
 'AC-SRCAT-VIEW Engineer pretending to view as Planner/Admin gains no write');
select is(pg_temp.claimed('a6',$$select dsr_may_see_revenue('25190000-0000-0000-0000-0000000000c1')::text$$),'false',
 'AC-SRCAT-VIEW Planner viewing as Admin gains no general revenue/cost read');
select is(pg_temp.claimed('a2',$$select dsr_may_see_revenue('25190000-0000-0000-0000-0000000000c1')::text$$),'true',
 'AC-SRCAT-VIEW real PCM retains its own role boundary');
select * from finish();
rollback;
