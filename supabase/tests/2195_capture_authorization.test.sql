-- AC-ROP-017: one order and its invoice are one historical purchase.
begin;
select plan(8);
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

insert into auth.users(id,email) values ('21950111-0000-0000-0000-000000000009','capture-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950111-0000-0000-0000-000000000009','21950111-0000-0000-0000-000000000001','Finance','capture-finance@example.test','Finance','active');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at)
select b.org_id,b.id,k.kind,now() from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='21950111-0000-0000-0000-000000000001';
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950111-0000-0000-0000-000000000001','Example','21950111-0000-0000-0000-000000000010','21950111-0000-0000-0000-000000000011','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
select set_config('capture.ids',(select jsonb_agg(id::text)::text from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001'),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select ok(not has_function_privilege('authenticated','public.capture_history_apply(uuid,uuid,uuid,text,jsonb,jsonb,boolean)','execute'),'AC-ROP-005 client roles cannot call the trusted service entry');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.capture_history_apply('21950111-0000-0000-0000-000000000009','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)$$,'42501',null,'AC-ROP-005 Finance actor is refused');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005','stale',current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','source_stale','AC-ROP-017 stale review is refused');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":3,"supplier_invoice":3}',false)->>'reason','source_precision_exceeds_mirror','AC-ROP-010 precision beyond the mirror is named and refused');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{}',false)->>'reason','source_precision_unknown','AC-ROP-010 missing precision is refused');
reset role;
savepoint missing_feed;
delete from erp_capture_feed_witnesses where org_id='21950111-0000-0000-0000-000000000001' and feed_kind='ledger';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.missing_revision',public.purchase_capture_source_page(null,null,1)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.missing_revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','feed_not_current','AC-ROP-017 incomplete feed prevents acceptance');
reset role;
rollback to savepoint missing_feed;
savepoint missing_currency;
delete from erp_financial_statement_published_context where org_id='21950111-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.currency_revision',public.purchase_capture_source_page(null,null,1)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.currency_revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','ledger_currency_unknown','AC-ROP-010 missing company currency refuses capture');
reset role;
rollback to savepoint missing_currency;
select is((select count(*)::int from procurement_erp_links where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-007 refused operations create no links');
select * from finish();
rollback;
