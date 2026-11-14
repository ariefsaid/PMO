begin;
select plan(4);
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
select * from finish();
rollback;
