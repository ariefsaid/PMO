-- #2195 B1 round 1: who may decide an invoice placement, what a decision persists, and how a decision is claimed once.
-- The applied path of the public RPC is not built yet (source validation, wrapper and mark arrive in round 2).
begin;
select plan(28);
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
reset role;
update profiles set status='active' where id='21951001-0000-0000-0000-000000000003';
update auth.users set banned_until=now()+interval '1 day' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 banned Admin refused');
reset role;
update auth.users set banned_until=null where id='21951001-0000-0000-0000-000000000003';
update profiles set role='Executive' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Executive refused');
reset role;
update profiles set role='Project Manager' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Project Manager refused');
reset role;
update profiles set role='Finance' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Finance refused');
reset role;
update profiles set role='Engineer' where id='21951001-0000-0000-0000-000000000003';
set local role authenticated;
select alike(pg_temp.preview(current_setting('b1.row')::jsonb),'42501:%','AC-ROP-005 Engineer refused');
reset role;
update profiles set role='Admin' where id='21951001-0000-0000-0000-000000000003';
set local role anon;
select throws_ok($$select public.assign_capture_invoices('[]','revision',true)$$,'42501',null,'AC-ROP-005 anonymous preview refused');
select throws_ok($$insert into public.erp_capture_invoice_assignments default values$$,'42501',null,'AC-ROP-005 anonymous cannot insert directly');
reset role;
select ok(has_function_privilege('authenticated','public.assign_capture_invoices(jsonb,text,boolean)','execute') and not has_function_privilege('anon','public.assign_capture_invoices(jsonb,text,boolean)','execute'),'AC-ROP-005 only signed-in callers may execute the RPC');
select is((select count(*)::int from public.erp_capture_invoice_assignments)+(select count(*)::int from public.erp_purchase_document_marks where org_id='21951001-0000-0000-0000-000000000001'),0,'AC-ROP-005 preview writes no decision and no mark');
select is((select count(*)::int from public.procurements where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.procurement_erp_links where org_id='21951001-0000-0000-0000-000000000001')+(select count(*)::int from public.audit_events where org_id='21951001-0000-0000-0000-000000000001' and (action ~* 'assign|invoice|capture|purchase|procurement|erp' or entity_type ~* 'assign|invoice|capture|purchase|procurement'))+(select count(*)::int from public.external_command_outbox where org_id='21951001-0000-0000-0000-000000000001'),0,'AC-ROP-005 preview writes no wrapper link audit or outbox');

select * from finish();
rollback;
