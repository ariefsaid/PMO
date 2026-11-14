-- AC-ROP-017: one order and its invoice are one historical purchase.
begin;
select plan(22);
insert into organizations (id,name,default_currency) values ('21950111-0000-0000-0000-000000000001','Capture test','USD');
insert into auth.users (id,email) values ('21950111-0000-0000-0000-000000000002','capture-family@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000001','Admin','capture-family@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('21950111-0000-0000-0000-000000000004','21950111-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950111-0000-0000-0000-000000000001','companies','21950111-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21950111-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"21950111-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950111-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100,"net_total":100,"erp_status":"To Bill","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100,"net_total":100,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","purchase_orders":["ORDER-1"],"erp_modified":"2026-02-01"}
]$$::jsonb);
insert into budget_category_account_map (org_id,category,erp_account) values ('21950111-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950111-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at)
select b.org_id,b.id,k.kind,now() from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='21950111-0000-0000-0000-000000000001';
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');

insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
select '21950111-0000-0000-0000-000000000001','Purchase Order','BATCH-'||n,'SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-01'
from generate_series(1,26) n;
select length(set_config('capture.groups',(select jsonb_agg(jsonb_build_object('project_id','21950111-0000-0000-0000-000000000003','source_ids',jsonb_build_array(id::text)) order by erp_name)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name like 'BATCH-%'),true));
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create function pg_temp.run_batch() returns jsonb language sql as $$
 select public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,current_setting('capture.groups')::jsonb)
$$;
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,null)->>'reason','batch_not_found','AC-ROP-008 retrieval does not create a batch');
select is(pg_temp.run_batch()->>'resume','true','AC-ROP-017 bounded first batch reports remaining work');
select is(pg_temp.run_batch()->>'resume','false','AC-ROP-017 retry resumes and finishes');
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,null)->>'resume','false','AC-ROP-008 stored groups replay a completed batch');
select is(pg_temp.run_batch()->>'resume','false','AC-ROP-008 repeated completed batch is a no-op');
reset role;
select is((select count(*)::int from procurement_erp_links l join erp_purchase_documents d on d.id=l.erp_purchase_document_id where d.org_id='21950111-0000-0000-0000-000000000001' and d.erp_name like 'BATCH-%'),26,'AC-ROP-017 every family was linked exactly once');
select is((select count(*)::int from erp_capture_batches where org_id='21950111-0000-0000-0000-000000000001'),1,'AC-ROP-008 retry keeps one batch identity');
select set_config('capture.undo_purchase',(select p.procurement_id::text from erp_purchase_captures p join procurement_erp_links l on l.procurement_id=p.procurement_id join erp_purchase_documents d on d.id=l.erp_purchase_document_id where d.org_id='21950111-0000-0000-0000-000000000001' and d.erp_name='BATCH-1' limit 1),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select public.undo_captured_purchase(current_setting('capture.undo_purchase')::uuid,'Incorrect selection',false);
select set_config('capture.money_before',coalesce((select to_jsonb(m)::text from public.get_projects_money_collection(array['21950111-0000-0000-0000-000000000003'::uuid]) m limit 1),'null'),true);
reset role;
select set_config('capture.before_replay', (select jsonb_build_object('purchases',(select count(*) from procurements where org_id='21950111-0000-0000-0000-000000000001'),'links',(select count(*) from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),'captures',(select count(*) from erp_purchase_captures where org_id='21950111-0000-0000-0000-000000000001'),'batch',(select to_jsonb(b) from erp_capture_batches b where org_id='21950111-0000-0000-0000-000000000001' and request_id='21950111-0000-0000-0000-000000000012'))::text),true);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,null)->>'reason','batch_contains_undone_capture','AC-ROP-008 stored identity reports undo');
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012','changed-review','{"order":2}'::jsonb,null)->>'reason','request_conflict','AC-ROP-008 changed review conflicts with stored identity');
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002',null,'21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,null)->>'reason','request_conflict','AC-ROP-008 changed scope conflicts with stored identity');
select is(pg_temp.run_batch()->>'reason','batch_contains_undone_capture','AC-ROP-008 an undone capture cannot be reported as a successful batch replay');
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000012',current_setting('capture.revision'),'{"order":2}'::jsonb,'[]'::jsonb)->>'reason','request_conflict','AC-ROP-008 changed groups conflict even after undo');
reset role;
select is((select count(*)::int from procurements where org_id='21950111-0000-0000-0000-000000000001'),(current_setting('capture.before_replay')::jsonb->>'purchases')::int,'AC-ROP-008 replay creates no purchase');
select is((select count(*)::int from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),(current_setting('capture.before_replay')::jsonb->>'links')::int,'AC-ROP-008 replay creates no links');
select is((select count(*)::int from erp_purchase_captures where org_id='21950111-0000-0000-0000-000000000001'),(current_setting('capture.before_replay')::jsonb->>'captures')::int,'AC-ROP-008 replay creates no capture');
select is((select to_jsonb(b) from erp_capture_batches b where org_id='21950111-0000-0000-0000-000000000001' and request_id='21950111-0000-0000-0000-000000000012'),current_setting('capture.before_replay')::jsonb->'batch','AC-ROP-008 replay does not increment batch state');

set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is(coalesce((select to_jsonb(m)::text from public.get_projects_money_collection(array['21950111-0000-0000-0000-000000000003'::uuid]) m limit 1),'null'),current_setting('capture.money_before'),'AC-ROP-008 replay preserves project money position');
select ok(current_setting('capture.money_before') <> 'null','AC-ROP-008 project money position is present');
reset role;
select length(set_config('capture.big',(select jsonb_agg(jsonb_build_object('project_id','21950111-0000-0000-0000-000000000003','source_ids',ids) order by n)::text from (select n,jsonb_agg(md5(n::text || ':' || i::text)::uuid::text order by i) ids from generate_series(1,2) n cross join generate_series(1,500) i group by n) groups),true));
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.big_revision',public.purchase_capture_source_page(null,null,1)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000013',current_setting('capture.big_revision'),'{"order":2}'::jsonb,current_setting('capture.big')::jsonb)->>'resume','true','AC-ROP-017 one call processes no more than 500 sources');
reset role;
reset role;
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified)
select '21950111-0000-0000-0000-000000000001','Purchase Order','PARTIAL-'||n,'SUP-1','Supplier','USD',1,1,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-01' from generate_series(1,26) n;
select set_config('capture.partial_groups',(select jsonb_agg(jsonb_build_object('project_id','21950111-0000-0000-0000-000000000003','source_ids',jsonb_build_array(id::text)) order by erp_name)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name like 'PARTIAL-%'),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.partial_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000014',current_setting('capture.partial_revision'),'{"order":2}'::jsonb,current_setting('capture.partial_groups')::jsonb)->>'resume','true','AC-ROP-008 partial batch retains unprocessed work');
reset role;
select set_config('capture.partial_purchase',(select c.procurement_id::text from erp_purchase_captures c where c.org_id='21950111-0000-0000-0000-000000000001' and c.request_id=md5('21950111-0000-0000-0000-000000000014:group:0')::uuid),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select public.undo_captured_purchase(current_setting('capture.partial_purchase')::uuid,'Incorrect selection',false);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000014',current_setting('capture.partial_revision'),'{"order":2}'::jsonb,null)->>'reason','batch_contains_undone_capture','AC-ROP-008 partial batch replay reports undo before resuming');
reset role;
select is((select next_index from erp_capture_batches where org_id='21950111-0000-0000-0000-000000000001' and request_id='21950111-0000-0000-0000-000000000014'),25,'AC-ROP-008 partial undo replay leaves remaining work untouched');
select * from finish();
rollback;
