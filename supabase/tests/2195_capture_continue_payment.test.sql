begin;
select plan(15);
insert into organizations(id,name,default_currency) values ('21950001-0000-0000-0000-000000000001','Policy','USD');
insert into auth.users(id,email) values ('21950001-0000-0000-0000-000000000002','policy@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950001-0000-0000-0000-000000000002','21950001-0000-0000-0000-000000000001','Admin','policy@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950001-0000-0000-0000-000000000003','21950001-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin) values
 ('21950001-0000-0000-0000-000000000004','21950001-0000-0000-0000-000000000001','Invoice','21950001-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link'),
 ('21950001-0000-0000-0000-000000000005','21950001-0000-0000-0000-000000000001','Order','21950001-0000-0000-0000-000000000002','USD',100,'Ordered','erp_link'),
 ('21950001-0000-0000-0000-000000000006','21950001-0000-0000-0000-000000000001','Journal','21950001-0000-0000-0000-000000000002','USD',100,'Paid','erp_link');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values
 ('21950001-0000-0000-0000-000000000010','21950001-0000-0000-0000-000000000001','Purchase Invoice','INV-1','USD',100,75,1,'2026-01-01'),
 ('21950001-0000-0000-0000-000000000011','21950001-0000-0000-0000-000000000001','Purchase Order','PO-1','USD',100,null,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values
 ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','21950001-0000-0000-0000-000000000010'),
 ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000005','21950001-0000-0000-0000-000000000011');
update procurements set record_only=true where id in ('21950001-0000-0000-0000-000000000004','21950001-0000-0000-0000-000000000006');
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values
 ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','21950001-0000-0000-0000-000000000003','21950001-0000-0000-0000-000000000020','{}','supplier_invoice','invoiced','21950001-0000-0000-0000-000000000002'),
 ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000006','21950001-0000-0000-0000-000000000003','21950001-0000-0000-0000-000000000021','{}','journal','paid','21950001-0000-0000-0000-000000000002');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','pay-a','key-a','erpnext','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950001-0000-0000-0000-000000000010","pi_names":["INV-1"]}');
select is((select count(*)::integer from erpnext_payment_inflight_bills where org_id='21950001-0000-0000-0000-000000000001' and bill_name='INV-1'),1,'AC-ROP-024 one reservation per captured invoice');
select throws_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','pay-b','key-b','erpnext','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950001-0000-0000-0000-000000000010","pi_names":["INV-1"]}')$q$,'23505',null,'AC-ROP-024 second payment to the same invoice is reserved');
select lives_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','pay-other','key-other','erpnext','create','pending','{"erp_doc_kind":"payment","pi_names":["INV-OTHER"]}')$q$,'AC-ROP-024 another bill has its own reservation');
select is((select count(*)::integer from erpnext_payment_inflight_bills where org_id='21950001-0000-0000-0000-000000000001'),2,'AC-ROP-024 reservations are per bill');
update external_command_outbox set state='committing',claim_generation=2 where pmo_record_id='pay-a';
select is(public.fail_captured_invoice_payment((select id from external_command_outbox where pmo_record_id='pay-a'),1),0,'AC-ROP-024 stale claimant cannot fail payment');
select is((select state::text from external_command_outbox where pmo_record_id='pay-a'),'committing','AC-ROP-024 stale claimant leaves command unchanged');
select is(public.fail_captured_invoice_payment((select id from external_command_outbox where pmo_record_id='pay-a'),2),1,'AC-ROP-024 current claimant records terminal rejection');
select throws_ok($q$update external_command_outbox set state='committing' where pmo_record_id='pay-a'$q$,'55000','captured_invoice_payment_rejected','AC-ROP-024 terminal intent cannot be reclaimed');
select is((select attempt_count from external_command_outbox where pmo_record_id='pay-a'),public.outbox_max_auto_attempts(),'AC-ROP-024 rejection exhausts automatic attempts');
select is((select last_error from external_command_outbox where pmo_record_id='pay-a'),'captured_invoice_payment_rejected','AC-ROP-024 rejection stores redacted reason');
select is((select count(*)::integer from public.outbox_reconcile_candidates('21950001-0000-0000-0000-000000000001') where pmo_record_id='pay-a'),0,'AC-ROP-024 sweep excludes terminal rejection');
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21950001-0000-0000-0000-000000000002"}';
select is(public.undo_captured_purchase('21950001-0000-0000-0000-000000000004','reviewed',true)->>'outcome','undo','AC-ROP-024 undo is available after terminal rejection');
reset role;
select ok(not has_function_privilege('anon','public.fail_captured_invoice_payment(uuid,integer)','execute'),'AC-ROP-024 anonymous callers cannot fail payment commands');
select ok(not has_function_privilege('authenticated','public.fail_captured_invoice_payment(uuid,integer)','execute'),'AC-ROP-024 users cannot fail payment commands');
select lives_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','pay-new','key-new','erpnext','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950001-0000-0000-0000-000000000010","pi_names":["INV-1"]}')$q$,'AC-ROP-024 after undo is available a new intent can reserve the invoice');
select * from finish();
rollback;
