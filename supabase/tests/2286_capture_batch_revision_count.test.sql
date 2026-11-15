-- #2286 PR B AC-CAPV-008: under the exclusive capture fence a new batch computes the revision only where the database could
-- have changed: once before its first group and once after its last. Feed health is read once per batch call and once per group.
begin;
select plan(6);
set local track_functions = 'all';
insert into organizations (id,name,default_currency) values ('22860222-0000-0000-0000-000000000001','Capture revision count test','USD');
insert into auth.users (id,email) values ('22860222-0000-0000-0000-000000000002','capture-revision-count@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('22860222-0000-0000-0000-000000000002','22860222-0000-0000-0000-000000000001','Admin','capture-revision-count@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('22860222-0000-0000-0000-000000000003','22860222-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('22860222-0000-0000-0000-000000000004','22860222-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('22860222-0000-0000-0000-000000000001','companies','22860222-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('22860222-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"22860222-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
insert into budget_category_account_map (org_id,category,erp_account) values ('22860222-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
select b.org_id,b.id,k.kind,now(),case when k.kind='ledger' then 'USD' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='22860222-0000-0000-0000-000000000001';
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
select '22860222-0000-0000-0000-000000000001','Purchase Order','COUNT-'||lpad(n::text,2,'0'),'SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['22860222-0000-0000-0000-000000000003'::uuid],'2026-02-01'
from generate_series(1,25) n;
select set_config('capture.groups',(select jsonb_agg(jsonb_build_object('project_id','22860222-0000-0000-0000-000000000003','source_ids',jsonb_build_array(id::text)) order by erp_name)::text
  from erp_purchase_documents where org_id='22860222-0000-0000-0000-000000000001'),true) is not null;
select set_config('capture.revision',public.capture_revision('22860222-0000-0000-0000-000000000001'),true) is not null;
create function pg_temp.calls(p_name text) returns bigint language sql as $$
  select coalesce((select calls from pg_stat_xact_user_functions where schemaname='public' and funcname=p_name),0)
$$;
select set_config('capture.revision_calls',pg_temp.calls('capture_revision')::text,true) is not null;
select set_config('capture.health_calls',pg_temp.calls('purchase_capture_feed_health')::text,true) is not null;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('capture.batch',public.capture_history_batch('22860222-0000-0000-0000-000000000002','22860222-0000-0000-0000-000000000003','22860222-0000-0000-0000-000000000012',
  current_setting('capture.revision'),'{"order":2}'::jsonb,current_setting('capture.groups')::jsonb)::text,true) is not null;
reset role;
select is(pg_temp.calls('capture_revision') - current_setting('capture.revision_calls')::bigint,2::bigint,'AC-CAPV-008 a new 25-group batch computes the revision exactly twice');
select is(pg_temp.calls('purchase_capture_feed_health') - current_setting('capture.health_calls')::bigint,26::bigint,'AC-CAPV-008 feed health is read once per batch call and once per group');
select is(current_setting('capture.batch')::jsonb->>'complete','true','AC-CAPV-008 the batch completes');
select is((select count(*)::int from jsonb_array_elements(current_setting('capture.batch')::jsonb->'results') r where r->>'outcome'='create'),25,'AC-CAPV-008 every group creates its purchase');
select is(current_setting('capture.batch')::jsonb->'results',(select results from erp_capture_batches where org_id='22860222-0000-0000-0000-000000000001' and request_id='22860222-0000-0000-0000-000000000012'),
  'AC-CAPV-008 the reply carries the results the batch stored');
select is((select current_revision from erp_capture_batches where org_id='22860222-0000-0000-0000-000000000001' and request_id='22860222-0000-0000-0000-000000000012'),
  public.capture_revision('22860222-0000-0000-0000-000000000001'),'AC-CAPV-008 the stored revision is the one after the last group');
select * from finish();
rollback;
