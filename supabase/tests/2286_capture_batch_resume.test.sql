-- #2286 PR B: a resume with no groups continues the stored batch and keeps every check; a call with no precision stays an invalid request.
-- AC-CAPV-005 (a fingerprinted change between calls refuses the resume), AC-CAPV-006 (a precision change refuses the resume).
begin;
select plan(13);
insert into organizations (id,name,default_currency) values ('22860111-0000-0000-0000-000000000001','Capture resume test','USD');
insert into auth.users (id,email) values ('22860111-0000-0000-0000-000000000002','capture-resume@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('22860111-0000-0000-0000-000000000002','22860111-0000-0000-0000-000000000001','Admin','capture-resume@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('22860111-0000-0000-0000-000000000003','22860111-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('22860111-0000-0000-0000-000000000004','22860111-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('22860111-0000-0000-0000-000000000001','companies','22860111-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('22860111-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"22860111-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
insert into budget_category_account_map (org_id,category,erp_account) values ('22860111-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
select b.org_id,b.id,k.kind,now(),case when k.kind='ledger' then 'USD' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='22860111-0000-0000-0000-000000000001';
-- Three sets of 30 one-order families (A, B, C) and one document no batch names (the one a mark changes).
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
select '22860111-0000-0000-0000-000000000001','Purchase Order',s||'-'||lpad(n::text,2,'0'),'SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['22860111-0000-0000-0000-000000000003'::uuid],'2026-02-01'
from unnest(array['A','B','C']) s cross join generate_series(1,30) n;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
values ('22860111-0000-0000-0000-000000000099','22860111-0000-0000-0000-000000000001','Purchase Order','OTHER','SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['22860111-0000-0000-0000-000000000003'::uuid],'2026-02-01');
create function pg_temp.groups(p_set text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('project_id','22860111-0000-0000-0000-000000000003','source_ids',jsonb_build_array(id::text)) order by erp_name)
  from erp_purchase_documents where org_id='22860111-0000-0000-0000-000000000001' and erp_name like p_set || '-%'
$$;
create function pg_temp.request(p_set text) returns uuid language sql as $$
  select case p_set when 'A' then '22860111-0000-0000-0000-00000000000a' when 'B' then '22860111-0000-0000-0000-00000000000b' else '22860111-0000-0000-0000-00000000000c' end::uuid
$$;
create function pg_temp.purchases() returns integer language sql as $$
  select count(*)::int from procurements where org_id='22860111-0000-0000-0000-000000000001'
$$;
-- The revision the reviewer saw: what the source page reports (capture_revision of the org).
create function pg_temp.revision() returns text language sql as $$ select public.capture_revision('22860111-0000-0000-0000-000000000001') $$;
-- One batch call as the edge function makes it (service role), returning the reply.
create function pg_temp.batch(p_set text, p_revision text, p_precision jsonb, p_groups jsonb) returns jsonb language plpgsql as $$
declare v jsonb; begin
  execute 'set local role service_role';
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  v := public.capture_history_batch('22860111-0000-0000-0000-000000000002','22860111-0000-0000-0000-000000000003',pg_temp.request(p_set),p_revision,p_precision,p_groups);
  execute 'reset role';
  return v;
end $$;
create temp table replies(name text primary key, value jsonb);
create function pg_temp.keep(p_name text, p_value jsonb) returns jsonb language sql as $$
  insert into replies values (p_name,p_value) on conflict (name) do update set value=excluded.value returning value
$$;

-- (a) A call with no precision and no groups is an invalid request, as before #2286 (no probe).
select set_config('capture.revision_a',pg_temp.revision(),true) is not null;
select throws_ok($$select pg_temp.batch('A',current_setting('capture.revision_a'),null,null)$$,'22023',null,
  '#2286 (a) a call with no precision and no groups is an invalid request before the batch exists');

-- (b) A new batch of 30 groups processes 25 and says how many groups it has and how many sources one call takes.
select is(pg_temp.keep('a_first',pg_temp.batch('A',current_setting('capture.revision_a'),'{"order":2,"supplier_invoice":2}',pg_temp.groups('A')))->>'next_index','25','#2286 (b) the first call processes 25 groups');
select is((select value->>'group_count' from replies where name='a_first'),'30','#2286 (b) the reply carries the batch group count');
select is((select value->>'sources_per_call' from replies where name='a_first'),'500','#2286 (b) the reply carries the most sources one call applies');
select throws_ok($$select pg_temp.batch('A',current_setting('capture.revision_a'),null,null)$$,'22023',null,
  '#2286 (b) a call with no precision and no groups is an invalid request once the batch exists');

-- (c) A resume with no groups processes the remaining 5 with the stored groups.
select is(pg_temp.keep('a_resume',pg_temp.batch('A',current_setting('capture.revision_a'),'{"order":2,"supplier_invoice":2}',null))->>'next_index','30','#2286 (c) the resume processes the remaining 5 groups');
select is((select jsonb_build_object('complete',value->'complete','resume',value->'resume','group_count',value->'group_count') from replies where name='a_resume'),
  '{"complete":true,"resume":false,"group_count":30}'::jsonb,'#2286 (c) the resume completes the batch of 30 groups');
select is((select count(*)::int from erp_purchase_captures where org_id='22860111-0000-0000-0000-000000000001'),30,'#2286 (c) every group of the batch was captured exactly once');

-- (d) AC-CAPV-005: a fingerprinted change between the calls refuses the resume and creates nothing.
select set_config('capture.revision_b',pg_temp.revision(),true) is not null;
select is(pg_temp.batch('B',current_setting('capture.revision_b'),'{"order":2,"supplier_invoice":2}',pg_temp.groups('B'))->>'next_index','25','#2286 (d) batch B stops after 25 groups');
insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at) values ('22860111-0000-0000-0000-000000000099','22860111-0000-0000-0000-000000000001',now());
select set_config('capture.before_stale',pg_temp.purchases()::text,true) is not null;
select is(pg_temp.batch('B',current_setting('capture.revision_b'),'{"order":2,"supplier_invoice":2}',null)->>'reason','review_stale_or_incomplete','AC-CAPV-005 a resume after a fingerprinted change refuses');
select is(pg_temp.purchases(),current_setting('capture.before_stale')::int,'AC-CAPV-005 the refused resume creates no purchase');

-- (e) AC-CAPV-006: a resume with a changed ERP precision refuses.
select set_config('capture.revision_c',pg_temp.revision(),true) is not null;
select is(pg_temp.batch('C',current_setting('capture.revision_c'),'{"order":2,"supplier_invoice":2}',pg_temp.groups('C'))->>'next_index','25','#2286 (e) batch C stops after 25 groups');
select is(pg_temp.batch('C',current_setting('capture.revision_c'),'{"order":3,"supplier_invoice":2}',null)->>'reason','precision_changed','AC-CAPV-006 a resume with a changed precision refuses');
select * from finish();
rollback;
