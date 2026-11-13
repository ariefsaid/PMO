-- AC-ROP-017: one order and its invoice are one historical purchase.
begin;
select plan(16);
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
select * from finish();
rollback;
