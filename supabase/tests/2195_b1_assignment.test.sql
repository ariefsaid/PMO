-- #2195 B1 round 1: who may decide an invoice placement, what a decision persists, and how a decision is claimed once.
-- The applied path of the public RPC is not built yet (source validation, wrapper and mark arrive in round 2); the
-- claim helper it will call is exercised directly. The race section uses committed fixtures in a second session.
begin;
select plan(59);
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
select is(pg_temp.preview(current_setting('b1.row')::jsonb),'preview','AC-ROP-005 only active Admin decides: active Admin previews');
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
select throws_ok($$select public.assign_capture_invoices(jsonb_build_array(current_setting('b1.row')::jsonb),'revision',false)$$,'0A000','assignment_effects_not_available','AC-ROP-005 apply is unavailable at this step');
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
