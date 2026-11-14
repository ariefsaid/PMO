begin;
select plan(46);
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
select has_function('public','record_only_step_refusal',array['uuid','text','uuid'],'AC-ROP-024 captured and linked step ownership');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000010'),null::text,'AC-ROP-024 captured payment oracle permits outstanding invoice');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','purchase-invoice',null),'step_already_recorded','AC-ROP-024 captured invoice is owned');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','purchase-order',null),'capture_lines_required','AC-ROP-024 unproven order needs source');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','goods-receipt',null),'capture_lines_required','AC-ROP-024 unproven receipt needs source');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000006','payment',null),'history_complete','AC-ROP-024 journal is settled');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','purchase-order',null),'step_already_recorded','AC-ROP-024 linked order is owned');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000011'),'capture_invoice_unavailable','AC-ROP-024 another case invoice is refused');
update erp_purchase_documents set outstanding_amount=0 where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000010'),'history_complete','AC-ROP-024 settled invoice cannot be paid again');

select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004',v.step,null),'history_complete','AC-ROP-024 settled invoice step '||v.step) from (values ('purchase-order'),('goods-receipt'),('purchase-invoice'),('paid')) v(step);
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000006',v.step,null),'history_complete','AC-ROP-024 journal step '||v.step) from (values ('purchase-order'),('goods-receipt'),('purchase-invoice'),('paid')) v(step);
update erp_purchase_documents set outstanding_amount=null where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000010'),'capture_invoice_unavailable','AC-ROP-024 unknown residual is refused');
update erp_purchase_documents set outstanding_amount=75,erp_docstatus=2 where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000010'),'capture_invoice_unavailable','AC-ROP-024 cancelled source is refused');
update erp_purchase_documents set erp_docstatus=1,currency='EUR' where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000010'),'capture_invoice_unavailable','AC-ROP-024 currency mismatch is refused');
select ok(not has_function_privilege('authenticated','public.record_only_step_refusal(uuid,text,uuid)','EXECUTE'),'AC-ROP-024 tenant and actor boundary');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000006','unknown',null),'history_complete','AC-ROP-024 journal unknown step is refused');

update erp_purchase_documents set currency='USD',outstanding_amount=-1 where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment',null),'capture_invoice_unavailable','AC-ROP-024 negative residual is refused');
update erp_purchase_documents set outstanding_amount=75,is_return=true where id='21950001-0000-0000-0000-000000000010';
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment',null),'capture_invoice_unavailable','AC-ROP-024 return is refused');
update erp_purchase_documents set is_return=false where id='21950001-0000-0000-0000-000000000010';
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950001-0000-0000-0000-000000000012','21950001-0000-0000-0000-000000000001','Purchase Invoice','INV-2','USD',100,75,1,'2026-01-01');
-- Construct ambiguous historical evidence without changing the source-link guard contract.
alter table procurement_erp_links disable trigger z_record_only_capture_link_guard;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','21950001-0000-0000-0000-000000000012');
alter table procurement_erp_links enable trigger z_record_only_capture_link_guard;
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment',null),'capture_invoice_unavailable','AC-ROP-024 ambiguous source is refused');
delete from procurement_erp_links where erp_purchase_document_id='21950001-0000-0000-0000-000000000012';
select throws_ok($q$update public.procurements set status='Cancelled' where id='21950001-0000-0000-0000-000000000004'$q$,'42501','record_only_use_undo','AC-ROP-024 captured invoice cancellation uses undo');
select throws_ok($q$update public.procurements set status='Paid' where id='21950001-0000-0000-0000-000000000004'$q$,'42501','payment_confirmation_required','AC-ROP-024 direct Paid is refused');
select throws_ok($q$insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','pay-odoo','pay-odoo','odoo','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000004","erp_doc_kind":"payment"}')$q$,'42501','capture_tier_unsupported','AC-ROP-024 Odoo direct outbox is refused');
select throws_ok($q$insert into public.payments(id,org_id,procurement_id,status) values ('21950001-0000-0000-0000-000000000030','21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','Scheduled')$q$,'42501','record_only_forward_step_refused','AC-ROP-024 unrelated service payment is refused');
insert into public.external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950001-0000-0000-0000-000000000001','procurement','21950001-0000-0000-0000-000000000030','pay-1','erpnext','create','committed','{"procurementId":"21950001-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950001-0000-0000-0000-000000000010"}');
set local request.jwt.claims='{"role":"service_role"}';
select lives_ok($q$insert into public.payments(id,org_id,procurement_id,status) values ('21950001-0000-0000-0000-000000000030','21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','Scheduled')$q$,'AC-ROP-024 committed service payment mirror is accepted');
select throws_ok($q$insert into public.payments(id,org_id,procurement_id,status) values ('21950001-0000-0000-0000-000000000031','21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','Scheduled')$q$,'42501','record_only_forward_step_refused','AC-ROP-024 service payment needs matching command identity');
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21950001-0000-0000-0000-000000000002"}';
select throws_ok($q$select public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment',null)$q$,'42501',null,'AC-ROP-024 tenant and actor boundary excludes client policy calls');
select throws_ok($q$insert into public.payments(id,org_id,procurement_id,status) values ('21950001-0000-0000-0000-000000000031','21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000004','Scheduled')$q$,'42501',null,'AC-ROP-024 client payment insert is refused');
reset role;
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000006','cancel',null),'record_only_use_undo','AC-ROP-024 journal cancellation uses undo');

insert into organizations(id,name,default_currency) values ('21950001-0000-0000-0000-000000000099','Foreign','USD');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950001-0000-0000-0000-000000000098','21950001-0000-0000-0000-000000000099','Purchase Invoice','FOREIGN','USD',100,75,1,'2026-01-01');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000004','payment','21950001-0000-0000-0000-000000000098'),'capture_invoice_unavailable','AC-ROP-024 cross-organization source is refused');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values
 ('21950001-0000-0000-0000-000000000001','procurement','odoo-order','odoo-order','odoo','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000005","erp_doc_kind":"purchase-order"}','21950001-0000-0000-0000-000000000002');
select lives_ok($q$select public.claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='odoo-order'))$q$,'AC-ROP-024 ordinary Odoo order keeps its claim behavior');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin) values ('21950001-0000-0000-0000-000000000007','21950001-0000-0000-0000-000000000001','Queued','21950001-0000-0000-0000-000000000002','USD',100,'Draft','erp_link');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('21950001-0000-0000-0000-000000000001','procurement','erp-order','erp-order','erpnext','create','pending','{"procurementId":"21950001-0000-0000-0000-000000000007","erp_doc_kind":"purchase-order"}','21950001-0000-0000-0000-000000000002');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,erp_docstatus,erp_modified) values ('21950001-0000-0000-0000-000000000013','21950001-0000-0000-0000-000000000001','Purchase Order','PO-NEW','USD',100,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000007','21950001-0000-0000-0000-000000000013');
select throws_ok($q$select public.claim_outbox_for_commit((select id from external_command_outbox where idempotency_key='erp-order'))$q$,'P0001','procurement-create-refused: step_already_recorded','AC-ROP-024 queued ERP order checks linked ownership');
update procurements set record_only=true where id='21950001-0000-0000-0000-000000000005';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000005','21950001-0000-0000-0000-000000000003','21950001-0000-0000-0000-000000000022','{}','order','ordered','21950001-0000-0000-0000-000000000002');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','purchase-order',null),'step_already_recorded','AC-ROP-024 captured order is owned');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','goods-receipt',null),'capture_lines_required','AC-ROP-024 captured order needs receipt lines');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','purchase-invoice',null),'capture_lines_required','AC-ROP-024 captured order needs invoice lines');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','payment',null),'capture_invoice_unavailable','AC-ROP-024 captured order has no invoice to pay');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','paid',null),'payment_confirmation_required','AC-ROP-024 captured order cannot be marked paid');
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','unknown',null),'record_only_forward_step_refused','AC-ROP-024 unknown captured step is refused');

insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,erp_docstatus,erp_modified) values ('21950001-0000-0000-0000-000000000014','21950001-0000-0000-0000-000000000001','Purchase Receipt','RCPT-1','USD',100,1,'2026-01-01');
alter table procurement_erp_links disable trigger z_record_only_capture_link_guard;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950001-0000-0000-0000-000000000001','21950001-0000-0000-0000-000000000005','21950001-0000-0000-0000-000000000014');
alter table procurement_erp_links enable trigger z_record_only_capture_link_guard;
select is(public.record_only_step_refusal('21950001-0000-0000-0000-000000000005','goods-receipt',null),'step_already_recorded','AC-ROP-024 captured receipt is owned');
select throws_ok($q$select public.transition_procurement('21950001-0000-0000-0000-000000000006','Paid')$q$,'42501','history_complete','AC-ROP-024 explicit settled replay is refused before no-op');

delete from procurement_erp_links where procurement_id='21950001-0000-0000-0000-000000000004';
select throws_ok($q$update public.procurements set status='Cancelled' where id='21950001-0000-0000-0000-000000000004'$q$,'42501','record_only_use_undo','AC-ROP-024 missing invoice source still requires undo');
select * from finish();
rollback;
