\set ON_ERROR_STOP on
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(11);
-- Two connections exercise the real downgrade and enqueue ordering.
create extension if not exists dblink;
select dblink_connect('rollback_enqueue',format('dbname=%s user=%s password=postgres host=%s port=%s application_name=rollback_enqueue',current_database(),current_user,host(inet_server_addr()),inet_server_port()));
select dblink_connect('rollback_down',format('dbname=%s user=%s password=postgres host=%s port=%s application_name=rollback_down',current_database(),current_user,host(inet_server_addr()),inet_server_port()));
select dblink_exec('rollback_enqueue',$setup$
insert into organizations(id,name,default_currency) values ('21950006-0000-0000-0000-000000000001','Rollback race','USD');
insert into auth.users(id,email) values ('21950006-0000-0000-0000-000000000002','rollback-race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21950006-0000-0000-0000-000000000002','21950006-0000-0000-0000-000000000001','Admin','rollback-race@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21950006-0000-0000-0000-000000000003','21950006-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin) values ('21950006-0000-0000-0000-000000000004','21950006-0000-0000-0000-000000000001','Rollback race','21950006-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified) values ('21950006-0000-0000-0000-000000000005','21950006-0000-0000-0000-000000000001','Purchase Invoice','RACE','USD',100,100,1,'2026-01-01');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21950006-0000-0000-0000-000000000001','21950006-0000-0000-0000-000000000004','21950006-0000-0000-0000-000000000005');
update procurements set record_only=true where id='21950006-0000-0000-0000-000000000004';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by) values ('21950006-0000-0000-0000-000000000001','21950006-0000-0000-0000-000000000004','21950006-0000-0000-0000-000000000003','21950006-0000-0000-0000-000000000006','{"source_ids":[]}','supplier_invoice','invoiced','21950006-0000-0000-0000-000000000002');
create function public.test_2195_claim(p_id uuid) returns text language plpgsql as $body$ begin perform public.claim_outbox_for_commit(p_id); return 'claimed'; exception when others then return sqlstate||':'||sqlerrm; end $body$;
$setup$);
create temporary table rollback_race_down(seq integer generated always as identity, line text);
\copy rollback_race_down(line) from 'supabase/migrations/rollback/0868_captured_invoice_payment_down.sql'
select dblink_exec('rollback_down',format($create$create function public.test_2195_down(p_hold boolean) returns boolean language plpgsql as $body$ begin execute %L; if p_hold then perform pg_advisory_xact_lock(2195,868); else raise exception 'unexpected_down_succeeded'; end if; return true; end $body$$create$,(select string_agg(line,E'\n' order by seq) from rollback_race_down)));
select dblink_exec('rollback_enqueue',$q$begin; insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('21950006-0000-0000-0000-000000000007','21950006-0000-0000-0000-000000000001','procurement','rollback-race','rollback-race','erpnext','create','pending','{"procurementId":"21950006-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950006-0000-0000-0000-000000000005"}','21950006-0000-0000-0000-000000000002')$q$);
select dblink_send_query('rollback_down','select public.test_2195_down(false)');
do $$ begin for i in 1..100 loop exit when exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='rollback_down' and l.relation='public.external_command_outbox'::regclass and not l.granted); perform pg_sleep(0.02); end loop; end $$;
select is((select l.mode from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='rollback_down' and l.relation='public.external_command_outbox'::regclass and not l.granted limit 1),'ShareRowExclusiveLock','AC-ROP-024 rollback waits for an earlier enqueue before checking history');
select dblink_exec('rollback_enqueue','commit');
select * from dblink_get_result('rollback_down',false) as t(result boolean);
select matches(dblink_error_message('rollback_down'),'captured_payment_history_exists','AC-ROP-024 enqueue committed before check refuses downgrade');
select * from dblink_get_result('rollback_down',false) as t(result boolean);
select dblink_exec('rollback_enqueue',$q$delete from external_command_outbox where id='21950006-0000-0000-0000-000000000007'$q$);
select pg_advisory_lock(2195,868);
select dblink_send_query('rollback_down','select public.test_2195_down(true)');
do $$ begin for i in 1..100 loop exit when exists(select 1 from pg_stat_activity where application_name='rollback_down' and wait_event='advisory'); perform pg_sleep(0.02); end loop; end $$;
select is((select wait_event from pg_stat_activity where application_name='rollback_down'),'advisory','AC-ROP-024 downgrade holds its locks before the concurrent enqueue');
select dblink_send_query('rollback_enqueue',$q$insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,actor_user_id) values ('21950006-0000-0000-0000-000000000007','21950006-0000-0000-0000-000000000001','procurement','rollback-race','rollback-race','erpnext','create','pending','{"procurementId":"21950006-0000-0000-0000-000000000004","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21950006-0000-0000-0000-000000000005"}','21950006-0000-0000-0000-000000000002') returning id::text$q$);
select pg_sleep(0.3);
select is(dblink_is_busy('rollback_enqueue'),1,'AC-ROP-024 enqueue waits until downgrade commits');
select pg_advisory_unlock(2195,868);
select * from dblink_get_result('rollback_down') as t(result boolean);
select * from dblink_get_result('rollback_down') as t(result boolean);
select * from dblink_get_result('rollback_enqueue') as t(id text);
select * from dblink_get_result('rollback_enqueue') as t(id text);
select is((select result from dblink('rollback_enqueue',$q$select public.record_only_step_refusal('21950006-0000-0000-0000-000000000004')$q$) as t(result text)),'record_only_forward_step_refused','AC-ROP-024 restored policy still refuses captured purchase');
select is((select result from dblink('rollback_enqueue',$q$select public.test_2195_claim('21950006-0000-0000-0000-000000000007')$q$) as t(result text)),'P0001:procurement-payment-refused: record_only_forward_step_refused','AC-ROP-024 restored claim refuses the delayed enqueue');
select dblink_exec('rollback_enqueue',$q$delete from external_command_outbox where id='21950006-0000-0000-0000-000000000007'$q$);
create temporary table rollback_race_up(seq integer generated always as identity, line text);
\copy rollback_race_up(line) from 'supabase/migrations/0868_captured_invoice_payment.sql'
select dblink_exec('rollback_down',(select string_agg(line,E'\n' order by seq) from rollback_race_up));
select dblink_exec('rollback_enqueue',$cleanup$
drop function public.test_2195_claim(uuid); drop function public.test_2195_down(boolean);
delete from erp_purchase_captures where org_id='21950006-0000-0000-0000-000000000001';
delete from procurement_erp_links where org_id='21950006-0000-0000-0000-000000000001';
delete from erp_purchase_documents where org_id='21950006-0000-0000-0000-000000000001';
delete from procurements where org_id='21950006-0000-0000-0000-000000000001';
delete from external_org_bindings where org_id='21950006-0000-0000-0000-000000000001';
delete from profiles where org_id='21950006-0000-0000-0000-000000000001';
delete from auth.users where id='21950006-0000-0000-0000-000000000002';
delete from organizations where id='21950006-0000-0000-0000-000000000001';
$cleanup$);
select dblink_disconnect('rollback_enqueue');
select dblink_disconnect('rollback_down');
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
