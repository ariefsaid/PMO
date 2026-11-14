\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(5);
\ir ../supabase/migrations/rollback/0868_captured_invoice_payment_down.sql
select hasnt_function('public','captured_invoice_fully_settled',array['uuid'],'empty rollback removes captured settlement policy');
\ir ../supabase/migrations/0868_captured_invoice_payment.sql
select has_function('public','captured_invoice_fully_settled',array['uuid'],'empty forward migration restores captured settlement policy');
create temporary table rollback_lines(seq integer generated always as identity, line text);
\copy rollback_lines(line) from 'supabase/migrations/rollback/0868_captured_invoice_payment_down.sql'
create function pg_temp.try_captured_down() returns text language plpgsql as $$
begin
  execute (select string_agg(line,E'\n' order by seq) from rollback_lines);
  raise exception 'rollback complete' using errcode='ZX001';
exception when sqlstate 'ZX001' then return 'allowed';
  when others then return sqlstate||':'||sqlerrm;
end $$;
select is(pg_temp.try_captured_down(),'allowed','empty data permits the full rollback');
insert into organizations(id,name,default_currency) values ('21950004-0000-0000-0000-000000000001','Rollback proof','USD');
insert into auth.users(id,email) values ('21950004-0000-0000-0000-000000000002','rollback-payment@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950004-0000-0000-0000-000000000002','21950004-0000-0000-0000-000000000001','Admin','rollback-payment@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950004-0000-0000-0000-000000000003','21950004-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values ('21950004-0000-0000-0000-000000000004','21950004-0000-0000-0000-000000000001','Purchase','21950004-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950004-0000-0000-0000-000000000005','21950004-0000-0000-0000-000000000001','Purchase Invoice','INV-R','USD',100,100,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950004-0000-0000-0000-000000000001','21950004-0000-0000-0000-000000000004','21950004-0000-0000-0000-000000000005');
update procurements set record_only=true where id='21950004-0000-0000-0000-000000000004';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950004-0000-0000-0000-000000000001','21950004-0000-0000-0000-000000000004','21950004-0000-0000-0000-000000000003','21950004-0000-0000-0000-000000000006','{"source_ids":[]}','supplier_invoice','invoiced','21950004-0000-0000-0000-000000000002');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950004-0000-0000-0000-000000000007','21950004-0000-0000-0000-000000000001','procurement','21950004-0000-0000-0000-000000000008','key-r','erpnext','create','committed','{"procurementId":"21950004-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950004-0000-0000-0000-000000000005","pi_names":["INV-R"]}');
select is(pg_temp.try_captured_down(),'55000:captured_payment_history_exists','payment outbox blocks rollback');
set local request.jwt.claims='{"role":"service_role"}';
insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21950004-0000-0000-0000-000000000008','21950004-0000-0000-0000-000000000001','21950004-0000-0000-0000-000000000004','Scheduled',25,0);
delete from external_command_outbox where id='21950004-0000-0000-0000-000000000007';
select is(pg_temp.try_captured_down(),'55000:captured_payment_history_exists','payment mirror blocks rollback without its outbox');
select * from finish();
rollback;
