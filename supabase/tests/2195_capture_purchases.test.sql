-- AC-ROP-017: one order and its invoice are one historical purchase.
begin;
select plan(44);
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
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified,remarks) values
 ('21950111-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01','On cancellation of earlier posting');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at)
select b.org_id,b.id,k.kind,now() from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='21950111-0000-0000-0000-000000000001';
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
select set_config('capture.ids',(select jsonb_agg(id::text order by erp_name)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001'),true);
select set_config('capture.versions',(select jsonb_object_agg(id::text,erp_modified)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001'),true);
select set_config('capture.single',(select jsonb_agg(id::text)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create function pg_temp.capture_family(dry boolean) returns jsonb language sql as $$
 select public.capture_history_apply(
   '21950111-0000-0000-0000-000000000002'::uuid,
   '21950111-0000-0000-0000-000000000003'::uuid,
   '21950111-0000-0000-0000-000000000005'::uuid,
   current_setting('capture.revision'), current_setting('capture.ids')::jsonb,
   jsonb_build_object('order',2,'supplier_invoice',2), dry)
$$;
select is(pg_temp.capture_family(true)->>'reason','account_classification_unknown','AC-ROP-017 a mapped account without chart evidence cannot authorize capture');
reset role;
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('21950111-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21950111-0000-0000-0000-000000000012');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000008',current_setting('capture.revision'),current_setting('capture.single')::jsonb,'{"supplier_invoice":2}'::jsonb,false)->>'reason','family_incomplete','AC-ROP-017 a known order cannot be omitted from its invoice family');
select is(pg_temp.capture_family(true)->>'outcome','create','AC-ROP-017 preview proposes the supported family');
select is((select count(*)::int from erp_gl_entry_mirror where org_id='21950111-0000-0000-0000-000000000001' and voucher_no='INVOICE-1' and not is_cancelled and debit-credit=100 and remarks like 'On cancellation of%'),1,'AC-ROP-011 a clean same-voucher repost remains capturable');
reset role;
select is((select count(*)::int from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-017 preview creates no links');
select set_config('capture.outbox',(select count(*)::text from external_command_outbox),true);
set local role service_role;
select is(pg_temp.capture_family(false)->>'outcome','create','AC-ROP-017 apply captures the family');
reset role;
select is((select count(*)::int from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),2,'AC-ROP-017 both documents are linked');
select is((select count(distinct procurement_id)::int from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),1,'AC-ROP-017 both documents share one wrapper');
select is((select count(*)::text from external_command_outbox),current_setting('capture.outbox'),'AC-ROP-017 capture creates no ERP command');
set local role service_role;
select is(pg_temp.capture_family(false)->>'outcome','skip','AC-ROP-008 identical retry does not create again');
reset role;
select set_config('capture.purchase',(select procurement_id::text from erp_purchase_captures where org_id='21950111-0000-0000-0000-000000000001' and request_id='21950111-0000-0000-0000-000000000005'),true);
select set_config('capture.link',(select id::text from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid limit 1),true);
-- Cancelled capture holds only its exact supplier, project and currency.
update erp_purchase_documents set erp_docstatus=2 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='ORDER-1';
insert into projects(id,org_id,name,status) values ('21950111-0000-0000-0000-000000000020','21950111-0000-0000-0000-000000000001','Other project','Ongoing Project');
update external_org_bindings set config=jsonb_set(config,'{project_map,21950111-0000-0000-0000-000000000020}',to_jsonb('OTHER'::text)) where org_id='21950111-0000-0000-0000-000000000001';
insert into companies(id,org_id,name,type) values ('21950111-0000-0000-0000-000000000021','21950111-0000-0000-0000-000000000001','Other supplier','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950111-0000-0000-0000-000000000001','companies','21950111-0000-0000-0000-000000000021','erpnext','Supplier:SUP-2');
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified) values
 ('21950111-0000-0000-0000-000000000001','Purchase Order','COPY','SUP-1','Supplier','USD',125,125,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-02'),
 ('21950111-0000-0000-0000-000000000001','Purchase Order','OTHER','SUP-2','Other supplier','USD',125,125,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-02'),
 ('21950111-0000-0000-0000-000000000001','Purchase Order','OTHER-CURRENCY','SUP-1','Supplier','EUR',125,125,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-02'),
 ('21950111-0000-0000-0000-000000000001','Purchase Order','OTHER-PROJECT','SUP-1','Supplier','USD',125,125,1,'To Bill','OTHER',array['21950111-0000-0000-0000-000000000020'::uuid],'2026-02-02'),
 ('21950111-0000-0000-0000-000000000001','Purchase Order','NATIVE-CANCELLED','SUP-2','Other supplier','USD',100,100,2,'Cancelled','PROJECT',array['21950111-0000-0000-0000-000000000003'::uuid],'2026-02-02');
insert into procurements(id,org_id,title,requested_by_id,project_id,vendor_id,currency,total_value,status) values ('21950111-0000-0000-0000-000000000022','21950111-0000-0000-0000-000000000001','Native','21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000021','USD',100,'Draft');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) select org_id,'21950111-0000-0000-0000-000000000022',id from erp_purchase_documents where erp_name='NATIVE-CANCELLED' and org_id='21950111-0000-0000-0000-000000000001';
create function pg_temp.source(p_name text) returns jsonb language sql as $$ select value from jsonb_array_elements(public.purchase_capture_source_page(null,null,500)->'sources') where value->>'erp_name'=p_name $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
reset role;
update external_refs set external_record_id='Supplier:temporarily-unmapped' where org_id='21950111-0000-0000-0000-000000000001' and pmo_record_id='21950111-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.source('ORDER-1')#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 cancelled original remains flagged if its supplier mapping changes');
reset role;
update external_refs set external_record_id='Supplier:SUP-1' where org_id='21950111-0000-0000-0000-000000000001' and pmo_record_id='21950111-0000-0000-0000-000000000004';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
reset role;
update erp_purchase_documents set supplier='SUP-2',supplier_name='Other supplier' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='ORDER-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.source('OTHER')#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 current cancelled source supplier sets hold scope');
select is(jsonb_array_length(coalesce(pg_temp.source('COPY')->'needs_undo','[]'::jsonb)),0,'AC-ROP-011 old wrapper supplier alone does not hold');
reset role;
update erp_purchase_documents set supplier='SUP-1',supplier_name='Supplier' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='ORDER-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
reset role;
update erp_purchase_documents set supplier='Supplier:SUP-1' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='ORDER-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.source('COPY')#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 equivalent supplier references share the same hold');
reset role;
update erp_purchase_documents set supplier='SUP-1' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='ORDER-1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.hold_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select is(pg_temp.source('COPY')#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 changed-amount copy names held purchase');
select is(pg_temp.source('ORDER-1')#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 cancelled original is flagged');
select is(pg_temp.source('COPY')#>>'{needs_undo,0,supplier_id}','21950111-0000-0000-0000-000000000004','AC-ROP-011 hold names supplier');
select is(pg_temp.source('COPY')#>>'{needs_undo,0,project_id}','21950111-0000-0000-0000-000000000003','AC-ROP-011 hold names project');
select is(pg_temp.source('COPY')#>>'{needs_undo,0,currency}','USD','AC-ROP-011 hold names currency');
select is(pg_temp.source('COPY')#>>'{needs_undo,0,undo_command}','node scripts/pmo.mjs purchases undo-record-only '||current_setting('capture.purchase')||' --reason "Incorrect link"','AC-ROP-011 hold names exact undo command');
select is(jsonb_array_length(coalesce(pg_temp.source('OTHER')->'needs_undo','[]'::jsonb)),0,'AC-ROP-011 different supplier and native purchase do not hold');
select is(jsonb_array_length(coalesce(pg_temp.source('OTHER-CURRENCY')->'needs_undo','[]'::jsonb)),0,'AC-ROP-011 different currency does not hold');
select is(jsonb_array_length(coalesce(pg_temp.source('OTHER-PROJECT')->'needs_undo','[]'::jsonb)),0,'AC-ROP-011 different project does not hold');
reset role;
insert into organizations(id,name,default_currency) values ('21950111-0000-0000-0000-000000000030','Other organization','USD');
insert into auth.users(id,email) values ('21950111-0000-0000-0000-000000000031','capture-other@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950111-0000-0000-0000-000000000031','21950111-0000-0000-0000-000000000030','Admin','capture-other@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21950111-0000-0000-0000-000000000032','21950111-0000-0000-0000-000000000030','Project','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21950111-0000-0000-0000-000000000033','21950111-0000-0000-0000-000000000030','Supplier','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950111-0000-0000-0000-000000000030','companies','21950111-0000-0000-0000-000000000033','erpnext','Supplier:SUP-1');
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,supplier_name,currency,net_total,grand_total,erp_docstatus,erp_status,erp_project,project_ids,erp_modified) values ('21950111-0000-0000-0000-000000000030','Purchase Order','OTHER-ORG','SUP-1','Supplier','USD',125,125,1,'To Bill','PROJECT',array['21950111-0000-0000-0000-000000000032'::uuid],'2026-02-02');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000031","role":"authenticated"}';
select is(jsonb_array_length(coalesce(pg_temp.source('OTHER-ORG')->'needs_undo','[]'::jsonb)),0,'AC-ROP-006 another organization does not inherit a hold');
select ok(pg_temp.source('COPY') is null,'AC-ROP-006 another organization cannot read held source');
reset role;
select set_config('capture.copy',(select jsonb_build_array(id::text)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='COPY'),true);
select set_config('capture.other',(select jsonb_build_array(id::text)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='OTHER'),true);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000023',current_setting('capture.hold_revision'),current_setting('capture.copy')::jsonb,'{"order":2}',true)->>'reason','needs_undo','AC-ROP-011 dry run revalidates the hold');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000023',current_setting('capture.hold_revision'),current_setting('capture.copy')::jsonb,'{"order":2}',true)#>>'{needs_undo,0,purchase_id}',current_setting('capture.purchase'),'AC-ROP-011 dry run identifies purchase to undo');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000026',current_setting('capture.hold_revision'),(select jsonb_agg(id::text) from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='OTHER-CURRENCY'),'{"order":2}',true)->>'outcome','create','AC-ROP-011 different currency passes server revalidation');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000020','21950111-0000-0000-0000-000000000027',current_setting('capture.hold_revision'),(select jsonb_agg(id::text) from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='OTHER-PROJECT'),'{"order":2}',true)->>'outcome','create','AC-ROP-011 different project passes server revalidation');
select set_config('capture.batch',public.capture_history_batch('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000024',current_setting('capture.hold_revision'),'{"order":2}',jsonb_build_array(jsonb_build_object('project_id','21950111-0000-0000-0000-000000000003','source_ids',current_setting('capture.copy')::jsonb),jsonb_build_object('project_id','21950111-0000-0000-0000-000000000003','source_ids',current_setting('capture.other')::jsonb)))::text,true);
select is(current_setting('capture.batch')::jsonb#>>'{results,0,reason}','needs_undo','AC-ROP-011 apply revalidates held copy');
select is(current_setting('capture.batch')::jsonb#>>'{results,1,outcome}','create','AC-ROP-011 unrelated supplier captures in same batch');
select is(current_setting('capture.batch')::jsonb->>'complete','true','AC-ROP-011 a held group does not abort its batch');
reset role;
select ok((select undone_at is null from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid),'AC-ROP-011 hold never automatically undoes');
select is((select count(*)::text from external_command_outbox),current_setting('capture.outbox'),'AC-ROP-011 held and unrelated batch writes no ERP command');

set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$select public.unlink_erp_purchase_document(current_setting('capture.link')::uuid)$$,'42501',null,'AC-ROP-009 ordinary unlink cannot split historical capture');
select is(public.undo_captured_purchase(current_setting('capture.purchase')::uuid,'Wrong purchase',true)->>'outcome','undo','AC-ROP-009 undo preview is supported');
reset role;
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-009 undo preview retains both links');
set local role authenticated;
select is(public.undo_captured_purchase(current_setting('capture.purchase')::uuid,'Wrong purchase',false)->>'outcome','undo','AC-ROP-009 undo completes');
reset role;
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-009 undo unlinks the whole family');
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),'Cancelled','AC-ROP-009 undo retains and cancels the wrapper');
select ok((select undone_at is not null from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid),'AC-ROP-009 provenance survives undo');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.after_undo_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select is(jsonb_array_length(coalesce(pg_temp.source('COPY')->'needs_undo','[]'::jsonb)),0,'AC-ROP-011 next census lifts hold after explicit undo');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000025',current_setting('capture.after_undo_revision'),current_setting('capture.copy')::jsonb,'{"order":2}',false)->>'outcome','create','AC-ROP-011 new request captures copy after undo');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000025',current_setting('capture.after_undo_revision'),current_setting('capture.copy')::jsonb,'{"order":2}',false)->>'outcome','skip','AC-ROP-011 copy captures once on retry');
reset role;

select * from finish();
rollback;
