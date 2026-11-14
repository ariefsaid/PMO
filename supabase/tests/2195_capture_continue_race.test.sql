-- Committed fixtures are isolated to these two sessions and removed after the interleavings.
begin;
select plan(4);
create extension if not exists dblink;
select dblink_connect('pay_race',format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_exec('pay_race',$setup$
insert into organizations(id,name,default_currency) values ('21950005-0000-0000-0000-000000000001','Race','USD');
insert into auth.users(id,email) values ('21950005-0000-0000-0000-000000000002','race-proof@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950005-0000-0000-0000-000000000002','21950005-0000-0000-0000-000000000001','Admin','race-proof@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950005-0000-0000-0000-000000000003','21950005-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin)
select ('21950005-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950005-0000-0000-0000-000000000001','Race '||g,'21950005-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link' from generate_series(1,2) g;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified)
select ('21950005-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950005-0000-0000-0000-000000000001','Purchase Invoice','RACE-'||g,'USD',100,100,1,'2026-01-01' from generate_series(1,2) g;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id)
select '21950005-0000-0000-0000-000000000001',('21950005-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,('21950005-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,2) g;
update procurements set record_only=true where org_id='21950005-0000-0000-0000-000000000001';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by)
select '21950005-0000-0000-0000-000000000001',('21950005-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21950005-0000-0000-0000-000000000003',('21950005-3000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'{"source_ids":[]}','supplier_invoice','invoiced','21950005-0000-0000-0000-000000000002' from generate_series(1,2) g;
$setup$);
-- Enqueue takes the purchase lock first. Undo cannot pass it; after commit it sees the live command.
select dblink_exec('pay_race',$q$begin; insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950005-0000-0000-0000-000000000001','procurement','race-1','race-1','erpnext','create','pending','{"procurementId":"21950005-1000-0000-0000-000000000001","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950005-2000-0000-0000-000000000001","pi_names":["RACE-1"]}')$q$);
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21950005-0000-0000-0000-000000000002"}';
set local lock_timeout='300ms';
select throws_ok($q$select public.undo_captured_purchase('21950005-1000-0000-0000-000000000001','reviewed',false)$q$,'55P03',null,'AC-ROP-009 undo waits for concurrent enqueue');
set local lock_timeout=0;
select dblink_exec('pay_race','commit');
select throws_ok($q$select public.undo_captured_purchase('21950005-1000-0000-0000-000000000001','reviewed',false)$q$,'55000','has_later_pmo_steps','AC-ROP-009 committed enqueue defeats undo');
reset role;
-- Undo takes the same lock; the later enqueue must wait and then find the capture undone.
select dblink_exec('pay_race',$q$begin; set local request.jwt.claims='{"role":"authenticated","sub":"21950005-0000-0000-0000-000000000002"}'; set local role authenticated$q$);
select * from dblink('pay_race',$q$select public.undo_captured_purchase('21950005-1000-0000-0000-000000000002','reviewed',false)::text$q$) as t(result text);
set local request.jwt.claims='{"role":"service_role"}';
set local lock_timeout='300ms';
select throws_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950005-0000-0000-0000-000000000001','procurement','race-2','race-2','erpnext','create','pending','{"procurementId":"21950005-1000-0000-0000-000000000002","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950005-2000-0000-0000-000000000002","pi_names":["RACE-2"]}')$q$,'55P03',null,'AC-ROP-009 enqueue waits for concurrent undo');
set local lock_timeout=0;
select dblink_exec('pay_race','commit');
select throws_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21950005-0000-0000-0000-000000000001','procurement','race-2','race-2','erpnext','create','pending','{"procurementId":"21950005-1000-0000-0000-000000000002","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950005-2000-0000-0000-000000000002","pi_names":["RACE-2"]}')$q$,'42501','record_only_forward_step_refused','AC-ROP-009 committed undo defeats enqueue');
select dblink_exec('pay_race',$cleanup$
delete from external_command_outbox where org_id='21950005-0000-0000-0000-000000000001';
delete from audit_events where org_id='21950005-0000-0000-0000-000000000001';
delete from procurement_status_events where org_id='21950005-0000-0000-0000-000000000001';
delete from erp_purchase_captures where org_id='21950005-0000-0000-0000-000000000001';
delete from procurement_erp_links where org_id='21950005-0000-0000-0000-000000000001';
delete from erp_purchase_documents where org_id='21950005-0000-0000-0000-000000000001';
delete from procurements where org_id='21950005-0000-0000-0000-000000000001';
delete from external_org_bindings where org_id='21950005-0000-0000-0000-000000000001';
delete from profiles where org_id='21950005-0000-0000-0000-000000000001';
delete from auth.users where id='21950005-0000-0000-0000-000000000002';
delete from organizations where id='21950005-0000-0000-0000-000000000001';
$cleanup$);
select dblink_disconnect('pay_race');
select * from finish();
rollback;
