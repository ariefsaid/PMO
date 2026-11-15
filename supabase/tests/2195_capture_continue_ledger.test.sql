-- AC-ROP-024 capture then pay once, actual once.
begin;
select plan(36);
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
update erp_purchase_documents set outstanding_amount=100 where org_id='21950111-0000-0000-0000-000000000001' and erp_doctype='Purchase Invoice';
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
insert into erp_actuals_snapshot(org_id,project_id,account,fiscal_year,net,as_of,snapshot_id,created_at)
values ('21950111-0000-0000-0000-000000000001','21950111-0000-0000-0000-000000000003','Cost','2026',100,now(),'21950111-0000-0000-0000-000000000013',now());
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
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.actuals_before',coalesce((select sum(actuals_to_date) from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),0)::text,true);
select is(current_setting('capture.actuals_before')::numeric,100::numeric,'AC-ROP-002 the tagged invoice has project actuals before capture');
reset role;
select set_config('capture.outbox',(select count(*)::text from external_command_outbox),true);
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
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
select is((select coalesce(sum(actuals_to_date),0) from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),current_setting('capture.actuals_before')::numeric,'AC-ROP-002 tagged invoice capture leaves project actuals unchanged');
reset role;
select is((select count(*)::int from procurement_invoices where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-002 no PMO invoice copy');
select is((select count(*)::int from purchase_orders where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-002 no PMO order copy');
select is((select count(*)::int from procurement_receipts where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-002 no PMO receipt copy');
select is((select count(*)::int from payments where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-002 no PMO payment copy');
select is((select count(*)::int from external_command_outbox where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-002 no outbox command');
select is((select count(*)::int from expense_posting_erp_mirror where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-002 no expense posting intent');
select is((select count(*)::int from imprest_posting_erp_mirror where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-002 no imprest posting intent');


set local request.jwt.claims = '{"role":"service_role"}';
create function pg_temp.pay(n integer, amount numeric) returns void language plpgsql as $$
declare outbox uuid := ('21950111-4000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
        payment uuid := ('21950111-5000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
        inv uuid := (select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1');
begin
  -- The dispatcher reads the existing intent before attempting an insert.
  if (select state from external_command_outbox where id=outbox)='confirmed' then return; end if;
  insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id)
  values(outbox,'21950111-0000-0000-0000-000000000001','procurement',payment::text,'intent-'||n,'erpnext','create','pending',
    jsonb_build_object('id',payment,'procurementId',current_setting('capture.purchase'),'erp_doc_kind','payment','capturedInvoiceDocumentId',inv,'pi_names',jsonb_build_array('INVOICE-1')),'21950111-0000-0000-0000-000000000002')
  on conflict (id) do nothing;
  update external_command_outbox set state='committing',claim_generation=1 where id=outbox;
  update external_command_outbox set state='committed',external_record_id='PAY-'||n,canonical=jsonb_build_object('id',payment) where id=outbox;
  perform public.record_outbox_ref(outbox,1,'procurement',payment::text,'erpnext','PAY-'||n);
  insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus,invoice_id)
  values(payment,'21950111-0000-0000-0000-000000000001',current_setting('capture.purchase')::uuid,'Paid',amount,1,null);
end $$;
select is((select count(*)::int from external_command_outbox where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-024 capture creates no outbox');
select pg_temp.pay(1,25);
update erp_purchase_documents set outstanding_amount=75 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1';
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),'Vendor Invoiced','AC-ROP-024 partial payment is not Paid');
select is((select outstanding_amount from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'),75::numeric,'AC-ROP-024 partial residual is 75');
select is(public.confirm_outbox('21950111-4000-0000-0000-000000000001',1),1,'AC-ROP-024 first payment confirmed');
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),'Vendor Invoiced','AC-ROP-024 confirmed partial payment remains invoiced');
select is((select count(*)::int from payments where procurement_id=current_setting('capture.purchase')::uuid),1,'AC-ROP-024 partial payment mirrored once');
select pg_temp.pay(1,25);
select is((select count(*)::int from payments where procurement_id=current_setting('capture.purchase')::uuid),1,'AC-ROP-024 partial intent retry is idempotent');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select sum(actuals_to_date) from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),100::numeric,'AC-ROP-024 partial payment keeps actual 100');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.pay(2,75);
update erp_purchase_documents set outstanding_amount=0 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1';
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),'Vendor Invoiced','AC-ROP-024 zero residual waits for confirmation');
select is(public.confirm_outbox('21950111-4000-0000-0000-000000000002',1),1,'AC-ROP-024 final payment confirmed');
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),'Paid','AC-ROP-024 confirmation and zero residual mark Paid');
select pg_temp.pay(2,75);
select is((select count(*)::int from payments where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-024 both intents mirror once after retry');
select is((select count(*)::int from procurement_invoices where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-024 no new invoice');
select is((select count(*)::int from purchase_orders where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-024 no new order');
select is((select count(*)::int from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_doctype='Purchase Invoice'),1,'AC-ROP-024 source invoice count remains one');
select is((select count(*)::int from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_doctype='Purchase Order'),1,'AC-ROP-024 source order count remains one');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select sum(actuals_to_date) from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),100::numeric,'AC-ROP-024 capture then pay once, actual once');
reset role;
select * from finish();
rollback;
