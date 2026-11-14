-- AC-ROP-017: an authorized census must not truncate purchase history.
begin;
select plan(12);
insert into organizations (id, name, default_currency) values
  ('21950110-0000-0000-0000-000000000001','Capture test','USD');
insert into auth.users (id, email) values
  ('21950110-0000-0000-0000-000000000002','capture-admin@example.test'),
  ('21950110-0000-0000-0000-000000000003','capture-finance@example.test');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('21950110-0000-0000-0000-000000000002','21950110-0000-0000-0000-000000000001','Admin','capture-admin@example.test','Admin','active'),
  ('21950110-0000-0000-0000-000000000003','21950110-0000-0000-0000-000000000001','Finance','capture-finance@example.test','Finance','active');
insert into projects (id, org_id, name, status) values
  ('21950110-0000-0000-0000-000000000004','21950110-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, config, activated_at, status) values
  ('21950110-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref',
   '{"company":"Example","project_map":{"21950110-0000-0000-0000-000000000004":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950110-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"},
 {"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","currency":"USD","grand_total":100,"net_total":100,"erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"}
]$$::jsonb);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.first',public.purchase_capture_source_page(null,null,1)::text,true);
select is(jsonb_array_length(current_setting('capture.first')::jsonb->'sources'),1,'AC-ROP-017 first page is bounded');
select ok(current_setting('capture.first')::jsonb->>'next_cursor' is not null,'AC-ROP-017 next page is available');
select set_config('capture.second',public.purchase_capture_source_page((current_setting('capture.first')::jsonb->>'next_cursor')::uuid,null,1)::text,true);
select is(jsonb_array_length(current_setting('capture.second')::jsonb->'sources'),1,'AC-ROP-017 second document is present');
select isnt(current_setting('capture.first')::jsonb#>>'{sources,0,id}',current_setting('capture.second')::jsonb#>>'{sources,0,id}','AC-ROP-017 pages do not repeat a source');
select is(current_setting('capture.first')::jsonb->>'revision',current_setting('capture.second')::jsonb->>'revision','AC-ROP-017 pages share a generation');
reset role;
insert into companies (id, org_id, name, type) values
  ('21950110-0000-0000-0000-000000000005','21950110-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
  ('21950110-0000-0000-0000-000000000001','companies','21950110-0000-0000-0000-000000000005','erpnext','Supplier:SUP-1');
set local role authenticated;
select isnt(public.purchase_capture_source_page(null,null,1)->>'revision',current_setting('capture.first')::jsonb->>'revision','AC-ROP-017 a supplier mapping change invalidates the reviewed census');
select is((select x->>'supplier_id' from jsonb_array_elements(public.purchase_capture_source_page(null,null,500)->'sources') x limit 1),'21950110-0000-0000-0000-000000000005','AC-ROP-017 supplier identity is derived from the mapped vendor');
select set_config('capture.account_revision',public.purchase_capture_source_page(null,null,1)->>'revision',true);
reset role;
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('21950110-0000-0000-0000-000000000001','Example','Account','Account','Expense','Profit and Loss',false,'USD',1,2,'21950110-0000-0000-0000-000000000006');
set local role authenticated;
select isnt(public.purchase_capture_source_page(null,null,1)->>'revision',current_setting('capture.account_revision'),'AC-ROP-017 account classification changes invalidate the reviewed census');
reset role;
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values ('21950110-0000-0000-0000-000000000010','21950110-0000-0000-0000-000000000001','Ordinary','21950110-0000-0000-0000-000000000002','USD',0,'Draft');
insert into procurement_invoices(id,procurement_id,org_id,status,amount,currency,tax_treatment,tax_amount) values ('21950110-0000-0000-0000-000000000011','21950110-0000-0000-0000-000000000010','21950110-0000-0000-0000-000000000001','Received',100,'USD','exclusive',0);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950110-0000-0000-0000-000000000001','procurement','21950110-0000-0000-0000-000000000011','erpnext','INVOICE-1');
set local role authenticated;
select is((select x->>'recorded_by_pmo' from jsonb_array_elements(public.purchase_capture_source_page(null,null,500)->'sources') x where x->>'erp_name'='INVOICE-1'),'true','AC-ROP-017 live PMO ownership is recomputed from actual references');
reset role;
update erp_purchase_documents set purchase_orders=array['ORDER-MISSING'] where org_id='21950110-0000-0000-0000-000000000001' and erp_name='INVOICE-1';
insert into erp_purchase_documents(org_id,erp_doctype,erp_name,supplier,currency,net_total,grand_total,erp_docstatus,erp_status,project_ids,purchase_orders,erp_modified)
values ('21950110-0000-0000-0000-000000000001','Purchase Invoice','OUTSIDE','SUP-1','USD',100,100,1,'Unpaid',array['21950110-0000-0000-0000-000000000099'::uuid],array['ORDER-1'],'2026-02-01');
set local role authenticated;
select is((select x->>'family_incomplete' from jsonb_array_elements(public.purchase_capture_source_page(null,'21950110-0000-0000-0000-000000000004',500)->'sources') x where x->>'erp_name'='INVOICE-1'),'true','AC-ROP-017 scoped invoice is incomplete when its order is absent');
select is((select x->>'family_incomplete' from jsonb_array_elements(public.purchase_capture_source_page(null,'21950110-0000-0000-0000-000000000004',500)->'sources') x where x->>'erp_name'='ORDER-1'),'true','AC-ROP-017 scoped order is incomplete when its invoice is outside scope');
set local request.jwt.claims = '{"sub":"21950110-0000-0000-0000-000000000003","role":"authenticated"}';
select throws_ok($$select public.purchase_capture_source_page(null,null,1)$$,'42501',null,'AC-ROP-005 Finance cannot enumerate the census');
reset role;
select * from finish();
rollback;
