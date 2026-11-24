-- Effective API-role catalogue, evaluated after every migration. Runtime job-role boundaries are in the companion test.
begin;
create extension if not exists pgtap;
select no_plan();
select ok(exists(select 1 from supabase_migrations.schema_migrations where version='2571'),'AC-RRC-001 revised migration is applied');
select is((select array_agg(grantee||':'||privilege_type order by grantee,privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name=t.name and grantee in ('PUBLIC','anon','authenticated')),
 case when t.name in ('organizations','procurements','procurement_status_events') then array['anon:SELECT','authenticated:SELECT'] else array['authenticated:SELECT'] end,
 'AC-RRC-002 explicit table grants '||t.name)
from unnest(array['organizations','equipment_plans','equipment_plan_lines','procurements','procurement_status_events']) t(name);
select ok(not has_table_privilege(r.name,t.name,p.name),'AC-RRC-003 effective denied table write '||r.name||'.'||t.name||'.'||p.name)
from unnest(array['anon','authenticated']) r(name),unnest(array['equipment_plans','equipment_plan_lines','procurement_status_events']) t(name),unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p(name);
select ok(not has_column_privilege(r.name,'procurements',c.name,'UPDATE'),'AC-RRC-004 server-managed purchase column '||r.name||'.'||c.name)
from unnest(array['anon','authenticated']) r(name),unnest(array['status','approved_by_id','approved_total_value','amount_approved_by_id']) c(name);
select ok(not has_column_privilege('authenticated','procurements','requested_by_id','UPDATE'),'AC-RRC-005 requester identity is server managed');
select is((select array_agg(grantee||':'||privilege_type order by grantee,privilege_type) from information_schema.role_column_grants where table_schema='public' and table_name='organizations' and column_name='qs_report_revenue_enabled' and grantee in ('PUBLIC','anon','authenticated')),array['anon:SELECT','authenticated:SELECT','authenticated:UPDATE'],'AC-RRC-006 switch column grants');
select ok(has_column_privilege('authenticated','organizations','qs_report_revenue_enabled','UPDATE') and not has_column_privilege('anon','organizations','qs_report_revenue_enabled','UPDATE'),'AC-RRC-007 effective switch grant');
select ok(p.prosecdef and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%','AC-RRC-008 definer and fixed search path '||p.oid::regprocedure::text)
from pg_proc p where p.oid=any(array['public.dsr_report_revenue(uuid)'::regprocedure,'public.equipment_plan_purchase_submit_context(uuid)'::regprocedure,'public.transition_procurement(uuid,public.procurement_status,text)'::regprocedure,'public.approve_equipment_plan(uuid)'::regprocedure,'public.guard_equipment_plan_purchase_submitter()'::regprocedure]);
select ok(has_function_privilege('authenticated',f.name,'EXECUTE') and not has_function_privilege('anon',f.name,'EXECUTE'),'AC-RRC-009 effective RPC grants '||f.name)
from unnest(array['public.dsr_report_revenue(uuid)','public.equipment_plan_purchase_submit_context(uuid)','public.transition_procurement(uuid,public.procurement_status,text)','public.approve_equipment_plan(uuid)']) f(name);
select ok(not has_function_privilege(r.name,'public.guard_equipment_plan_purchase_submitter()','EXECUTE'),'AC-RRC-010 internal trigger not callable '||r.name) from unnest(array['anon','authenticated']) r(name);
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=any(array['public.dsr_report_revenue(uuid)'::regprocedure,'public.equipment_plan_purchase_submit_context(uuid)'::regprocedure,'public.transition_procurement(uuid,public.procurement_status,text)'::regprocedure,'public.approve_equipment_plan(uuid)'::regprocedure,'public.guard_equipment_plan_purchase_submitter()'::regprocedure]) and a.grantee=0 and a.privilege_type='EXECUTE'),'AC-RRC-011 PUBLIC cannot execute touched routines');
select ok(exists(select 1 from pg_trigger where tgrelid='public.procurements'::regclass and tgname=t.name and tgenabled='O'),'AC-RRC-012 retained enabled purchase guard '||t.name)
from unnest(array['procurements_guard_plan_submitter','procurements_guard_plan_author','procurements_origination_guard','procurements_routing_inputs_frozen','procurements_approved_total_guard','procurements_record_only_status','zz_cost_attribution_check']) t(name);
select ok(relrowsecurity and relforcerowsecurity,'AC-RRC-013 forced RLS '||relname) from pg_class where oid=any(array['public.organizations'::regclass,'public.equipment_plans'::regclass,'public.equipment_plan_lines'::regclass,'public.procurements'::regclass,'public.procurement_status_events'::regclass]);
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='organizations' and cmd in ('UPDATE','ALL') and permissive='PERMISSIVE' and (coalesce(qual,'') not like '%auth_org_id()%' or coalesce(qual,'') not like '%is_active_member()%' or coalesce(qual,'') not like '%''Admin''%' or coalesce(with_check,'') not like '%auth_org_id()%' or coalesce(with_check,'') not like '%is_active_member()%' or coalesce(with_check,'') not like '%''Admin''%')),'AC-RRC-014 every permissive organisation write policy requires own org active Admin');
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='procurements' and permissive='RESTRICTIVE'),'AC-RRC-015 purchase policy composition retains restrictive scope');
select is(coalesce((select array_agg(grantee||':'||privilege_type order by grantee,privilege_type) from information_schema.routine_privileges where routine_schema='public' and routine_name=f.name and grantee in ('PUBLIC','anon','authenticated')),array[]::text[]),case when f.name='guard_equipment_plan_purchase_submitter' then array[]::text[] else array['authenticated:EXECUTE'] end,'AC-RRC-016 explicit routine privilege '||f.name)
from unnest(array['dsr_report_revenue','equipment_plan_purchase_submit_context','transition_procurement','approve_equipment_plan','guard_equipment_plan_purchase_submitter']) f(name);
select ok((select q.qual=t.qual and q.with_check=t.with_check and q.roles=array['authenticated']::name[] from pg_policies q join pg_policies t on t.schemaname=q.schemaname and t.tablename=q.tablename where q.schemaname='public' and q.tablename='organizations' and q.policyname='organizations_update_qs_report_revenue' and t.policyname='organizations_update_tax_default'),'AC-RRC-017 new policy exactly matches the retained own-org active Admin predicate');
set local request.jwt.claims='{"role":"anon"}';
set local role anon;
select is((select count(*)::int from organizations),0,'AC-RRC-018 anon reaches no organisation row');
select is((select count(*)::int from procurements),0,'AC-RRC-018 anon reaches no purchase row');
select is((select count(*)::int from procurement_status_events),0,'AC-RRC-018 anon reaches no submission history');
select throws_ok($$select * from equipment_plans$$,'42501',null,'AC-RRC-019 anon cannot read plans');
select throws_ok($$select * from equipment_plan_lines$$,'42501',null,'AC-RRC-019 anon cannot read provenance lines');
select throws_ok($$select * from dsr_report_revenue('00000000-0000-0000-0000-000000000000')$$,'42501',null,'AC-RRC-019 anon cannot invoke the priced report read');
select throws_ok($$select equipment_plan_purchase_submit_context('00000000-0000-0000-0000-000000000000')$$,'42501',null,'AC-RRC-019 anon cannot invoke submission context');
reset role;
select ok(not has_column_privilege(r.name,'dsr_progress_lines',c.name,'SELECT'),'AC-RRC-020 raw priced progress is not directly selectable '||r.name||'.'||c.name)
from unnest(array['anon','authenticated']) r(name),unnest(array['frozen_rate','frozen_amount','frozen_rate_id','frozen_rate_source']) c(name);
select * from finish(); rollback;
