-- #2286 PR B: the down for 0905 restores the 0866 batch, the 0868 group apply and the 0866 fence trigger (organizations back on
-- fence_capture_source_change, fence_capture_org_change gone); a batch then answers what 0905's answered, apart from 0905's
-- group_count, sources_per_call and its revision count; the up then applies again.
-- scripts/test-2286-capture-apply-rollback.sh inlines the down and the up. One transaction; nothing is left behind.
begin;
select plan(13);
set local track_functions = 'all';
insert into organizations (id,name,default_currency) values ('22860900-0000-0000-0000-000000000001','Rollback 2286 B','USD');
insert into auth.users (id,email) values ('22860900-0000-0000-0000-000000000002','rollback-2286b@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('22860900-0000-0000-0000-000000000002','22860900-0000-0000-0000-000000000001','Admin','rollback-2286b@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('22860900-0000-0000-0000-000000000003','22860900-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('22860900-0000-0000-0000-000000000004','22860900-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('22860900-0000-0000-0000-000000000001','companies','22860900-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('22860900-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"22860900-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
insert into budget_category_account_map (org_id,category,erp_account) values ('22860900-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
select b.org_id,b.id,k.kind,now(),case when k.kind='ledger' then 'USD' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='22860900-0000-0000-0000-000000000001';
-- Two identical sets of three one-order families: one batch before the down (U), one after it (D).
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
select '22860900-0000-0000-0000-000000000001','Purchase Order',s||'-'||n,'SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['22860900-0000-0000-0000-000000000003'::uuid],'2026-02-01'
from unnest(array['U','D']) s cross join generate_series(1,3) n;
create function pg_temp.batch(p_set text, v_revision text) returns jsonb language plpgsql as $$
declare v jsonb; v_groups jsonb; begin
  select jsonb_agg(jsonb_build_object('project_id','22860900-0000-0000-0000-000000000003','source_ids',jsonb_build_array(id::text)) order by erp_name) into v_groups
    from erp_purchase_documents where org_id='22860900-0000-0000-0000-000000000001' and erp_name like p_set || '-%';
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v := public.capture_history_batch('22860900-0000-0000-0000-000000000002','22860900-0000-0000-0000-000000000003',
    case p_set when 'U' then '22860900-0000-0000-0000-000000000011' else '22860900-0000-0000-0000-000000000012' end::uuid,v_revision,'{"order":2}'::jsonb,v_groups);
  execute 'reset role';
  return v;
end $$;
create function pg_temp.revisions() returns bigint language sql as $$
  select coalesce((select calls from pg_stat_xact_user_functions where schemaname='public' and funcname='capture_revision'),0)
$$;
create temp table answers(name text primary key, value jsonb);
select set_config('rb.revision',public.capture_revision('22860900-0000-0000-0000-000000000001'),true) is not null;
select set_config('rb.calls',pg_temp.revisions()::text,true) is not null;
insert into answers values ('up',pg_temp.batch('U',current_setting('rb.revision')));
insert into answers values ('up_calls',to_jsonb(pg_temp.revisions() - current_setting('rb.calls')::bigint));

select lives_ok($down$
-- @0905_DOWN@
$down$,'#2286 the down for 0905 runs');
select is((select p.proname::text from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.organizations'::regclass and t.tgname='capture_census_fence'),
  'fence_capture_source_change','#2286 organizations is fenced by fence_capture_source_change again');
select is(to_regprocedure('public.fence_capture_org_change()'),null,'#2286 fence_capture_org_change is gone');
select ok(has_function_privilege('service_role','public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb)','execute')
  and not has_function_privilege('authenticated','public.capture_history_batch(uuid,uuid,uuid,text,jsonb,jsonb)','execute'),'#2286 the restored batch keeps its grants');
select throws_ok($$select public.capture_history_batch('22860900-0000-0000-0000-000000000002','22860900-0000-0000-0000-000000000003','22860900-0000-0000-0000-000000000011','r',null,null)$$,
  '22023',null,'#2286 the restored batch refuses a call with no precision as an invalid request, as 0905''s does');
select set_config('rb.revision',public.capture_revision('22860900-0000-0000-0000-000000000001'),true) is not null;
select set_config('rb.calls',pg_temp.revisions()::text,true) is not null;
insert into answers values ('down',pg_temp.batch('D',current_setting('rb.revision')));
insert into answers values ('down_calls',to_jsonb(pg_temp.revisions() - current_setting('rb.calls')::bigint));
select is((select jsonb_path_query_array(value,'$.results[*].outcome') from answers where name='down'),(select jsonb_path_query_array(value,'$.results[*].outcome') from answers where name='up'),
  '#2286 the restored batch creates what 0905''s created');
select is((select value - 'results' - 'group_count' - 'sources_per_call' from answers where name='down'),(select value - 'results' - 'group_count' - 'sources_per_call' from answers where name='up'),
  '#2286 the restored batch answers what 0905''s answered, apart from group_count and sources_per_call');
select is((select jsonb_build_object('group_count',value->'group_count','sources_per_call',value->'sources_per_call') from answers where name='up'),'{"group_count":3,"sources_per_call":500}'::jsonb,'#2286 0905''s batch answered its group count and per-call bound');
select is((select value from answers where name='up_calls'),'2'::jsonb,'#2286 0905''s new batch computed the revision twice');
select is((select value from answers where name='down_calls'),'3'::jsonb,'#2286 the restored new batch computes it three times, as before');
-- An organization write takes the shared fence through the restored trigger.
select lives_ok($$update organizations set name='Rollback 2286 B renamed' where id='22860900-0000-0000-0000-000000000001'$$,'#2286 an organization write passes the restored trigger');

select lives_ok($up$
-- @0905_UP@
$up$,'#2286 the up applies again after the down');
select is((select p.proname::text from pg_trigger t join pg_proc p on p.oid=t.tgfoid where t.tgrelid='public.organizations'::regclass and t.tgname='capture_census_fence'),
  'fence_capture_org_change','#2286 the re-applied up fences organizations on its own id again');
select * from finish();
rollback;
