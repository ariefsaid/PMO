-- #2195 B1 round 1: who may decide an invoice placement, what a decision persists, and how a decision is claimed once.
-- The applied path of the public RPC is not built yet (source validation, wrapper and mark arrive in round 2); the
-- claim helper it will call is exercised directly. The race section uses committed fixtures in a second session.
begin;
select plan(125);
create extension if not exists dblink;
insert into organizations(id,name,default_currency) values
 ('21951001-0000-0000-0000-000000000001','Assignment org A','USD'),
 ('21951001-0000-0000-0000-000000000002','Assignment org B','USD');
insert into auth.users(id,email) values
 ('21951001-0000-0000-0000-000000000003','assignment-a@example.test'),
 ('21951001-0000-0000-0000-000000000004','assignment-b@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('21951001-0000-0000-0000-000000000003','21951001-0000-0000-0000-000000000001','Admin A','assignment-a@example.test','Admin','active'),
 ('21951001-0000-0000-0000-000000000004','21951001-0000-0000-0000-000000000002','Admin B','assignment-b@example.test','Admin','active');
insert into projects(id,org_id,name,status) values
 ('21951001-0000-0000-0000-000000000005','21951001-0000-0000-0000-000000000001','Project A','Ongoing Project'),
 ('21951001-0000-0000-0000-000000000006','21951001-0000-0000-0000-000000000002','Project B','Ongoing Project');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21951001-0000-0000-0000-000000000012','21951001-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active'),
 ('21951001-0000-0000-0000-000000000013','21951001-0000-0000-0000-000000000002','erpnext','https://example.test','test','{}',now(),'active');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,erp_docstatus,erp_modified) values
 ('21951001-0000-0000-0000-000000000009','21951001-0000-0000-0000-000000000001','Purchase Invoice','A','A',1,'1'),
 ('21951001-0000-0000-0000-000000000010','21951001-0000-0000-0000-000000000002','Purchase Invoice','B','B',1,'1'),
 ('21951001-0000-0000-0000-000000000014','21951001-0000-0000-0000-000000000001','Purchase Invoice','A2','A',1,'1'),
 ('21951001-0000-0000-0000-000000000015','21951001-0000-0000-0000-000000000001','Purchase Invoice','A3','A',1,'1'),
 ('21951001-0000-0000-0000-000000000016','21951001-0000-0000-0000-000000000001','Purchase Invoice','A4','A',1,'1');
create function pg_temp.preview(p_row jsonb) returns text language plpgsql as $$
declare v jsonb;
begin
 execute 'select public.assign_capture_invoices($1,$2,true)' into v using jsonb_build_array(p_row), 'revision';
 return v#>>'{results,0,outcome}';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;
create function pg_temp.apply_state(p_row jsonb) returns text language plpgsql as $$
begin
 perform public.assign_capture_invoices(jsonb_build_array(p_row),'revision',false);
 return 'applied';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;
-- The claim helper, as the applied path will call it; normalised row in, one result out.
create function pg_temp.claim(p_request text,p_source text,p_decision text,p_project text,p_dry boolean,p_accept boolean default false) returns jsonb language sql as $$
 select public.capture_assignment_claim('21951001-0000-0000-0000-000000000001','21951001-0000-0000-0000-000000000012','21951001-0000-0000-0000-000000000003',
  jsonb_strip_nulls(jsonb_build_object('request_id',p_request,'source_id',p_source,'decision',p_decision,'project_id',p_project,'accept_set_aside',p_accept,'allow_capital_as_overhead',false)),'revision',p_dry) $$;
select set_config('b1.row','{"request_id":"21951001-0000-0000-0000-000000000011","source_id":"21951001-0000-0000-0000-000000000009","decision":"project","project_id":"21951001-0000-0000-0000-000000000005"}',true);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951001-0000-0000-0000-000000000003","role":"authenticated"}';
select is(pg_temp.preview(current_setting('b1.row')::jsonb),'refused','AC-ROP-005 only active Admin decides: active Admin gets a per-row answer, here no company evidence');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"source_id":"21951001-0000-0000-0000-000000000010"}'::jsonb),'not_found','AC-ROP-006 foreign source not found');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"project_id":"21951001-0000-0000-0000-000000000006"}'::jsonb),'not_found','AC-ROP-006 foreign project not found');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"vendor_id":"21951001-0000-0000-0000-000000000008"}'::jsonb),'22023:invalid_assignment_row','AC-ROP-006 foreign vendor cannot be supplied');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"actor_id":"21951001-0000-0000-0000-000000000004"}'::jsonb),'22023:invalid_assignment_row','AC-ROP-005 forged actor rejected');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"org_id":"21951001-0000-0000-0000-000000000002"}'::jsonb),'22023:invalid_assignment_row','AC-ROP-006 forged organization rejected');
select throws_ok($$insert into public.erp_capture_invoice_assignments default values$$,'42501',null,'AC-ROP-005 authenticated cannot insert directly');
select throws_ok($$update public.erp_capture_invoice_assignments set decision='set_aside'$$,'42501',null,'AC-ROP-005 authenticated cannot update directly');
select throws_ok($$delete from public.erp_capture_invoice_assignments$$,'42501',null,'AC-ROP-005 authenticated cannot delete directly');
select throws_ok($$select public.assign_capture_invoices('[]','revision',true)$$,'22023','invalid_assignment_rows','AC-ROP-005 empty batch refused');
select throws_ok($$select public.assign_capture_invoices((select jsonb_agg('{}'::jsonb) from generate_series(1,501)),'revision',true)$$,'22023','invalid_assignment_rows','AC-ROP-005 oversized batch refused');
select is(pg_temp.preview(current_setting('b1.row')::jsonb || '{"decision":"unknown"}'::jsonb),'22023:invalid_assignment_row','AC-ROP-005 unknown decision refused');
select is(pg_temp.preview(current_setting('b1.row')::jsonb - 'project_id'),'22023:invalid_assignment_row','AC-ROP-005 project decision requires project');
select is(pg_temp.preview((current_setting('b1.row')::jsonb || '{"decision":"set_aside"}'::jsonb)),'22023:invalid_assignment_row','AC-ROP-005 set-aside decision carries no project');
select throws_ok($$select public.assign_capture_invoices(jsonb_build_array(current_setting('b1.row')::jsonb,current_setting('b1.row')::jsonb),'revision',true)$$,'22023','duplicate_assignment_row','AC-ROP-005 duplicate rows in one batch refused');
select is((select public.assign_capture_invoices(jsonb_build_array(current_setting('b1.row')::jsonb),'revision',false))->>'reason','source_stale','AC-ROP-005 apply refuses a revision that is not the current one');
-- another organization's Admin cannot reach this organization's source
set local request.jwt.claims = '{"sub":"21951001-0000-0000-0000-000000000004","role":"authenticated"}';
select is(pg_temp.preview(current_setting('b1.row')::jsonb),'not_found','AC-ROP-006 other organization Admin finds no source');
set local request.jwt.claims = '{"sub":"21951001-0000-0000-0000-000000000003","role":"authenticated"}';
reset role;
update profiles set status='disabled' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 disabled Admin refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 disabled Admin refused from applying');
reset role;
update profiles set status='active' where id='21951001-0000-0000-0000-000000000003';
update auth.users set banned_until=now()+interval '1 day' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 banned Admin refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 banned Admin refused from applying');
reset role;
update auth.users set banned_until=null where id='21951001-0000-0000-0000-000000000003';
update profiles set role='Executive' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Executive refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Executive refused from applying');
reset role;
update profiles set role='Project Manager' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Project Manager refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Project Manager refused from applying');
reset role;
update profiles set role='Finance' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Finance refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Finance refused from applying');
reset role;
update profiles set role='Engineer' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Engineer refused');
select alike(pg_temp.apply_state(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Engineer refused from applying');
reset role;
update profiles set role='Admin' where id='21951001-0000-0000-0000-000000000003';
set local role anon;
select throws_ok($$select public.assign_capture_invoices('[]','revision',true)$$,'42501',null,'AC-ROP-005 anonymous preview refused');
select throws_ok($$insert into public.erp_capture_invoice_assignments default values$$,'42501',null,'AC-ROP-005 anonymous cannot insert directly');
reset role;
select ok(has_function_privilege('authenticated','public.assign_capture_invoices(jsonb,text,boolean)','execute') and not has_function_privilege('anon','public.assign_capture_invoices(jsonb,text,boolean)','execute'),'AC-ROP-005 only signed-in callers may execute the RPC');
select ok(not has_function_privilege('authenticated','public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean)','execute')
  and not has_function_privilege('anon','public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean)','execute')
  and not has_function_privilege('service_role','public.capture_assignment_claim(uuid,uuid,uuid,jsonb,text,boolean)','execute'),'AC-ROP-005 the claim helper is not callable by any API role');
select is((select count(*)::int from public.erp_capture_invoice_assignments)+(select count(*)::int from public.erp_purchase_document_marks where org_id='21951001-0000-0000-0000-000000000001'),0,'AC-ROP-005 preview writes no decision and no mark');
select is((select count(*)::int from public.procurements where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.procurement_erp_links where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.audit_events where org_id='21951001-0000-0000-0000-000000000001' and (action ~* 'assign|invoice|capture|purchase|procurement|erp' or entity_type ~* 'assign|invoice|capture|purchase|procurement'))+(select count(*)::int from public.external_command_outbox where org_id='21951001-0000-0000-0000-000000000001'),0,'AC-ROP-005 preview writes no wrapper link audit or outbox');

-- AC-ROP-008: one request, one payload, one decision per source
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000021','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'outcome'),'recorded','AC-ROP-008 assignment retry and conflict: first request records a decision');
select is((select count(*)::int from public.erp_capture_invoice_assignments where org_id='21951001-0000-0000-0000-000000000001' and source_document_id='21951001-0000-0000-0000-000000000009' and undone_at is null and actor_id='21951001-0000-0000-0000-000000000003' and binding_id='21951001-0000-0000-0000-000000000012' and decision='project' and project_id='21951001-0000-0000-0000-000000000005'),1,'AC-ROP-008 decision stores org, binding, actor, source and project from the server');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000021','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'outcome'),'skip','AC-ROP-008 same request and payload returns the stored result');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000021','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'decision_id'),(select id::text from public.erp_capture_invoice_assignments where request_id='21951001-0000-0000-0000-000000000021'),'AC-ROP-008 the retry names the original decision');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id='21951001-0000-0000-0000-000000000009'),1,'AC-ROP-008 a retry adds no second decision');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000021','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false,true)->>'reason'),'request_conflict','AC-ROP-008 changed payload under the same request is refused');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000022','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'reason'),'source_already_decided','AC-ROP-008 a second request for a decided source is refused');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id='21951001-0000-0000-0000-000000000009'),1,'AC-ROP-008 the refused requests left exactly one decision');
-- dry run leaves nothing, not even a request reservation
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000023','21951001-0000-0000-0000-000000000014','project','21951001-0000-0000-0000-000000000005',true)->>'outcome'),'preview','AC-ROP-008 dry run previews an undecided source');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id='21951001-0000-0000-0000-000000000014'),0,'AC-ROP-008 dry run persists nothing');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000023','21951001-0000-0000-0000-000000000014','set_aside',null,false)->>'outcome'),'recorded','AC-ROP-008 dry run reserved no request: the same request id may later carry a different decision');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000024','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',true)->>'reason'),'source_already_decided','AC-ROP-008 dry run reports a decided source');
select is((select project_id::text from public.erp_capture_invoice_assignments where request_id='21951001-0000-0000-0000-000000000023'),null,'AC-ROP-008 a set-aside decision carries no project');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000025','21951001-0000-0000-0000-000000000010','project','21951001-0000-0000-0000-000000000005',false)->>'outcome'),'not_found','AC-ROP-006 the claim finds no foreign source');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000026','21951001-0000-0000-0000-000000000015','project','21951001-0000-0000-0000-000000000006',false)->>'outcome'),'not_found','AC-ROP-006 the claim finds no foreign project');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id in ('21951001-0000-0000-0000-000000000010','21951001-0000-0000-0000-000000000015')),0,'AC-ROP-006 foreign inputs leave no decision');
-- a decision is immutable except for its undo; a fresh request is allowed only after the undo
select throws_ok($$update public.erp_capture_invoice_assignments set project_id=null,decision='set_aside' where request_id='21951001-0000-0000-0000-000000000021'$$,'55000','assignment_decision_immutable','AC-ROP-008 a recorded decision cannot be rewritten');
update public.erp_capture_invoice_assignments set undone_at=now(),undone_reason='test' where request_id='21951001-0000-0000-0000-000000000021';
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000021','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'reason'),'undone','AC-ROP-008 an undone request cannot be replayed');
select is((select pg_temp.claim('21951001-0000-0000-0000-000000000027','21951001-0000-0000-0000-000000000009','project','21951001-0000-0000-0000-000000000005',false)->>'outcome'),'recorded','AC-ROP-008 a fresh request is accepted once the earlier decision is undone');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id='21951001-0000-0000-0000-000000000009' and undone_at is null),1,'AC-ROP-008 exactly one active decision after the undo');
select is((select count(*)::int from public.erp_purchase_document_marks where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.procurements where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.external_command_outbox where org_id='21951001-0000-0000-0000-000000000001'),0,'AC-ROP-008 claims write no mark, wrapper or outbox row');

-- AC-ROP-007 / AC-ROP-025: source evidence and classification, through the public RPC, in a fully mapped organization.
insert into organizations(id,name,default_currency) values ('21951003-0000-0000-0000-000000000001','Evidence org','USD');
insert into auth.users(id,email) values ('21951003-0000-0000-0000-000000000002','assignment-c@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951003-0000-0000-0000-000000000002','21951003-0000-0000-0000-000000000001','Admin C','assignment-c@example.test','Admin','active');
insert into projects(id,org_id,name,status) values ('21951003-0000-0000-0000-000000000003','21951003-0000-0000-0000-000000000001','Project C','Ongoing Project');
insert into companies(id,org_id,name,type) values ('21951003-0000-0000-0000-000000000004','21951003-0000-0000-0000-000000000001','Supplier C','Vendor');
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21951003-0000-0000-0000-000000000001','companies','21951003-0000-0000-0000-000000000004','erpnext','Supplier:SUP-1');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values
 ('21951003-0000-0000-0000-000000000005','21951003-0000-0000-0000-000000000001','erpnext','https://example.test','test','{"company":"Example"}',now(),'active');
insert into budget_category_account_map(org_id,category,erp_account) values ('21951003-0000-0000-0000-000000000001','Materials','Cost');
insert into erp_account_mirror(org_id,company,erp_name,account_name,root_type,report_type,is_group,account_currency,lft,rgt,refresh_id) values
 ('21951003-0000-0000-0000-000000000001','Example','Cost','Cost','Expense','Profit and Loss',false,'USD',1,2,'21951003-0000-0000-0000-000000000099'),
 ('21951003-0000-0000-0000-000000000001','Example','Misc','Misc','Expense','Profit and Loss',false,'USD',3,4,'21951003-0000-0000-0000-000000000099'),
 ('21951003-0000-0000-0000-000000000001','Example','Fixed Assets','Fixed Assets','Asset','Balance Sheet',false,'USD',5,6,'21951003-0000-0000-0000-000000000099'),
 ('21951003-0000-0000-0000-000000000001','Example','Creditors','Creditors','Liability','Balance Sheet',false,'USD',7,8,'21951003-0000-0000-0000-000000000099');
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',true,'ledger_currency','USD') $$;
-- the organization's latest tagged snapshot is newer than every ledger row seeded below, so a placement is not held back by the freshness guard
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951003-0000-0000-0000-000000000001','21951003-0000-0000-0000-0000000000e1',now()+interval '1 day',now());
create function pg_temp.inv(n integer,p_supplier text default 'SUP-1',p_currency text default 'USD',p_status smallint default 1,p_return boolean default false,p_project text default null,p_bill text default null,p_ids uuid[] default '{}') returns void language sql as $$
 insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,supplier_name,currency,grand_total,net_total,erp_status,erp_docstatus,is_return,erp_project,project_ids,bill_no,erp_modified)
 values (('21951003-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'21951003-0000-0000-0000-000000000001','Purchase Invoice','INV-'||n,p_supplier,'Supplier C',p_currency,100,100,'Unpaid',p_status,p_return,p_project,p_ids,p_bill,'1') $$;
create function pg_temp.gl(n integer,p_account text,p_debit numeric,p_credit numeric default 0,p_company text default 'Example',p_project text default null) returns void language sql as $$
 insert into erp_gl_entry_mirror(org_id,erp_name,company,account,project,voucher_type,voucher_no,posting_date,debit,credit,is_cancelled,erp_modified)
 values ('21951003-0000-0000-0000-000000000001','GL-'||n||'-'||p_account||'-'||p_debit||'-'||p_company,p_company,p_account,p_project,'Purchase Invoice','INV-'||n,'2026-02-01',p_debit,p_credit,false,'1') $$;
select pg_temp.inv(1); select pg_temp.gl(1,'Cost',100); select pg_temp.gl(1,'Creditors',0,100);
select pg_temp.inv(2); select pg_temp.gl(2,'Fixed Assets',100); select pg_temp.gl(2,'Creditors',0,100);
select pg_temp.inv(3); select pg_temp.gl(3,'Cost',60); select pg_temp.gl(3,'Fixed Assets',40); select pg_temp.gl(3,'Creditors',0,100);
select pg_temp.inv(4); select pg_temp.gl(4,'Misc',100); select pg_temp.gl(4,'Creditors',0,100);
select pg_temp.inv(5); select pg_temp.gl(5,'Mystery',100);
select pg_temp.inv(6); select pg_temp.gl(6,'Cost',100,0,'Example','ERPX');
select pg_temp.inv(7);
select pg_temp.inv(8); select pg_temp.gl(8,'Cost',100,0,'Other');
select pg_temp.inv(9,'SUP-1',null); select pg_temp.gl(9,'Cost',100);
select pg_temp.inv(10,'SUP-9'); select pg_temp.gl(10,'Cost',100);
select pg_temp.inv(11,'SUP-1','USD'::text,1::smallint,true); select pg_temp.gl(11,'Cost',100);
select pg_temp.inv(12,'SUP-1','USD'::text,2::smallint); select pg_temp.gl(12,'Cost',100);
select pg_temp.inv(13); select pg_temp.gl(13,'Cost',100);
select pg_temp.inv(14,'SUP-1','USD'::text,1::smallint,false,'ERPY'); select pg_temp.gl(14,'Cost',100);
select pg_temp.inv(15,'SUP-1','USD'::text,1::smallint,false,null,null,array['21951003-0000-0000-0000-0000000000a1'::uuid,'21951003-0000-0000-0000-0000000000a2'::uuid]); select pg_temp.gl(15,'Cost',100);
select pg_temp.inv(16); select pg_temp.gl(16,'Cost',100);
select pg_temp.inv(18,'SUP-1','USD'::text,1::smallint,false,null,'B-2'); select pg_temp.gl(18,'Cost',100);
select pg_temp.inv(19,'SUP-1','USD'::text,1::smallint,false,null,'B-2'); select pg_temp.gl(19,'Cost',100);
-- invoice 13 is a vendor bill PMO itself recorded; invoice 18 is already linked to a purchase
insert into procurements(id,org_id,title,requested_by_id,currency,total_value,status) values
 ('21951003-0000-0000-0000-0000000000b1','21951003-0000-0000-0000-000000000001','PMO bill','21951003-0000-0000-0000-000000000002','USD',0,'Draft'),
 ('21951003-0000-0000-0000-0000000000b2','21951003-0000-0000-0000-000000000001','Linked','21951003-0000-0000-0000-000000000002','USD',100,'Vendor Invoiced');
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
insert into procurement_invoices(id,procurement_id,org_id,status,amount,currency,tax_treatment,tax_amount) values ('21951003-0000-0000-0000-0000000000b3','21951003-0000-0000-0000-0000000000b1','21951003-0000-0000-0000-000000000001','Received',5,'USD','exclusive',0);
insert into external_refs(org_id,domain,pmo_record_id,external_tier,external_record_id) values ('21951003-0000-0000-0000-000000000001','procurement','21951003-0000-0000-0000-0000000000b3','erpnext','INV-13');
insert into procurement_erp_links(org_id,procurement_id,erp_purchase_document_id) values ('21951003-0000-0000-0000-000000000001','21951003-0000-0000-0000-0000000000b2','21951003-1000-0000-0000-000000000018');
-- helpers: one-row calls as the Admin of this organization; the reviewed revision is read from a preview
create function pg_temp.call(n integer,p_decision text,p_dry boolean,p_extra jsonb default '{}',p_request uuid default gen_random_uuid(),p_revision text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
 select public.assign_capture_invoices(jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('request_id',p_request,'source_id',('21951003-1000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'decision',p_decision,
   'project_id',case when p_decision='project' then '21951003-0000-0000-0000-000000000003' end) || p_extra)),
   coalesce(p_revision,public.purchase_capture_source_page(null,null,1)->>'revision'),p_dry) into v;
 return v;
end $$;
create function pg_temp.reason(n integer,p_decision text default 'project',p_extra jsonb default '{}') returns text language sql as $$ select pg_temp.call(n,p_decision,true,p_extra)#>>'{results,0,reason}' $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.reason(6),'source_tagged','AC-ROP-007 source evidence and classification: a line tagged with an ERP project is refused');
select is(pg_temp.reason(14),'source_tagged','AC-ROP-007 an unmapped header project is not an unassigned invoice');
select is(pg_temp.reason(15),'document_spans_projects','AC-ROP-007 a split invoice is refused');
select is(pg_temp.reason(8),'ledger_company_mismatch','AC-ROP-007 ledger lines of a foreign company are refused');
select is(pg_temp.reason(7),'ledger_evidence_missing','AC-ROP-007 missing ledger lines are refused');
select is(pg_temp.reason(12),'document_cancelled','AC-ROP-007 a cancelled invoice is refused');
select is(pg_temp.reason(11),'document_is_return','AC-ROP-007 a return is refused');
select is(pg_temp.reason(13),'document_recorded_by_pmo','AC-ROP-007 an invoice PMO recorded itself is refused');
select is(pg_temp.reason(10),'supplier_unknown','AC-ROP-007 an invoice whose supplier is no known vendor is refused');
select is(pg_temp.reason(9),'currency_unknown','AC-ROP-007 an invoice without a currency is refused');
select is(pg_temp.reason(5),'account_classification_unknown','AC-ROP-007 an account without chart evidence is refused');
select is(pg_temp.reason(18),'source_already_linked','AC-ROP-007 an already linked invoice is refused');
select is(pg_temp.reason(19),'duplicate_lineage','AC-ROP-007 a second copy of a placed supplier invoice is refused');
select is(pg_temp.reason(2),'capital_spending_not_assignable','AC-ROP-025 capital and mixed invoice: an all-capital invoice is not assignable');
select is(pg_temp.reason(4),'invoice_has_no_mapped_cost','AC-ROP-025 an invoice with no mapped cost line is refused');
select is((pg_temp.call(3,'project',true))#>>'{results,0,outcome}','create','AC-ROP-025 a mixed invoice is assignable');
select is((pg_temp.call(3,'project',true))#>>'{results,0,mapped_amount}','60','AC-ROP-025 only the mapped expense line counts');
select is((pg_temp.call(3,'project',true))#>>'{results,0,excluded,0,account}','Fixed Assets','AC-ROP-025 the excluded capital line is named');
select is((pg_temp.call(3,'project',true))#>>'{results,0,excluded,0,kind}','capital','AC-ROP-025 the excluded line is classified as capital spending');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where org_id='21951003-0000-0000-0000-000000000001')+(select count(*)::int from procurements where org_id='21951003-0000-0000-0000-000000000001' and origin='erp_link')+(select count(*)::int from erp_purchase_captures where org_id='21951003-0000-0000-0000-000000000001'),0,'AC-ROP-007 previews and refusals leave no decision, wrapper or capture');
-- a valid project decision applies once, atomically
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select set_config('b1.apply',pg_temp.call(1,'project',false,'{}','21951003-0000-0000-0000-0000000000c1')::text,true);
select is(current_setting('b1.apply')::jsonb#>>'{results,0,outcome}','create','AC-ROP-007 a valid invoice applies');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a join procurements p on p.id=a.procurement_id join procurement_erp_links l on l.procurement_id=p.id and l.erp_purchase_document_id=a.source_document_id join erp_purchase_captures c on c.procurement_id=p.id
  where a.request_id='21951003-0000-0000-0000-0000000000c1' and p.record_only and p.record_only_stage='invoiced' and p.project_id='21951003-0000-0000-0000-000000000003' and p.vendor_id='21951003-0000-0000-0000-000000000004' and p.currency='USD' and c.kind='supplier_invoice' and c.captured_by='21951003-0000-0000-0000-000000000002'),1,'AC-ROP-007 decision, record-only wrapper, link and capture provenance exist together');
select is((select project_ids::text from erp_purchase_documents where id='21951003-1000-0000-0000-000000000001'),'{}','AC-ROP-007 the ERP document keeps its empty project');
select is((select count(*)::int from audit_events where org_id='21951003-0000-0000-0000-000000000001' and action='procurement.record_only_create' and detail->>'assignment_origin'='pmo_assignment'),1,'AC-ROP-007 the assignment is audited with its origin');
select is((select count(*)::int from external_command_outbox where org_id='21951003-0000-0000-0000-000000000001'),0,'AC-ROP-007 an assignment writes nothing to the ERP outbox');
select is((select count(*)::int from erp_purchase_document_marks where org_id='21951003-0000-0000-0000-000000000001'),0,'AC-ROP-007 an unmarked invoice gains no mark');
set local role authenticated;
select is(pg_temp.reason(1),'source_already_decided','AC-ROP-007 a placed invoice cannot be decided again');
-- AC-ROP-011: a placement waits for a tagged snapshot at least as new as the invoice's newest ledger row
reset role;
select pg_temp.inv(90); select pg_temp.gl(90,'Cost',100);
update erp_gl_entry_mirror set as_of = now()+interval '2 days' where org_id='21951003-0000-0000-0000-000000000001' and voucher_no='INV-90';
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.reason(90),'snapshot_refresh_required','AC-ROP-011 a ledger row newer than the latest tagged snapshot refuses the placement');
select is(pg_temp.call(90,'project',true)#>>'{results,0,message}','retry after the next ledger refresh','AC-ROP-011 the refusal says to retry after the next ledger refresh');
select is(pg_temp.call(90,'project',false)#>>'{results,0,reason}','snapshot_refresh_required','AC-ROP-011 an applied request is refused the same way');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id='21951003-1000-0000-0000-000000000090')+(select count(*)::int from procurement_erp_links where erp_purchase_document_id='21951003-1000-0000-0000-000000000090'),0,'AC-ROP-011 a refused placement writes no decision and no link');
-- a newer generation lets it through
insert into erp_actuals_snapshot(org_id,snapshot_id,as_of,created_at) values ('21951003-0000-0000-0000-000000000001','21951003-0000-0000-0000-0000000000e2',now()+interval '3 days',now()+interval '1 second');
set local role authenticated;
select is(pg_temp.call(90,'project',true)#>>'{results,0,outcome}','create','AC-ROP-011 a newer tagged snapshot lets the placement through');
reset role;
create temp table snap_keep on commit drop as select * from erp_actuals_snapshot where org_id='21951003-0000-0000-0000-000000000001';
delete from erp_actuals_snapshot where org_id='21951003-0000-0000-0000-000000000001';
set local role authenticated;
select is(pg_temp.reason(90),'snapshot_unavailable','AC-ROP-011 an organization with no tagged snapshot cannot be placed');
reset role;
insert into erp_actuals_snapshot select * from snap_keep;
-- the ordinary linker keeps refusing an unprojected invoice for everyone else
select is((public.link_erp_purchase_documents(jsonb_build_array(jsonb_build_object('erp_name','INV-16','erp_doctype','Purchase Invoice','project_id','21951003-0000-0000-0000-000000000003')),true))#>>'{results,0,reason}','document_has_no_project','AC-ROP-007 the ordinary linker still refuses an invoice with no project');
reset role;


-- AC-ROP-026 / AC-ROP-015: marking an invoice as overhead, capital needing an explicit override, and a previous mark needing confirmation
select pg_temp.inv(20); select pg_temp.gl(20,'Fixed Assets',100); select pg_temp.gl(20,'Creditors',0,100);
select pg_temp.inv(21); select pg_temp.gl(21,'Cost',100);
select pg_temp.inv(22); select pg_temp.gl(22,'Misc',100);
select pg_temp.inv(25); select pg_temp.gl(25,'Cost',100);
select pg_temp.inv(26); select pg_temp.gl(26,'Cost',100);
insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,set_aside_at,set_aside_by,note,updated_by) values
 ('21951003-1000-0000-0000-000000000021','21951003-0000-0000-0000-000000000001','2026-01-01','21951003-0000-0000-0000-000000000002','keep this note','21951003-0000-0000-0000-000000000002'),
 ('21951003-1000-0000-0000-000000000025','21951003-0000-0000-0000-000000000001','2026-01-01','21951003-0000-0000-0000-000000000002',null,'21951003-0000-0000-0000-000000000002');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.reason(20,'set_aside'),'capital_spending_requires_override','AC-ROP-026 capital set aside requires explicit override: capital as overhead is refused without the flag');
select isnt(pg_temp.reason(20,'set_aside'),pg_temp.reason(20),'AC-ROP-026 the project and overhead refusals carry distinct reasons');
select is(pg_temp.call(20,'set_aside',false,'{"allow_capital_as_overhead":true}')#>>'{results,0,outcome}','create','AC-ROP-026 the explicit flag lets a capital invoice be set aside');
select is(pg_temp.call(22,'set_aside',false)#>>'{results,0,outcome}','create','AC-ROP-026 a non-capital invoice is set aside without the flag');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id='21951003-1000-0000-0000-000000000020' and decision='set_aside' and allow_capital_as_overhead and original_classification='capital' and project_id is null and procurement_id is null and actor_id='21951003-0000-0000-0000-000000000002'),1,'AC-ROP-026 the override and the original capital classification are retained on the decision');
select is((select count(*)::int from erp_purchase_document_marks where erp_purchase_document_id='21951003-1000-0000-0000-000000000020' and set_aside_at is not null and set_aside_by='21951003-0000-0000-0000-000000000002'),1,'AC-ROP-026 the invoice is marked set aside by the Admin');
select is((select count(*)::int from procurement_erp_links where erp_purchase_document_id in ('21951003-1000-0000-0000-000000000020','21951003-1000-0000-0000-000000000022')),0,'AC-ROP-026 an overhead decision creates no link or wrapper');
select is((select count(*)::int from audit_events where org_id='21951003-0000-0000-0000-000000000001' and action='procurement.erp_set_aside' and detail->>'capital_override'='true' and detail->>'original_classification'='capital'),1,'AC-ROP-026 the override is audited with the original classification');
select is((select original_classification||allow_capital_as_overhead::text from erp_capture_invoice_assignments where source_document_id='21951003-1000-0000-0000-000000000022'),'unmappedfalse','AC-ROP-026 an ordinary overhead decision records its classification and no override');
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.reason(21),'set_aside_confirmation_required','AC-ROP-015 previous mark requires confirmation: a set-aside invoice needs accept_set_aside to be placed');
select is(pg_temp.reason(25,'set_aside'),'already_set_aside','AC-ROP-015 an invoice already set aside cannot be set aside again');
select is(pg_temp.call(21,'project',false,'{"accept_set_aside":true}')#>>'{results,0,outcome}','create','AC-ROP-015 the confirmed placement applies');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments a where a.source_document_id='21951003-1000-0000-0000-000000000021' and a.accept_set_aside and a.prior_mark_present and a.prior_mark_set_aside_at is not null and a.prior_mark_set_aside_by='21951003-0000-0000-0000-000000000002' and a.prior_mark_note='keep this note'),1,'AC-ROP-015 the previous mark is saved in full on the decision');
select is((select set_aside_at is null and note='keep this note' from erp_purchase_document_marks where erp_purchase_document_id='21951003-1000-0000-0000-000000000021'),true,'AC-ROP-015 placing the invoice clears the set-aside and keeps the note');
insert into cost_attribution_rules(id,org_id,rule_key,version,name,match_account,effective_from,specificity) values ('21951003-0000-0000-0000-0000000000d1','21951003-0000-0000-0000-000000000001','21951003-0000-0000-0000-0000000000d2',1,'Cost rule','Cost','2026-01-01',2);
insert into cost_attribution_rule_targets(rule_id,org_id,position,project_id,percent) values ('21951003-0000-0000-0000-0000000000d1','21951003-0000-0000-0000-000000000001',0,'21951003-0000-0000-0000-000000000003',100);
set local role authenticated;
set local request.jwt.claims = '{"sub":"21951003-0000-0000-0000-000000000002","role":"authenticated"}';
select is(pg_temp.call(26,'set_aside',true)#>>'{results,0,warnings,0}','allocated_by_rule','AC-ROP-015 an overhead decision warns that an existing rule allocates the invoice');
reset role;


-- AC-ROP-008: the reviewed revision is checked once, under the organization fence, before anything is written
select pg_temp.inv(27); select pg_temp.gl(27,'Cost',100);
select pg_temp.inv(28); select pg_temp.gl(28,'Cost',100);
select pg_temp.inv(29); select pg_temp.gl(29,'Cost',100);
create function pg_temp.rev() returns text language plpgsql as $$ declare v text; begin execute 'set local role authenticated'; select public.purchase_capture_source_page(null,null,1)->>'revision' into v; execute 'reset role'; return v; end $$;
select set_config('b1.rev',pg_temp.rev(),true);
update erp_purchase_documents set erp_modified='2' where id='21951003-1000-0000-0000-000000000016';
set local role authenticated;
select is(pg_temp.call(27,'project',false,'{}',gen_random_uuid(),current_setting('b1.rev'))->>'reason','source_stale','AC-ROP-008 source change between preview and apply: a changed source version is stale');
reset role;
select set_config('b1.rev',pg_temp.rev(),true);
update external_org_bindings set config=config||'{"project_map":{"21951003-0000-0000-0000-000000000003":"P"}}' where id='21951003-0000-0000-0000-000000000005';
set local role authenticated;
select is(pg_temp.call(27,'project',false,'{}',gen_random_uuid(),current_setting('b1.rev'))->>'reason','source_stale','AC-ROP-008 a changed mapping is stale');
reset role;
select set_config('b1.rev',pg_temp.rev(),true);
insert into erp_purchase_document_marks(erp_purchase_document_id,org_id,note) values ('21951003-1000-0000-0000-000000000016','21951003-0000-0000-0000-000000000001','a note');
set local role authenticated;
select is(pg_temp.call(27,'project',false,'{}',gen_random_uuid(),current_setting('b1.rev'))->>'reason','source_stale','AC-ROP-008 a changed mark is stale');
reset role;
select set_config('b1.rev',pg_temp.rev(),true);
insert into erp_capture_feed_witnesses(org_id,binding_id,feed_kind,started_at) values ('21951003-0000-0000-0000-000000000001','21951003-0000-0000-0000-000000000005','ledger',now());
set local role authenticated;
select is(pg_temp.call(27,'project',false,'{}',gen_random_uuid(),current_setting('b1.rev'))->>'reason','source_stale','AC-ROP-008 a changed feed witness is stale');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id in ('21951003-1000-0000-0000-000000000027','21951003-1000-0000-0000-000000000028','21951003-1000-0000-0000-000000000029')),0,'AC-ROP-008 a stale review writes nothing');
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',false,'ledger_currency','USD') $$;
set local role authenticated;
select is(pg_temp.call(27,'project',false)->>'reason','feed_not_current','AC-ROP-008 an apply is refused while the ledger feed is not current');
select is((pg_temp.call(27,'project',true))#>>'{results,0,outcome}','create','AC-ROP-008 a preview does not need a current feed');
reset role;
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',true,'ledger_currency',null) $$;
set local role authenticated;
select is(pg_temp.call(27,'project',false)->>'reason','ledger_currency_unknown','AC-ROP-008 an apply is refused while the ledger currency is unknown');
reset role;
create or replace function public.purchase_capture_feed_health() returns jsonb language sql stable as $$ select jsonb_build_object('caught_up',true,'ledger_currency','USD') $$;
set local role authenticated;
select set_config('b1.first',pg_temp.call(27,'project',false,'{}','21951003-0000-0000-0000-0000000000e1')::text,true);
select is(current_setting('b1.first')::jsonb#>>'{results,0,outcome}','create','AC-ROP-008 a current review applies');
select is(pg_temp.call(27,'project',false,'{}','21951003-0000-0000-0000-0000000000e1',current_setting('b1.rev'))#>>'{results,0,outcome}','skip','AC-ROP-008 a retry of the applied row skips even though the revision has moved on');
select is(pg_temp.call(27,'project',false,'{}','21951003-0000-0000-0000-0000000000e1',current_setting('b1.rev'))#>>'{results,0,decision_id}',current_setting('b1.first')::jsonb#>>'{results,0,decision_id}','AC-ROP-008 the retry names the first decision');
reset role;
select is((select count(*)::int from audit_events where org_id='21951003-0000-0000-0000-000000000001' and action='procurement.record_only_create' and detail->>'source_ids'=jsonb_build_array('21951003-1000-0000-0000-000000000027')::text),1,'AC-ROP-008 the retry adds no second audit event');
set local role authenticated;
select set_config('b1.batch',public.assign_capture_invoices(jsonb_build_array(
  jsonb_build_object('request_id','21951003-0000-0000-0000-0000000000e2','source_id','21951003-1000-0000-0000-000000000028','decision','project','project_id','21951003-0000-0000-0000-000000000003'),
  jsonb_build_object('request_id','21951003-0000-0000-0000-0000000000e3','source_id','21951003-1000-0000-0000-000000000029','decision','project','project_id','21951003-0000-0000-0000-000000000003')),
  public.purchase_capture_source_page(null,null,1)->>'revision',false)::text,true);
select is((select count(*)::int from jsonb_array_elements(current_setting('b1.batch')::jsonb->'results') r where r->>'outcome'='create'),2,'AC-ROP-008 a two-row batch applies both rows although the first changes the revision');
reset role;
select is((select count(*)::int from erp_capture_invoice_assignments where source_document_id in ('21951003-1000-0000-0000-000000000028','21951003-1000-0000-0000-000000000029') and procurement_id is not null),2,'AC-ROP-008 both rows hold a decision and a wrapper');

select pg_temp.inv(30); select pg_temp.gl(30,'Cost',60); select pg_temp.gl(30,'Mystery',40);
set local role authenticated;
select is(pg_temp.reason(30),'account_classification_unknown','AC-ROP-025 a mixed invoice with a line of unknown account type is refused, never guessed');
reset role;

select is((select source_voucher_type||'|'||source_voucher_no||'|'||source_company from erp_capture_invoice_assignments where request_id='21951003-0000-0000-0000-0000000000c1'),'Purchase Invoice|INV-1|Example','AC-ROP-007 the decision stores the ledger voucher identity and company from the server, not from the request');
select is((select source_voucher_type||'|'||source_voucher_no||'|'||source_company from erp_capture_invoice_assignments where source_document_id='21951003-1000-0000-0000-000000000020'),'Purchase Invoice|INV-20|Example','AC-ROP-007 a set-aside decision stores the same identity');

-- two sessions compete for one source: the later one waits for the lock, then loses on the unique active decision
select dblink_connect('asg_race',format('dbname=%s user=%s password=postgres host=%s port=%s',current_database(),current_user,coalesce(host(inet_server_addr()),'supabase_db_pmo-portal'),coalesce(inet_server_port(),5432)));
select dblink_exec('asg_race',$setup$
insert into organizations(id,name,default_currency) values ('21951002-0000-0000-0000-000000000001','Assignment race','USD');
insert into auth.users(id,email) values ('21951002-0000-0000-0000-000000000002','assignment-race@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('21951002-0000-0000-0000-000000000002','21951002-0000-0000-0000-000000000001','Admin','assignment-race@example.test','Admin','active');
insert into external_org_bindings(id,org_id,external_tier,site_url,secret_ref,config,activated_at,status) values ('21951002-0000-0000-0000-000000000003','21951002-0000-0000-0000-000000000001','erpnext','https://example.test','test','{}',now(),'active');
insert into erp_purchase_documents(id,org_id,erp_doctype,erp_name,supplier,erp_docstatus,erp_modified) values ('21951002-0000-0000-0000-000000000004','21951002-0000-0000-0000-000000000001','Purchase Invoice','RACE','R',1,'1');
$setup$);
create function pg_temp.race_claim(p_request text) returns text language sql as $$
 select format($q$select public.capture_assignment_claim('21951002-0000-0000-0000-000000000001','21951002-0000-0000-0000-000000000003','21951002-0000-0000-0000-000000000002','{"request_id":"%s","source_id":"21951002-0000-0000-0000-000000000004","decision":"set_aside"}','revision',false)->>'outcome'$q$,p_request) $$;
select dblink_exec('asg_race','begin');
select * from dblink('asg_race',pg_temp.race_claim('21951002-0000-0000-0000-000000000011')) as t(outcome text);
set local lock_timeout='300ms';
select throws_ok(pg_temp.race_claim('21951002-0000-0000-0000-000000000012'),'55P03',null,'AC-ROP-008 a competing request waits for the source lock');
set local lock_timeout=0;
select dblink_exec('asg_race','commit');
select is((select outcome from dblink('asg_race',pg_temp.race_claim('21951002-0000-0000-0000-000000000012')) as t(outcome text)),'refused','AC-ROP-008 the loser is refused once the winner has committed');
select is((select count(*)::int from public.erp_capture_invoice_assignments where source_document_id='21951002-0000-0000-0000-000000000004' and undone_at is null),1,'AC-ROP-008 two competing requests for one source yield exactly one active decision');
select dblink_exec('asg_race',$cleanup$
delete from erp_capture_invoice_assignments where org_id='21951002-0000-0000-0000-000000000001';
delete from erp_purchase_documents where org_id='21951002-0000-0000-0000-000000000001';
delete from external_org_bindings where org_id='21951002-0000-0000-0000-000000000001';
delete from profiles where org_id='21951002-0000-0000-0000-000000000001';
delete from auth.users where id='21951002-0000-0000-0000-000000000002';
delete from organizations where id='21951002-0000-0000-0000-000000000001';
$cleanup$);
select dblink_disconnect('asg_race');
select * from finish();
rollback;
