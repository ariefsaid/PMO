-- #2195: a scale taken from the System Settings number format (blank Currency Precision) still meets the apply check.
-- The adapter reads '#.###' as scale 0 and '#,###.##' as scale 2; the database refuses any amount that does not fit.
begin;
select plan(4);
insert into organizations (id,name,default_currency) values ('21950777-0000-0000-0000-000000000001','Capture test','USD');
insert into auth.users (id,email) values ('21950777-0000-0000-0000-000000000002','capture-format@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('21950777-0000-0000-0000-000000000002','21950777-0000-0000-0000-000000000001','Admin','capture-format@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('21950777-0000-0000-0000-000000000003','21950777-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('21950777-0000-0000-0000-000000000004','21950777-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950777-0000-0000-0000-000000000001','companies','21950777-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21950777-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"21950777-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950777-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100.5,"net_total":100.5,"erp_status":"To Bill","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100.5,"net_total":100.5,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","purchase_orders":["ORDER-1"],"erp_modified":"2026-02-01"}
]$$::jsonb);
insert into budget_category_account_map (org_id,category,erp_account) values ('21950777-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950777-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100.5,0,false,'2026-02-01');

insert into auth.users(id,email) values ('21950777-0000-0000-0000-000000000009','capture-format-finance@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950777-0000-0000-0000-000000000009','21950777-0000-0000-0000-000000000001','Finance','capture-format-finance@example.test','Finance','active');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
select b.org_id,b.id,k.kind,now(),case when k.kind='ledger' then 'USD' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
where b.org_id='21950777-0000-0000-0000-000000000001';
insert into erp_financial_statement_snapshot(org_id,company,snapshot_id,source_generation,statement,scope_kind,view_kind,period_kind,current_start,current_end,prior_start,prior_end,currency,as_of,published_at,capture_started_at,capture_completed_at,payload,raw_reports,has_activity,display_precision,display_rounding_method)
values ('21950777-0000-0000-0000-000000000001','Example','21950777-0000-0000-0000-000000000010','21950777-0000-0000-0000-000000000011','trial_balance','company','account_breakdown','month','2026-01-01','2026-01-31','2025-01-01','2025-01-31','IDR',now(),now(),now(),now(),'{"current":{"rows":[]},"prior":{"rows":[]}}','{"current":"{}","prior":"{}"}',false,2,'erpnext_report_output');
insert into erp_financial_statement_published_context(org_id,company,snapshot_id,source_generation,context)
values ('21950777-0000-0000-0000-000000000001','Example','21950777-0000-0000-0000-000000000010','21950777-0000-0000-0000-000000000011','{"presentation":{"context":{"raw":{"company":{"name":"Example","currency":"IDR"}}}}}');
select set_config('capture.ids',(select jsonb_agg(id::text)::text from erp_purchase_documents where org_id='21950777-0000-0000-0000-000000000001'),true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950777-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
select is((select net_total from erp_purchase_documents where org_id='21950777-0000-0000-0000-000000000001' and erp_name='ORDER-1'),100.50::numeric,'#2195 the mirror holds the two-decimal amount');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
savepoint scale_zero;
select is(public.capture_history_apply('21950777-0000-0000-0000-000000000002','21950777-0000-0000-0000-000000000003','21950777-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":0,"supplier_invoice":0}',false)->>'reason','source_precision_mismatch','#2195 a 2-decimal amount under a 0-decimal number-format scale is refused');
rollback to savepoint scale_zero;
savepoint scale_mixed;
select is(public.capture_history_apply('21950777-0000-0000-0000-000000000002','21950777-0000-0000-0000-000000000003','21950777-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":0}',false)->>'reason','source_precision_mismatch','#2195 one 0-decimal kind refuses the family');
rollback to savepoint scale_mixed;
select isnt(coalesce(public.capture_history_apply('21950777-0000-0000-0000-000000000002','21950777-0000-0000-0000-000000000003','21950777-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','none'),'source_precision_mismatch','#2195 the same amount under a 2-decimal number-format scale meets the check');
reset role;
select * from finish();
rollback;
