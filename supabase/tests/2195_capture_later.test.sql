-- AC-ROP-017: one order and its invoice are one historical purchase.
begin;
select plan(67);
insert into organizations (id,name,default_currency) values ('21950111-0000-0000-0000-000000000001','Capture test','USD');
insert into auth.users (id,email) values ('21950111-0000-0000-0000-000000000002','capture-family@example.test');
insert into profiles (id,org_id,full_name,email,role,status) values ('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000001','Admin','capture-family@example.test','Admin','active');
insert into projects (id,org_id,name,status) values ('21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000001','Project','Ongoing Project');
insert into companies (id,org_id,name,type) values ('21950111-0000-0000-0000-000000000004','21950111-0000-0000-0000-000000000001','Supplier','Vendor');
insert into external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21950111-0000-0000-0000-000000000001','companies','21950111-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings (org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21950111-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{"company":"Example","project_map":{"21950111-0000-0000-0000-000000000003":"PROJECT"}}',now(),'active');
select upsert_erp_purchase_documents('21950111-0000-0000-0000-000000000001', $$[
 {"erp_doctype":"Purchase Order","erp_name":"ORDER-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100,"net_total":100,"erp_status":"To Bill","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-01"}
]$$::jsonb);
insert into budget_category_account_map (org_id,category,erp_account) values ('21950111-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_gl_entry_mirror (org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified,remarks) values
 ('21950111-0000-0000-0000-000000000001','GL-1','Example','Cost','PROJECT','Purchase Invoice','INVOICE-1','2026-02-01',100,0,false,'2026-02-01','On cancellation of earlier posting');
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at,ledger_currency)
select b.org_id,b.id,k.kind,now(),case when k.kind='ledger' then 'USD' end from external_org_bindings b cross join (values ('purchases'),('ledger')) k(kind)
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
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id)
values ('21950111-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21950111-0000-0000-0000-000000000012');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000005',current_setting('capture.revision'),current_setting('capture.ids')::jsonb,'{"order":2}',false)->>'outcome','create','AC-ROP-017 captures the order first');
reset role;
select set_config('capture.purchase',(select procurement_id::text from erp_purchase_captures where request_id='21950111-0000-0000-0000-000000000005'),true);
select upsert_erp_purchase_documents('21950111-0000-0000-0000-000000000001', $$[{"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-1","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":100,"net_total":100,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","purchase_orders":["ORDER-1"],"erp_modified":"2026-02-01"}]$$::jsonb);
select set_config('capture.family',(select jsonb_agg(id::text order by id) from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001')::text,true);
select set_config('capture.partial_family',(select jsonb_agg(id::text order by id) from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name<>'INVOICE-2')::text,true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.next_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select set_config('capture.first_commitment_before',(select amount::text from public.procurement_open_commitments(array[current_setting('capture.purchase')::uuid])),true);
select set_config('capture.actuals_before',(select coalesce(sum(actuals_to_date),0)::text from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('capture.attached',public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000006',current_setting('capture.next_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)::text,true);
select is(current_setting('capture.attached')::jsonb->>'procurement_id',current_setting('capture.purchase'),'AC-ROP-017 later invoice attaches to the captured order');
reset role;
update erp_purchase_captures set captured_at=captured_at-interval '1 hour' where procurement_id=current_setting('capture.purchase')::uuid and kind='order';
update erp_purchase_documents set outstanding_amount=100 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1';
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'payment',(select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1')),null::text,'AC-ROP-024 later captured invoice can be paid');
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'purchase-invoice',null),'step_already_recorded','AC-ROP-024 later captured invoice is already recorded');
update erp_purchase_captures set undone_at=now() where procurement_id=current_setting('capture.purchase')::uuid and kind='supplier_invoice';
-- Construct a retained historical link with an undone invoice capture; ordinary undo detaches links.
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'payment',null),'capture_invoice_unavailable','AC-ROP-024 linked invoice without an active invoice capture cannot be paid');
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'purchase-invoice',null),'step_already_recorded','AC-ROP-024 linked invoice remains an already recorded step');
update erp_purchase_captures set undone_at=null where procurement_id=current_setting('capture.purchase')::uuid and kind='supplier_invoice';
select set_config('capture.invoice_payload',(select payload::text from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid and kind='supplier_invoice'),true);
update erp_purchase_captures set payload=jsonb_set(payload,'{source_ids}','[]'::jsonb) where procurement_id=current_setting('capture.purchase')::uuid and kind='supplier_invoice';
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'payment',null),'capture_invoice_unavailable','AC-ROP-024 capture of another source cannot authorize this invoice');
create function pg_temp.later_payment_status(p_proc uuid,p_doc uuid,p_direct boolean) returns jsonb language plpgsql as $$
declare v_partial text; v_confirmed text; v_settled text; v_result jsonb;
begin
  begin
    if p_direct then
      update public.erp_purchase_documents set outstanding_amount=0 where id=p_doc;
      select status::text into v_settled from public.procurements where id=p_proc;
      v_result := jsonb_build_object('settled',v_settled);
    else
      insert into public.external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
      values ('21950111-0000-0000-0000-000000000061','21950111-0000-0000-0000-000000000001','procurement','21950111-0000-0000-0000-000000000062','later-pay','erpnext','create','pending',jsonb_build_object('procurementId',p_proc,'erp_doc_kind','payment','capturedInvoiceDocumentId',p_doc,'pi_names',jsonb_build_array('INVOICE-1')));
      update public.external_command_outbox set state='committing' where id='21950111-0000-0000-0000-000000000061';
      update public.external_command_outbox set state='committed' where id='21950111-0000-0000-0000-000000000061';
      insert into public.payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950111-0000-0000-0000-000000000062','21950111-0000-0000-0000-000000000001',p_proc,'Paid',25,1);
      update public.erp_purchase_documents set outstanding_amount=75 where id=p_doc;
      select status::text into v_partial from public.procurements where id=p_proc;
      update public.external_command_outbox set state='confirmed' where id='21950111-0000-0000-0000-000000000061';
      select status::text into v_confirmed from public.procurements where id=p_proc;
      update public.erp_purchase_documents set outstanding_amount=0 where id=p_doc;
      select status::text into v_settled from public.procurements where id=p_proc;
      v_result := jsonb_build_object('partial',v_partial,'confirmed',v_confirmed,'settled',v_settled);
    end if;
    raise exception 'test transaction rollback' using errcode='ZX001';
  exception when sqlstate 'ZX001' then return v_result; end;
end $$;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('capture.unmatched_result',pg_temp.later_payment_status(current_setting('capture.purchase')::uuid,(select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'),true)::text,true);
select is(current_setting('capture.unmatched_result')::jsonb->>'settled','Vendor Invoiced','AC-ROP-024 unrelated capture cannot settle a linked invoice');
update erp_purchase_captures set payload=current_setting('capture.invoice_payload')::jsonb where procurement_id=current_setting('capture.purchase')::uuid and kind='supplier_invoice';
select set_config('capture.direct_result',pg_temp.later_payment_status(current_setting('capture.purchase')::uuid,(select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'),true)::text,true);
select is(current_setting('capture.direct_result')::jsonb->>'settled','Paid','AC-ROP-024 later captured invoice paid directly advances');
select set_config('capture.payment_result',pg_temp.later_payment_status(current_setting('capture.purchase')::uuid,(select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'),false)::text,true);
select is(current_setting('capture.payment_result')::jsonb->>'partial','Vendor Invoiced','AC-ROP-024 partial payment on later capture remains unpaid');
select is(current_setting('capture.payment_result')::jsonb->>'confirmed','Vendor Invoiced','AC-ROP-024 confirmed partial later capture remains unpaid');
select is(current_setting('capture.payment_result')::jsonb->>'settled','Paid','AC-ROP-024 confirmed payment plus zero settles later capture');

create function pg_temp.later_two_payments(p_proc uuid,p_doc uuid) returns jsonb language plpgsql as $$
declare v_partial text; v_second_before text; v_final text; v_first_confirm integer; v_second_confirm integer; v_reservation integer; v_count integer; v_residual numeric; v_second_pending boolean; v_result jsonb;
begin
  begin
    insert into public.external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
    values ('21950111-0000-0000-0000-000000000071','21950111-0000-0000-0000-000000000001','procurement','21950111-0000-0000-0000-000000000072','later-two-1','erpnext','create','pending',jsonb_build_object('procurementId',p_proc,'erp_doc_kind','payment','capturedInvoiceDocumentId',p_doc,'paid_amount',25,'pi_names',jsonb_build_array('INVOICE-1')));
    update public.external_command_outbox set state='committing',claim_generation=1 where id='21950111-0000-0000-0000-000000000071';
    update public.external_command_outbox set state='committed',external_record_id='LATER-1',canonical=jsonb_build_object('id','21950111-0000-0000-0000-000000000072') where id='21950111-0000-0000-0000-000000000071';
    perform public.record_outbox_ref('21950111-0000-0000-0000-000000000071',1,'procurement','21950111-0000-0000-0000-000000000072','erpnext','LATER-1');
    insert into public.payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950111-0000-0000-0000-000000000072','21950111-0000-0000-0000-000000000001',p_proc,'Paid',25,1);
    update public.erp_purchase_documents set outstanding_amount=75 where id=p_doc;
    v_first_confirm := public.confirm_outbox('21950111-0000-0000-0000-000000000071',1);
    select status::text into v_partial from public.procurements where id=p_proc;
    select outstanding_amount into v_residual from public.erp_purchase_documents where id=p_doc;
    insert into public.external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
    values ('21950111-0000-0000-0000-000000000073','21950111-0000-0000-0000-000000000001','procurement','21950111-0000-0000-0000-000000000074','later-two-2','erpnext','create','pending',jsonb_build_object('procurementId',p_proc,'erp_doc_kind','payment','capturedInvoiceDocumentId',p_doc,'paid_amount',75,'pi_names',jsonb_build_array('INVOICE-1')));
    select state='pending' into v_second_pending from public.external_command_outbox where id='21950111-0000-0000-0000-000000000073';
    select count(*)::integer into v_reservation from public.erpnext_payment_inflight_bills where org_id='21950111-0000-0000-0000-000000000001' and bill_name='INVOICE-1';
    update public.external_command_outbox set state='committing',claim_generation=1 where id='21950111-0000-0000-0000-000000000073';
    update public.external_command_outbox set state='committed',external_record_id='LATER-2',canonical=jsonb_build_object('id','21950111-0000-0000-0000-000000000074') where id='21950111-0000-0000-0000-000000000073';
    perform public.record_outbox_ref('21950111-0000-0000-0000-000000000073',1,'procurement','21950111-0000-0000-0000-000000000074','erpnext','LATER-2');
    insert into public.payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950111-0000-0000-0000-000000000074','21950111-0000-0000-0000-000000000001',p_proc,'Paid',75,1);
    update public.erp_purchase_documents set outstanding_amount=0 where id=p_doc;
    select status::text into v_second_before from public.procurements where id=p_proc;
    v_second_confirm := public.confirm_outbox('21950111-0000-0000-0000-000000000073',1);
    select status::text into v_final from public.procurements where id=p_proc;
    select count(*)::integer into v_count from public.payments where procurement_id=p_proc;
    v_result := jsonb_build_object('partial',v_partial,'residual',v_residual,'first_confirm',v_first_confirm,'second_pending',v_second_pending,'reservation',v_reservation,'second_before',v_second_before,'second_confirm',v_second_confirm,'final',v_final,'payments',v_count);
    raise exception 'test transaction rollback' using errcode='ZX001';
  exception when sqlstate 'ZX001' then return v_result; end;
end $$;
select set_config('capture.two_payments',pg_temp.later_two_payments(current_setting('capture.purchase')::uuid,(select id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1'))::text,true);
select is(current_setting('capture.two_payments')::jsonb->>'partial','Vendor Invoiced','AC-ROP-024 first confirmed PMO payment leaves later capture unpaid');
select is((current_setting('capture.two_payments')::jsonb->>'residual')::numeric,75::numeric,'AC-ROP-024 later captured invoice has residual 75');
select is((current_setting('capture.two_payments')::jsonb->>'first_confirm')::integer,1,'AC-ROP-024 first PMO payment confirms');
select is((current_setting('capture.two_payments')::jsonb->>'second_pending')::boolean,true,'AC-ROP-024 second PMO payment is accepted for later capture');
select is((current_setting('capture.two_payments')::jsonb->>'reservation')::integer,1,'AC-ROP-024 second PMO payment reserves the invoice');
select is(current_setting('capture.two_payments')::jsonb->>'second_before','Vendor Invoiced','AC-ROP-024 zero residual waits for second PMO confirmation');
select is((current_setting('capture.two_payments')::jsonb->>'second_confirm')::integer,1,'AC-ROP-024 second PMO payment confirms');
select is(current_setting('capture.two_payments')::jsonb->>'final','Paid','AC-ROP-024 two PMO payments settle the later captured invoice');
select is((current_setting('capture.two_payments')::jsonb->>'payments')::integer,2,'AC-ROP-024 both PMO payments are mirrored');


update erp_purchase_documents set outstanding_amount=0 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1';
select is(public.record_only_step_refusal(current_setting('capture.purchase')::uuid,'payment',null),'history_complete','AC-ROP-024 later captured invoice with zero residual is complete');
update erp_purchase_documents set outstanding_amount=100 where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-1';

select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-017 both sources are linked once');
select is((select count(*)::int from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-017 each request keeps its history');
select is((select record_only_stage from procurements where id=current_setting('capture.purchase')::uuid),'invoiced','AC-ROP-017 the captured stage advances');
select ok((select record_only from procurements where id=current_setting('capture.purchase')::uuid),'AC-ROP-017 the wrapper remains record only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.first_commitment_after',(select amount::text from public.procurement_open_commitments(array[current_setting('capture.purchase')::uuid])),true);
select set_config('capture.actuals_after',(select coalesce(sum(actuals_to_date),0)::text from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),true);
select is(current_setting('capture.first_commitment_before')::numeric,100::numeric,'AC-ROP-017 canonical commitment before the invoice link');
select is(current_setting('capture.first_commitment_after')::numeric,0::numeric,'AC-ROP-017 canonical commitment after the invoice link');
select is(current_setting('capture.actuals_after')::numeric,current_setting('capture.actuals_before')::numeric,'AC-ROP-017 invoice attachment leaves actuals unchanged');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000006',current_setting('capture.next_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'procurement_id',current_setting('capture.purchase'),'AC-ROP-017 retry returns the same purchase');
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000006',current_setting('capture.next_revision'),current_setting('capture.ids')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','request_conflict','AC-ROP-017 changed retry is refused');
reset role;
select upsert_erp_purchase_documents('21950111-0000-0000-0000-000000000001', $$[{"erp_doctype":"Purchase Invoice","erp_name":"INVOICE-2","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":25,"net_total":25,"erp_status":"Partly Paid","erp_docstatus":1,"erp_project":"PROJECT","purchase_orders":["ORDER-1"],"erp_modified":"2026-02-02"}]$$::jsonb);
insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified) values
 ('21950111-0000-0000-0000-000000000001','GL-2','Example','Cost','PROJECT','Purchase Invoice','INVOICE-2','2026-02-02',25,0,false,'2026-02-02');
select set_config('capture.family',(select jsonb_agg(id::text order by id) from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001')::text,true);
update erp_purchase_documents set supplier='DIFFERENT' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.mismatch_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000050',current_setting('capture.mismatch_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','supplier_mismatch','AC-ROP-017 mismatched supplier is refused');
reset role;
update erp_purchase_documents set supplier='SUP-1' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
update erp_purchase_documents set currency='EUR' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.mismatch_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000051',current_setting('capture.mismatch_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','currency_mismatch','AC-ROP-017 mismatched currency is refused');
reset role;
update erp_purchase_documents set currency='USD' where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
update erp_purchase_documents set project_ids=array['21950111-0000-0000-0000-000000000099'::uuid] where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.mismatch_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000052',current_setting('capture.mismatch_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','source_not_eligible','AC-ROP-017 mismatched project is refused');
reset role;
update erp_purchase_documents set project_ids=array['21950111-0000-0000-0000-000000000003'::uuid] where org_id='21950111-0000-0000-0000-000000000001' and erp_name='INVOICE-2';
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-017 mismatched sources attach nothing');
update erp_purchase_captures set undone_at=now(),undo_reason='fixture' where procurement_id=current_setting('capture.purchase')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.undone_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000054',current_setting('capture.undone_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','ordinary_purchase_requires_decision','AC-ROP-017 an undone capture cannot receive a later source');
reset role;
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-017 an undone capture adds no link');
update erp_purchase_captures set undone_at=null,undo_reason=null where procurement_id=current_setting('capture.purchase')::uuid;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.third_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select set_config('capture.commitment_before',(select amount::text from public.procurement_open_commitments(array[current_setting('capture.purchase')::uuid])),true);
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000053',current_setting('capture.third_revision'),current_setting('capture.partial_family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','family_incomplete','AC-ROP-017 matched members cannot omit a later family source');
reset role;
select set_config('capture.status_before',(select status::text from procurements where id=current_setting('capture.purchase')::uuid),true);
select set_config('capture.total_before',(select total_value::text from procurements where id=current_setting('capture.purchase')::uuid),true);
create function pg_temp.refuse_capture_link() returns trigger language plpgsql as $$ begin raise exception 'fixture_refusal' using errcode='PFE02'; end $$;
create trigger capture_test_refusal before insert on public.procurement_erp_links for each row execute function pg_temp.refuse_capture_link();
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000008',current_setting('capture.third_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'outcome','refused','AC-ROP-017 linker refusal rolls back the attachment');
reset role;
drop trigger capture_test_refusal on public.procurement_erp_links;
select ok((select record_only from procurements where id=current_setting('capture.purchase')::uuid),'AC-ROP-017 a refused attachment retains record-only protection');
select is((select status::text from procurements where id=current_setting('capture.purchase')::uuid),current_setting('capture.status_before'),'AC-ROP-017 a refused attachment preserves status');
select is((select total_value from procurements where id=current_setting('capture.purchase')::uuid),current_setting('capture.total_before')::numeric,'AC-ROP-017 a refused attachment preserves total');
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),2,'AC-ROP-017 a refused attachment adds no link');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000007',current_setting('capture.third_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'procurement_id',current_setting('capture.purchase'),'AC-ROP-017 a second later invoice attaches to the same purchase');
reset role;
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),3,'AC-ROP-017 each of three sources is linked once');
select is((select count(*)::int from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid),3,'AC-ROP-017 all three request records survive');
select is((select record_only_stage from procurements where id=current_setting('capture.purchase')::uuid),'part_paid','AC-ROP-017 latest source advances the stage');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('capture.rerun_revision',public.purchase_capture_source_page(null,null,500)->>'revision',true);
select set_config('capture.commitment_after',(select amount::text from public.procurement_open_commitments(array[current_setting('capture.purchase')::uuid])),true);
select is(current_setting('capture.commitment_before')::numeric,0::numeric,'AC-ROP-017 canonical commitment before the second invoice link');
select is(current_setting('capture.commitment_after')::numeric,0::numeric,'AC-ROP-017 canonical commitment after the second invoice link');
select is((select coalesce(sum(actuals_to_date),0) from public.project_mapped_actuals('21950111-0000-0000-0000-000000000003')),current_setting('capture.actuals_before')::numeric,'AC-ROP-017 the second attachment leaves actuals unchanged');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000009',current_setting('capture.rerun_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'outcome','matched','AC-ROP-017 a completed family rerun matches');
reset role;
select is((select count(*)::int from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid),3,'AC-ROP-017 a completed family rerun creates no record');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21950111-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok($$update public.procurements set status='Paid' where id=current_setting('capture.purchase')::uuid$$,'42501',null,'AC-ROP-017 status remains protected after attachment');
select throws_ok($$update public.procurements set total_value=total_value+1 where id=current_setting('capture.purchase')::uuid$$,'42501',null,'AC-ROP-017 total remains protected after attachment');
select throws_ok($$insert into public.procurement_invoices(org_id,procurement_id) values ('21950111-0000-0000-0000-000000000001',current_setting('capture.purchase')::uuid)$$,'42501',null,'AC-ROP-017 invoice insertion remains protected after attachment');
select throws_ok($$insert into public.payments(org_id,procurement_id) values ('21950111-0000-0000-0000-000000000001',current_setting('capture.purchase')::uuid)$$,'42501',null,'AC-ROP-017 payment insertion remains protected after attachment');
reset role;
select upsert_erp_purchase_documents('21950111-0000-0000-0000-000000000001', $$[{"erp_doctype":"Purchase Invoice","erp_name":"ORDINARY-ATTEMPT","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":25,"net_total":25,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-03"},{"erp_doctype":"Purchase Invoice","erp_name":"OTHER-LINK","supplier":"SUP-1","supplier_name":"Supplier","currency":"USD","grand_total":25,"net_total":25,"erp_status":"Unpaid","erp_docstatus":1,"erp_project":"PROJECT","erp_modified":"2026-02-03"}]$$::jsonb);
insert into procurements(id,org_id,title,requested_by_id,project_id,vendor_id,currency,total_value,status) values ('21950111-0000-0000-0000-000000000099','21950111-0000-0000-0000-000000000001','Ordinary','21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000004','USD',25,'Draft');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) select org_id,'21950111-0000-0000-0000-000000000099',id from erp_purchase_documents where org_id='21950111-0000-0000-0000-000000000001' and erp_name='OTHER-LINK';
select throws_ok($$update public.procurement_erp_links set procurement_id='21950111-0000-0000-0000-000000000099' where procurement_id=current_setting('capture.purchase')::uuid$$,'PFE02','record_only_use_capture','AC-ROP-017 an existing captured link cannot move away');
select throws_ok($$update public.procurement_erp_links set procurement_id=current_setting('capture.purchase')::uuid where procurement_id='21950111-0000-0000-0000-000000000099'$$,'PFE02','record_only_use_capture','AC-ROP-017 an existing ordinary link cannot move into a capture');
set local role authenticated;
select is(public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_doctype','Purchase Invoice','erp_name','ORDINARY-ATTEMPT','procurement_id',current_setting('capture.purchase'))),false)#>>'{results,0,reason}','record_only_use_capture','AC-ROP-017 ordinary user linking cannot attach to the captured purchase');
select is(public.undo_captured_purchase(current_setting('capture.purchase')::uuid,'Incorrect link',false)->>'outcome','undo','AC-ROP-017 undo accepts an attached family');
reset role;
select is((select count(*)::int from erp_purchase_captures where procurement_id=current_setting('capture.purchase')::uuid and undone_at is not null),3,'AC-ROP-017 undo marks each capture request undone');
select is((select count(*)::int from procurement_erp_links where procurement_id=current_setting('capture.purchase')::uuid),0,'AC-ROP-017 undo unlinks every attached source');
select is((select count(*)::int from external_command_outbox where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-017 capture and undo emit no ERP command');
select is((select count(*)::int from expense_posting_erp_mirror where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-017 capture emits no expense posting intent');
select is((select count(*)::int from imprest_posting_erp_mirror where org_id='21950111-0000-0000-0000-000000000001'),0,'AC-ROP-017 capture emits no imprest posting intent');
select is((select detail->'sources' from audit_events where entity_id=current_setting('capture.purchase')::uuid and action='procurement.record_only_undo' order by created_at desc limit 1),current_setting('capture.family')::jsonb,'AC-ROP-017 undo audit names every source');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.capture_history_apply('21950111-0000-0000-0000-000000000002','21950111-0000-0000-0000-000000000003','21950111-0000-0000-0000-000000000007',current_setting('capture.third_revision'),current_setting('capture.family')::jsonb,'{"order":2,"supplier_invoice":2}',false)->>'reason','undone','AC-ROP-017 an undone capture request cannot be replayed');
reset role;
select * from finish();
rollback;
