begin;
select plan(26);
insert into organizations(id,name,default_currency) values ('21950003-0000-0000-0000-000000000001','Status proof','USD');
insert into auth.users(id,email) values ('21950003-0000-0000-0000-000000000002','status-proof@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950003-0000-0000-0000-000000000002','21950003-0000-0000-0000-000000000001','Admin','status-proof@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950003-0000-0000-0000-000000000003','21950003-0000-0000-0000-000000000001','erpnext','https://example.test','test-ref','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin)
select ('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000001','Purchase '||g,'21950003-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link' from generate_series(1,10) g;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified)
select ('21950003-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000001','Purchase Invoice','INV-'||g,'USD',100,100,1,'2026-01-01' from generate_series(1,10) g;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id)
select '21950003-0000-0000-0000-000000000001',('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,('21950003-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,10) g;
update procurements set record_only=true where org_id='21950003-0000-0000-0000-000000000001';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by)
select '21950003-0000-0000-0000-000000000001',('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950003-0000-0000-0000-000000000003',('21950003-3000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'{"source_ids":[]}','supplier_invoice','invoiced','21950003-0000-0000-0000-000000000002' from generate_series(1,10) g;
set local request.jwt.claims='{"role":"service_role"}';
-- A source already settled at capture needs no subsequent mirror refresh.
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin) values ('21950003-1000-0000-0000-000000000011','21950003-0000-0000-0000-000000000001','Settled at capture','21950003-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950003-2000-0000-0000-000000000011','21950003-0000-0000-0000-000000000001','Purchase Invoice','INV-11','USD',100,0,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000011','21950003-2000-0000-0000-000000000011');
update procurements set record_only=true where id='21950003-1000-0000-0000-000000000011';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000011','21950003-0000-0000-0000-000000000003','21950003-3000-0000-0000-000000000011','{"source_ids":[]}','supplier_invoice','paid','21950003-0000-0000-0000-000000000002');
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000011'),'Paid','AC-ROP-024 settled invoice is Paid at capture');
-- Dispatcher order: enqueue, claim, record ERP result, mirror payment, confirm.
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values
 ('21950003-4000-0000-0000-000000000001','21950003-0000-0000-0000-000000000001','procurement','21950003-5000-0000-0000-000000000001','key-1','erpnext','create','pending','{"procurementId":"21950003-1000-0000-0000-000000000001","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950003-2000-0000-0000-000000000001","pi_names":["INV-1"]}');
update external_command_outbox set state='committing' where id='21950003-4000-0000-0000-000000000001';
update external_command_outbox set state='committed' where id='21950003-4000-0000-0000-000000000001';
select lives_ok($q$insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950003-5000-0000-0000-000000000001','21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000001','Paid',25,1)$q$,'AC-ROP-024 payment mirror is recorded before confirmation');
update erp_purchase_documents set outstanding_amount=75 where id='21950003-2000-0000-0000-000000000001';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000001'),'Vendor Invoiced','AC-ROP-024 partial payment is not full settlement');
update erp_purchase_documents set outstanding_amount=0 where id='21950003-2000-0000-0000-000000000001';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000001'),'Vendor Invoiced','AC-ROP-024 zero waits while payment outcome is unresolved');
update external_command_outbox set state='confirmed' where id='21950003-4000-0000-0000-000000000001';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000001'),'Paid','AC-ROP-024 zero then confirmation advances');
select is((select count(*)::integer from procurement_status_events where procurement_id='21950003-1000-0000-0000-000000000001' and to_status='Paid'),1,'AC-ROP-024 zero then confirmation advances once');
update erp_purchase_documents set outstanding_amount=0 where id='21950003-2000-0000-0000-000000000002';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000002'),'Paid','AC-ROP-024 paid in the ERP directly marks the captured purchase Paid');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values
 ('21950003-4000-0000-0000-000000000003','21950003-0000-0000-0000-000000000001','procurement','21950003-5000-0000-0000-000000000003','key-3','erpnext','create','pending','{"procurementId":"21950003-1000-0000-0000-000000000003","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950003-2000-0000-0000-000000000003","pi_names":["INV-3"]}');
update external_command_outbox set state='committing' where id='21950003-4000-0000-0000-000000000003';
update external_command_outbox set state='committed' where id='21950003-4000-0000-0000-000000000003';
select lives_ok($q$insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950003-5000-0000-0000-000000000003','21950003-0000-0000-0000-000000000001','21950003-1000-0000-0000-000000000003','Paid',100,1)$q$,'AC-ROP-024 second payment mirror is recorded');
update external_command_outbox set state='confirmed' where id='21950003-4000-0000-0000-000000000003';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000003'),'Vendor Invoiced','AC-ROP-024 confirmation with positive residual waits');
update erp_purchase_documents set outstanding_amount=0 where id='21950003-2000-0000-0000-000000000003';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000003'),'Paid','AC-ROP-024 confirmation then zero advances');
select is((select count(*)::integer from procurement_status_events where procurement_id='21950003-1000-0000-0000-000000000003' and to_status='Paid'),1,'AC-ROP-024 confirmation then zero advances once');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
select '21950003-0000-0000-0000-000000000001','procurement','p-'||g,'k-'||g,'erpnext','create','pending',jsonb_build_object('procurementId',('21950003-1000-0000-0000-'||lpad(g::text,12,'0')),'erp_doc_kind','payment','capturedInvoiceDocumentId',('21950003-2000-0000-0000-'||lpad(g::text,12,'0')),'pi_names',jsonb_build_array('INV-'||g)) from generate_series(4,8) g;
update external_command_outbox set state=case pmo_record_id when 'p-5' then 'committing' when 'p-6' then 'committed' when 'p-7' then 'quarantined' when 'p-8' then 'held' else 'pending' end where pmo_record_id in ('p-4','p-5','p-6','p-7','p-8');
update erp_purchase_documents set outstanding_amount=0 where id in (select ('21950003-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid from generate_series(4,8) g);
select is((select status::text from procurements where id=('21950003-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid),'Vendor Invoiced','AC-ROP-024 in-flight command holds status '||g) from generate_series(4,8) g;
update external_command_outbox set state='failed',attempt_count=public.outbox_max_auto_attempts() where pmo_record_id='p-4';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000004'),'Paid','AC-ROP-024 terminal failure releases direct ERP settlement');
update external_command_outbox set state='failed',attempt_count=0 where pmo_record_id='p-5';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000005'),'Vendor Invoiced','AC-ROP-024 retryable failure still holds status');
update external_command_outbox set attempt_count=public.outbox_max_auto_attempts() where pmo_record_id='p-5';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000005'),'Paid','AC-ROP-024 exhausted failure releases status');
update erp_purchase_documents set outstanding_amount=0,erp_docstatus=2 where id='21950003-2000-0000-0000-000000000009';
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000009'),'Vendor Invoiced','AC-ROP-024 cancelled invoice cannot settle');
create function pg_temp.refuse_derive() returns trigger language plpgsql as $$
begin
  if new.id='21950003-1000-0000-0000-000000000010' and new.status='Paid' then raise exception 'synthetic derive failure'; end if;
  return new;
end $$;
create trigger aa_test_refuse_derive before update of status on procurements for each row execute function pg_temp.refuse_derive();
select lives_ok($q$update erp_purchase_documents set outstanding_amount=0 where id='21950003-2000-0000-0000-000000000010'$q$,'AC-ROP-024 mirror refresh survives derived status failure');
select is((select outstanding_amount from erp_purchase_documents where id='21950003-2000-0000-0000-000000000010'),0::numeric,'AC-ROP-024 mirror retains ERP settlement after derivation failure');
select is((select status::text from procurements where id='21950003-1000-0000-0000-000000000010'),'Vendor Invoiced','AC-ROP-024 failed derivation leaves status unchanged');
select ok(exists(select 1 from audit_events where entity_id='21950003-1000-0000-0000-000000000010' and action='procurement.derive_skipped'),'AC-ROP-024 failed derivation is recorded');
drop trigger aa_test_refuse_derive on procurements;
select throws_ok($q$update procurements set status='Paid' where id='21950003-1000-0000-0000-000000000009'$q$,'42501',null,'AC-ROP-024 service Paid without settlement evidence is refused');
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21950003-0000-0000-0000-000000000002"}';
select throws_ok($q$update procurements set status='Paid' where id='21950003-1000-0000-0000-000000000010'$q$,'42501',null,'AC-ROP-024 direct user Paid is refused');
reset role;
select * from finish();
rollback;
