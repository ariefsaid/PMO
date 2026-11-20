-- #2195 B1 round 5: a payment step on a placed purchase is eligible like any captured invoice, defeats the undo once it exists, and an undo and a
-- payment enqueue racing for one placed purchase have exactly one winner. The race part commits its fixtures in a second session and removes them.
create extension if not exists dblink with schema extensions;  -- outside the transaction: the cleanup after the rollback still needs it
begin;
select plan(14);
insert into organizations(id,name,default_currency) values ('21951006-0000-0000-0000-000000000001','Evidence org','USD');
insert into auth.users(id,email) values ('21951006-0000-0000-0000-000000000002','assignment-c@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951006-0000-0000-0000-000000000002','21951006-0000-0000-0000-000000000001','Admin C','assignment-c@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21951006-0000-0000-0000-000000000003','21951006-0000-0000-0000-000000000001','Project C','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21951006-0000-0000-0000-000000000004','21951006-0000-0000-0000-000000000001','Supplier C','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21951006-0000-0000-0000-000000000001','companies','21951006-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21951006-0000-0000-0000-000000000005','21951006-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now(),'active');
insert into budget_category_account_map(org_id,category,erp_account) values ('21951006-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21951006-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21951006-0000-0000-0000-000000000099'),
 ('21951006-0000-0000-0000-000000000001','Example','Misc','Misc','Expense','Profit and Loss',false,'USD',3,4,'21951006-0000-0000-0000-000000000099'),
 ('21951006-0000-0000-0000-000000000001','Example','Fixed Assets','Fixed Assets','Asset','Balance Sheet',false,'USD',5,6,'21951006-0000-0000-0000-000000000099'),
 ('21951006-0000-0000-0000-000000000001','Example','Creditors','Creditors','Liability','Balance Sheet',false,'USD',7,8,'21951006-0000-0000-0000-000000000099');
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',true,'ledger_currency','USD') $$;
-- the organization's latest tagged snapshot is newer than every ledger row seeded below, so a placement is not held back by the freshness guard
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951006-0000-0000-0000-000000000001','21951006-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
create function pg_temp.inv(n integer,p_supplier text default 'SUP-1',p_currency text default 'USD',p_status smallint default 1,p_return boolean default false,p_project text default null,p_bill text default null,p_ids uuid[] default '{}') returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,is_return,erp_project,project_ids,bill_no,erp_modified)
 values (('21951006-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'21951006-0000-0000-0000-000000000001','Purchase Invoice','INV-'||n,p_supplier,'Supplier C',p_currency,100,100,'Unpaid',p_status,p_return,p_project,p_ids,p_bill,'1') $$;
create function pg_temp.gl(n integer,p_account text,p_debit numeric,p_credit numeric default 0,p_company text default 'Example',p_project text default null) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
 values ('21951006-0000-0000-0000-000000000001','GL-'||n||'-'||p_account||'-'||p_debit||'-'||p_company,p_company,p_account,p_project,'Purchase Invoice','INV-'||n,'2026-02-01',p_debit,p_credit,false,'1') $$;
create function pg_temp.call(n integer,p_decision text,p_dry boolean,p_extra jsonb default '{}',p_request uuid default gen_random_uuid(),p_revision text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select public.assign_capture_invoices(jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('request_id',p_request,'source_id',('21951006-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'decision',p_decision,
   'project_id',case when p_decision='project' then '21951006-0000-0000-0000-000000000003' end) || p_extra)),
   coalesce(p_revision,public.purchase_capture_source_page(null,null,1)->>'revision'),p_dry) into v;
 return v;
end $$;
create function pg_temp.reason(n integer,p_decision text default 'project',p_extra jsonb default '{}') returns text language sql as $$ select pg_temp.call(n,p_decision,true,p_extra)#>>'{results,0,reason}' $$;

create function pg_temp.proc(n integer) returns uuid language sql as $$ select procurement_id from erp_capture_invoice_assignments where source_document_id=('21951006-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
select pg_temp.inv(1); select pg_temp.gl(1,'Cost',100);
select pg_temp.inv(2); select pg_temp.gl(2,'Cost',100);
select pg_temp.inv(3); select pg_temp.gl(3,'Cost',100);
select pg_temp.inv(4); select pg_temp.gl(4,'Cost',100);
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951006-0000-0000-0000-000000000001','21951006-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951006-0000-0000-0000-000000000002","role":"authenticated"}';
select pg_temp.call(n,'project',false) from generate_series(1,4) n;
reset role;
update erp_purchase_documents set outstanding_amount=100 where org_id='21951006-0000-0000-0000-000000000001';
select is(public.record_only_step_refusal(pg_temp.proc(1),'payment',null),null,'AC-ROP-024 a placed purchase is eligible for a payment step like any captured invoice');
select is(public.record_only_step_refusal(pg_temp.proc(1),'purchase-invoice',null),'step_already_recorded','AC-ROP-024 its invoice step is already recorded');
select is(public.record_only_step_refusal(pg_temp.proc(1),'cancel',null),'record_only_use_undo','AC-ROP-024 cancelling it goes through the undo');
update erp_purchase_documents set erp_status='Paid', outstanding_amount=0 where id='21951006-1000-0000-0000-000000000004';
select is(public.record_only_step_refusal(pg_temp.proc(4),'payment',null),'history_complete','AC-ROP-024 a placed invoice the ERP shows as paid is history only');
-- a payment command in flight: undo refuses and the decision stays live
set local request.jwt.claims='{"role":"service_role"}';
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21951006-0000-0000-0000-000000000001','procurement','pay-1','pay-1','erpnext','create','pending',
 jsonb_build_object('procurementId',pg_temp.proc(1)::text,'erp_doc_kind','payment','capturedInvoiceDocumentId','21951006-1000-0000-0000-000000000001','pi_names',jsonb_build_array('INV-1')));
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951006-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(format('select public.undo_captured_purchase(%L::uuid,%L,false)',pg_temp.proc(1),'late'),'55000','has_later_pmo_steps','AC-ROP-009 a payment command in flight refuses the undo of a placed purchase');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a join procurements p on p.id=a.procurement_id join erp_purchase_captures c on c.procurement_id=p.id where a.source_document_id='21951006-1000-0000-0000-000000000001' and a.undone_at is null and p.status<>'Cancelled' and c.undone_at is null),1,'AC-ROP-009 the refused undo leaves the decision, wrapper and capture as they were');
-- a recorded payment does the same
set local request.jwt.claims='{"role":"service_role"}';
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21951006-0000-0000-0000-000000000001','procurement','21951006-5000-0000-0000-000000000002','pay-2','erpnext','create','pending',
 jsonb_build_object('procurementId',pg_temp.proc(2)::text,'erp_doc_kind','payment','capturedInvoiceDocumentId','21951006-1000-0000-0000-000000000002','pi_names',jsonb_build_array('INV-2')));
update external_command_outbox set state='confirmed' where idempotency_key='pay-2';
insert into payments(id,org_id,procurement_id,status,amount,erp_docstatus) values ('21951006-5000-0000-0000-000000000002','21951006-0000-0000-0000-000000000001',pg_temp.proc(2),'Paid',25,1);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951006-0000-0000-0000-000000000002","role":"authenticated"}';
select throws_ok(format('select public.undo_captured_purchase(%L::uuid,%L,false)',pg_temp.proc(2),'late'),'55000','has_later_pmo_steps','AC-ROP-009 a recorded payment refuses the undo of a placed purchase');
reset role;
-- without a later step the undo goes through
set local role authenticated;
select is(public.undo_captured_purchase(pg_temp.proc(3),'no later steps')->>'outcome','undo','AC-ROP-009 a placed purchase with no later step is undone');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id='21951006-1000-0000-0000-000000000003' and undone_at is not null),1,'AC-ROP-009 and its decision is deactivated');
-- the race: committed fixtures in a second session
select dblink_connect('placed_race',format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_exec('placed_race',$q$set lock_timeout='3s'; set statement_timeout='5s'$q$);
set local statement_timeout='5s';
select dblink_exec('placed_race',$setup$
insert into organizations(id,name,default_currency) values ('21951007-0000-0000-0000-000000000001','Placed race','USD');
insert into auth.users(id,email) values ('21951007-0000-0000-0000-000000000002','placed-race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951007-0000-0000-0000-000000000002','21951007-0000-0000-0000-000000000001','Admin','placed-race@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21951007-0000-0000-0000-000000000004','21951007-0000-0000-0000-000000000001','Race project','Ongoing Project');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21951007-0000-0000-0000-000000000003','21951007-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status,origin,project_id)
select ('21951007-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21951007-0000-0000-0000-000000000001','Race '||g,'21951007-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced','erp_link','21951007-0000-0000-0000-000000000004' from generate_series(1,2) g;
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,currency,grand_total,outstanding_amount,erp_docstatus,erp_modified)
select ('21951007-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21951007-0000-0000-0000-000000000001','Purchase Invoice','RACE-'||g,'USD',100,100,1,'2026-01-01' from generate_series(1,2) g;
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id)
select '21951007-0000-0000-0000-000000000001',('21951007-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,('21951007-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,2) g;
update procurements set record_only=true where org_id='21951007-0000-0000-0000-000000000001';
insert into erp_purchase_captures(org_id,procurement_id,binding_id,request_id,payload,kind,stage,captured_by)
select '21951007-0000-0000-0000-000000000001',('21951007-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21951007-0000-0000-0000-000000000003',('21951007-3000-0000-0000-'||lpad(g::text,12,'0'))::uuid,jsonb_build_object('source_ids',jsonb_build_array(('21951007-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid)),'supplier_invoice','invoiced','21951007-0000-0000-0000-000000000002' from generate_series(1,2) g;
insert into erp_capture_invoice_assignments(org_id,binding_id,source_document_id,request_id,payload_digest,decision,project_id,procurement_id,actor_id,source_voucher_type,source_voucher_no,source_company)
select '21951007-0000-0000-0000-000000000001','21951007-0000-0000-0000-000000000003',('21951007-2000-0000-0000-'||lpad(g::text,12,'0'))::uuid,('21951007-3000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'x','project','21951007-0000-0000-0000-000000000004',('21951007-1000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'21951007-0000-0000-0000-000000000002','Purchase Invoice','RACE-'||g,'Example' from generate_series(1,2) g;
$setup$);
select dblink_exec('placed_race',$q$begin; insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21951007-0000-0000-0000-000000000001','procurement','race-1','race-1','erpnext','create','pending','{"procurementId":"21951007-1000-0000-0000-000000000001","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21951007-2000-0000-0000-000000000001","pi_names":["RACE-1"]}')$q$);
set local role authenticated;
set local request.jwt.claims='{"role":"authenticated","sub":"21951007-0000-0000-0000-000000000002"}';
set local lock_timeout='300ms';
select throws_ok($q$select public.undo_captured_purchase('21951007-1000-0000-0000-000000000001','reviewed',false)$q$,'55P03',null,'AC-ROP-009 undo of a placed purchase waits for a concurrent payment enqueue');
set local lock_timeout='3s';
select dblink_exec('placed_race','commit');
select throws_ok($q$select public.undo_captured_purchase('21951007-1000-0000-0000-000000000001','reviewed',false)$q$,'55000','has_later_pmo_steps','AC-ROP-009 the committed enqueue wins and the undo is refused');
reset role;
select dblink_exec('placed_race',$q$begin; set local request.jwt.claims='{"role":"authenticated","sub":"21951007-0000-0000-0000-000000000002"}'; set local role authenticated$q$);
select * from dblink('placed_race',$q$select public.undo_captured_purchase('21951007-1000-0000-0000-000000000002','reviewed',false)::text$q$) as t(result text);
set local request.jwt.claims='{"role":"service_role"}';
set local lock_timeout='300ms';
select throws_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21951007-0000-0000-0000-000000000001','procurement','race-2','race-2','erpnext','create','pending','{"procurementId":"21951007-1000-0000-0000-000000000002","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21951007-2000-0000-0000-000000000002","pi_names":["RACE-2"]}')$q$,'55P03',null,'AC-ROP-009 a payment enqueue waits for a concurrent undo of a placed purchase');
set local lock_timeout='3s';
select dblink_exec('placed_race','commit');
select throws_ok($q$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values ('21951007-0000-0000-0000-000000000001','procurement','race-2','race-2','erpnext','create','pending','{"procurementId":"21951007-1000-0000-0000-000000000002","erp_doc_kind":"payment","capturedInvoiceDocumentId":"21951007-2000-0000-0000-000000000002","pi_names":["RACE-2"]}')$q$,'42501','record_only_forward_step_refused','AC-ROP-009 the committed undo wins and the enqueue is refused');
select is((select string_agg(p.n::text||':'||(a.undone_at is not null)::text,',' order by p.n) from erp_capture_invoice_assignments a join (values (1,'21951007-1000-0000-0000-000000000001'::uuid),(2,'21951007-1000-0000-0000-000000000002'::uuid)) p(n,id) on p.id=a.procurement_id),'1:false,2:true','AC-ROP-009 exactly one winner each way: the enqueue keeps its decision live, the undo deactivates it');
select * from finish();
rollback;
-- Cleanup runs after the test transaction has rolled back, so it can never wait on a row this session holds.
select dblink_exec('placed_race',$cleanup$
delete from external_command_outbox where org_id='21951007-0000-0000-0000-000000000001';
delete from audit_events where org_id='21951007-0000-0000-0000-000000000001';
delete from procurement_status_events where org_id='21951007-0000-0000-0000-000000000001';
delete from erp_capture_invoice_assignments where org_id='21951007-0000-0000-0000-000000000001';
delete from erp_purchase_captures where org_id='21951007-0000-0000-0000-000000000001';
delete from procurement_erp_links where org_id='21951007-0000-0000-0000-000000000001';
delete from erp_purchase_documents where org_id='21951007-0000-0000-0000-000000000001';
delete from procurements where org_id='21951007-0000-0000-0000-000000000001';
delete from projects where org_id='21951007-0000-0000-0000-000000000001';
delete from external_org_bindings where org_id='21951007-0000-0000-0000-000000000001';
delete from profiles where org_id='21951007-0000-0000-0000-000000000001';
delete from auth.users where id='21951007-0000-0000-0000-000000000002';
delete from organizations where id='21951007-0000-0000-0000-000000000001';
$cleanup$);
select dblink_disconnect('placed_race');
drop extension dblink;  -- created before the transaction so the cleanup could run after its rollback; leave the database as found
