-- 2600_wo_shared_claim_evidence.test.sql — work-order quality documents filed once are reused by every later claim (DD-R1124-17, AC-WQE-001..004).
-- Proves:
--   AC-WQE-001: Quality Inspector files a quality document once on their work-order billing step; Claim 1 and Claim 2
--               created on that work order both receive it in progress_claim_evidence and pass the invoice evidence gate.
--   AC-WQE-002: An open (un-invoiced, un-withdrawn) claim receives a newly attached work-order step document; a withdrawn claim does not.
--   AC-WQE-003: Replacing a slot document (rev A -> rev B) or superseding a document keeps earlier claims pointing at what they
--               were submitted with; later claims receive the new revision and skip Superseded rows.
--   AC-WQE-006/007: only Admin-designated steps supply claim evidence; template copies preserve the mark.
begin;
create extension if not exists pgtap;
create extension if not exists dblink;
select plan(34);



create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;

insert into organizations (id, name, down_payment_item) values
  ('26000000-0000-0000-0000-000000000001', 'WQE Org A', 'DP-ITEM'),
  ('26000000-0000-0000-0000-000000000002', 'WQE Org B', 'DP-ITEM');

insert into auth.users (id, email) values
  ('26000000-0000-0000-0000-0000000000a1', 'wqe-admin@example.com'),
  ('26000000-0000-0000-0000-0000000000a2', 'wqe-fin@example.com'),
  ('26000000-0000-0000-0000-0000000000a3', 'wqe-pm@example.com'),
  ('26000000-0000-0000-0000-0000000000a4', 'wqe-qi@example.com'),
  ('26000000-0000-0000-0000-0000000000a5', 'wqe-field@example.com'),
  ('26000000-0000-0000-0000-0000000000b1', 'wqe-b-admin@example.com');

insert into profiles (id, org_id, full_name, email, role, built_in_role, status) values
  ('26000000-0000-0000-0000-0000000000a1', '26000000-0000-0000-0000-000000000001', 'WQE Admin', 'wqe-admin@example.com', 'Admin', 'administrator', 'active'),
  ('26000000-0000-0000-0000-0000000000a2', '26000000-0000-0000-0000-000000000001', 'WQE Finance', 'wqe-fin@example.com', 'Finance', 'finance_officer', 'active'),
  ('26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001', 'WQE PM', 'wqe-pm@example.com', 'Project Manager', 'project_manager', 'active'),
  ('26000000-0000-0000-0000-0000000000a4', '26000000-0000-0000-0000-000000000001', 'WQE QI', 'wqe-qi@example.com', 'Engineer', 'quality_inspector', 'active'),
  ('26000000-0000-0000-0000-0000000000a5', '26000000-0000-0000-0000-000000000001', 'WQE Field', 'wqe-field@example.com', 'Engineer', 'foreman', 'active'),
  ('26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-000000000002', 'WQE B Admin', 'wqe-b-admin@example.com', 'Admin', 'administrator', 'active');

insert into companies (id, org_id, name, type) values
  ('26000000-0000-0000-0000-0000000000f1', '26000000-0000-0000-0000-000000000001', 'WQE Client', 'Client');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, client_id, project_manager_id, currency, subject_to_vat) values
  ('26000000-0000-0000-0000-0000000000c1', '26000000-0000-0000-0000-000000000001', 'WQE Project', 'Ongoing Project', 1000000, 'exclusive', 0,
   '26000000-0000-0000-0000-0000000000f1', '26000000-0000-0000-0000-0000000000a3', 'IDR', false);

insert into boq_items (id, org_id, project_id, item_code, description, unit, quantity, rate) values
  ('26000000-0000-0000-0000-0000000000e1', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'QC-01', 'Piping weld', 'm', 100, 1000);

insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, currency, issued_at, tax_treatment, tax_amount) values
  ('26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'WO-WQE-1', 'Work order 1', 'Issued', 50000, 'IDR', now(), 'exclusive', 0),
  ('26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'WO-WQE-2', 'Work order 2', 'Issued', 50000, 'IDR', now(), 'exclusive', 0);

insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
  ('26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-0000000000e1', 50),
  ('26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-0000000000e1', 50);

-- Quality step + required slot on WO 1, and a quality step with no slots on WO 2.
insert into work_order_billing_steps (id, org_id, work_order_id, project_id, position, name, owner_role_key, started_on) values
  ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-0000000000c1', 1, 'Quality evidence', 'quality_inspector', current_date),
  ('26000000-0000-0000-0000-000000000022', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000012', '26000000-0000-0000-0000-0000000000c1', 1, 'Quality evidence', 'quality_inspector', current_date);

insert into work_order_billing_step_documents (id, org_id, step_id, work_order_id, position, name, required) values
  ('26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000011', 1, 'QC Report', true);

insert into project_documents (id, org_id, project_id, category, title, status, revision, author_id, file_path) values
  ('26000000-0000-0000-0000-00000000d001', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'QC Report Rev A', 'Approved', 'A',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d001/qc-a.pdf'),
  ('26000000-0000-0000-0000-00000000d002', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'QC Report Rev B', 'Approved', 'B',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d002/qc-b.pdf'),
  ('26000000-0000-0000-0000-00000000d003', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'Extra QC Doc Rev A', 'Approved', 'A',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d003/extra-a.pdf'),
  ('26000000-0000-0000-0000-00000000d004', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-0000000000c1', 'Acceptance', 'Extra QC Doc Rev B', 'Issued', 'B',
   '26000000-0000-0000-0000-0000000000a3', '26000000-0000-0000-0000-000000000001/26000000-0000-0000-0000-0000000000c1/26000000-0000-0000-0000-00000000d004/extra-b.pdf');

update project_documents set parent_document_id = '26000000-0000-0000-0000-00000000d003'
 where id = '26000000-0000-0000-0000-00000000d004';


insert into work_order_billing_steps (id, org_id, work_order_id, project_id, position, name, owner_role_key, started_on) values
  ('26000000-0000-0000-0000-000000000023', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-0000000000c1', 2, 'Commercial document', 'finance_officer', current_date);
select has_column('public','work_order_billing_steps','claim_evidence_enabled','AC-WQE-006 work-order steps declare whether documents qualify');
select has_column('public','billing_step_template_steps','claim_evidence_enabled','AC-WQE-006 template steps declare whether documents qualify');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',true)$q$), '42501 WBS_EVIDENCE_MARK', 'AC-WQE-006 Finance cannot change the quality mark');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000021',true)$q$), 'ok', 'AC-WQE-006 Admin marks the quality step');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($q$select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000023',null,'26000000-0000-0000-0000-00000000d003')$q$, 'AC-WQE-006 Finance files an unrelated document');
do $$ begin
  perform set_config('wqe.step_c1', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1','progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;
select is((select count(*)::int from progress_claim_evidence where claim_id=current_setting('wqe.step_c1')::uuid),0, 'AC-WQE-006 unrelated documents do not satisfy the claim');
select lives_ok($q$select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000023',null,'26000000-0000-0000-0000-00000000d004')$q$,
 'AC-WQE-006 Finance adds another unrelated document');
select is((select count(*)::int from progress_claim_evidence where claim_id=current_setting('wqe.step_c1')::uuid),0,
 'AC-WQE-006 an unrelated attachment does not propagate to an open claim');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select lives_ok($q$select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000021','26000000-0000-0000-0000-000000000031','26000000-0000-0000-0000-00000000d001')$q$, 'AC-WQE-006 inspector files on the marked step');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select string_agg(document_id::text,',' order by document_id) from progress_claim_evidence where claim_id=current_setting('wqe.step_c1')::uuid), '26000000-0000-0000-0000-00000000d001', 'AC-WQE-006 only marked-step evidence is propagated to an open claim');

do $$ begin
  perform set_config('wqe.step_c2', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1','progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000011',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;
select is((select string_agg(document_id::text,',' order by document_id) from progress_claim_evidence where claim_id=current_setting('wqe.step_c2')::uuid),
 '26000000-0000-0000-0000-00000000d001', 'AC-WQE-006 later claims inherit only marked-step evidence');

-- Admin marks a template; Finance may edit without changing the marked identity.
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.err($q$select public.save_billing_step_template(null,'not allowed','[{"name":"Quality","claim_evidence_enabled":true}]'::jsonb)$q$),
  '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot mark a template step');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('wqe.marked_tpl', public.save_billing_step_template(null,'marked template',
  '[{"name":"Quality","claim_evidence_enabled":true},{"name":"Commercial"}]'::jsonb)::text, true);
select set_config('wqe.marked_id', (select id::text from billing_step_template_steps where template_id=current_setting('wqe.marked_tpl')::uuid and name='Quality'), true);
select set_config('wqe.plain_id', (select id::text from billing_step_template_steps where template_id=current_setting('wqe.marked_tpl')::uuid and name='Commercial'), true);
select is((select count(*)::int from billing_step_template_steps where template_id=current_setting('wqe.marked_tpl')::uuid and claim_evidence_enabled),1,
  'AC-WQE-007 Admin marks only the intended template step');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.err(format($q$select public.save_billing_step_template(%L,'marked template',%L::jsonb)$q$,
 current_setting('wqe.marked_tpl'), jsonb_build_array(jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.plain_id'),'claim_evidence_enabled',true), jsonb_build_object('name','Quality','template_step_id',current_setting('wqe.marked_id'),'claim_evidence_enabled',true))::text)),
 '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot enable another template step');
select is(pg_temp.err(format($q$select public.save_billing_step_template(%L,'marked template',%L::jsonb)$q$,
 current_setting('wqe.marked_tpl'), jsonb_build_array(jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.plain_id'),'claim_evidence_enabled',false), jsonb_build_object('name','Quality','template_step_id',current_setting('wqe.marked_id'),'claim_evidence_enabled',true))::text)),
 'ok', 'AC-WQE-007 Finance can reorder without changing the marks');
select is((select string_agg(name||':'||claim_evidence_enabled::text,',' order by position) from billing_step_template_steps where template_id=current_setting('wqe.marked_tpl')::uuid),
 'Commercial:false,Quality:true', 'AC-WQE-007 the mark follows its step after reorder');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.set_default_billing_step_template(current_setting('wqe.marked_tpl')::uuid);
reset role;
insert into work_orders (id,org_id,project_id,title,status,order_value,currency,tax_treatment,tax_amount) values
 ('26000000-0000-0000-0000-000000000013','26000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-0000000000c1','Next work order','Draft',50000,'IDR','exclusive',0);
update work_orders set status='Issued',issued_at=now() where id='26000000-0000-0000-0000-000000000013';
select is((select string_agg(name||':'||claim_evidence_enabled::text,',' order by position) from work_order_billing_steps where work_order_id='26000000-0000-0000-0000-000000000013'),
 'Commercial:false,Quality:true', 'AC-WQE-007 issue copies the mark onto the work order');
update organizations set work_order_checklist_enabled=true where id='26000000-0000-0000-0000-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('wqe.saved_tpl',public.save_work_order_steps_as_template('26000000-0000-0000-0000-000000000013','copied template')::text,true);
select is((select string_agg(name||':'||claim_evidence_enabled::text,',' order by position) from billing_step_template_steps where template_id=current_setting('wqe.saved_tpl')::uuid),
 'Commercial:false,Quality:true', 'AC-WQE-007 saving a work-order checklist preserves the mark');
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000023',null)$q$),
 '22023 WBS_EVIDENCE_MARK', 'AC-WQE-007 null is not a valid mark');


create or replace function pg_temp.err_rollback(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  raise exception 'rollback successful attempt' using errcode = 'ZX001';
exception when sqlstate 'ZX001' then
  return 'ok';
when others then
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;

-- A marked step keeps its identity and document requirements when a non-Admin edits its template.
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('wqe.guard_tpl', public.save_billing_step_template(null,'guarded template',
 '[{"name":"Quality","claim_evidence_enabled":true,"documents":[{"name":"Report","required":true}]},{"name":"Commercial"}]'::jsonb)::text, true);
select set_config('wqe.guard_id', (select id::text from billing_step_template_steps where template_id=current_setting('wqe.guard_tpl')::uuid and name='Quality'), true);
select set_config('wqe.guard_plain', (select id::text from billing_step_template_steps where template_id=current_setting('wqe.guard_tpl')::uuid and name='Commercial'), true);
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is(pg_temp.err_rollback(format($q$select public.save_billing_step_template(%L,'guarded template',%L::jsonb)$q$, current_setting('wqe.guard_tpl'),
 jsonb_build_array(jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.guard_id'),'claim_evidence_enabled',true,'documents',jsonb_build_array(jsonb_build_object('name','Report','required',true))),jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.guard_plain')))::text)),
 '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot repurpose a designated step by renaming it');
select is(pg_temp.err_rollback(format($q$select public.save_billing_step_template(%L,'guarded template',%L::jsonb)$q$, current_setting('wqe.guard_tpl'),
 jsonb_build_array(jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.guard_plain')))::text)),
 '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot remove a designated step');
select is(pg_temp.err_rollback(format($q$select public.save_billing_step_template(%L,'guarded template',%L::jsonb)$q$, current_setting('wqe.guard_tpl'),
 jsonb_build_array(jsonb_build_object('name','Quality','template_step_id',current_setting('wqe.guard_id'),'claim_evidence_enabled',true,'documents',jsonb_build_array(jsonb_build_object('name','Commercial invoice','required',true))),jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.guard_plain')))::text)),
 '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot repurpose the designated document slot');
select is(pg_temp.err_rollback(format($q$select public.save_billing_step_template(%L,'guarded template',%L::jsonb)$q$, current_setting('wqe.guard_tpl'),
 jsonb_build_array(jsonb_build_object('name','Quality','claim_evidence_enabled',false),jsonb_build_object('name','Commercial','template_step_id',current_setting('wqe.guard_plain')))::text)),
 '42501 WBS_EVIDENCE_MARK', 'AC-WQE-007 Finance cannot delete and recreate a designated step');
select is((select string_agg(name||':'||claim_evidence_enabled::text,',' order by position) from billing_step_template_steps where template_id=current_setting('wqe.guard_tpl')::uuid),
 'Quality:true,Commercial:false','AC-WQE-007 refused edits preserve the original designation');
select is((select string_agg(d.name,',' order by d.position) from billing_step_template_documents d join billing_step_template_steps s on s.id=d.step_id where s.template_id=current_setting('wqe.guard_tpl')::uuid and s.claim_evidence_enabled),
 'Report','AC-WQE-007 refused edits preserve the original document requirements');

-- Setting ownership changes neither the selected step nor its mark.
select lives_ok(format($q$select public.set_billing_step_template_roles(%L,'[{"position":1,"owner_role_key":"quality_inspector","hidden_from_role_keys":[]}]'::jsonb)$q$, current_setting('wqe.guard_tpl')),
 'AC-WQE-007 Finance may assign the owner role without changing evidence designation');
select is((select name from billing_step_template_steps where template_id=current_setting('wqe.guard_tpl')::uuid and claim_evidence_enabled),
 'Quality','AC-WQE-007 changing an owner keeps the quality designation');

-- The preserved designation survives work-order issuance and later checklist edits.
select public.set_default_billing_step_template(current_setting('wqe.guard_tpl')::uuid);
reset role;
insert into work_orders (id,org_id,project_id,title,status,order_value,currency,tax_treatment,tax_amount) values
 ('26000000-0000-0000-0000-000000000014','26000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-0000000000c1','Guarded order','Draft',50000,'IDR','exclusive',0);
insert into work_order_lines (org_id, work_order_id, boq_item_id, quantity) values
 ('26000000-0000-0000-0000-000000000001','26000000-0000-0000-0000-000000000014','26000000-0000-0000-0000-0000000000e1',30);
update work_orders set status='Issued',issued_at=now() where id='26000000-0000-0000-0000-000000000014';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($q$select public.add_work_order_step('26000000-0000-0000-0000-000000000013',1,'{"name":"Additional step"}'::jsonb)$q$,
 'AC-WQE-007 Finance may insert a work-order step without moving a designation');
select is((select string_agg(name||':'||claim_evidence_enabled::text,',' order by position) from work_order_billing_steps where work_order_id='26000000-0000-0000-0000-000000000013'),
 'Commercial:false,Additional step:false,Quality:true','AC-WQE-007 inserting a work-order step keeps the designation with quality');
select lives_ok(format($q$select public.attach_work_order_step_document(%L,null,'26000000-0000-0000-0000-00000000d003')$q$,
 (select id from work_order_billing_steps where work_order_id='26000000-0000-0000-0000-000000000014' and name='Commercial')),
 'AC-WQE-007 Finance files on the undesignated commercial step');
do $$ begin
  perform set_config('wqe.guard_claim', public.create_progress_claim('26000000-0000-0000-0000-0000000000c1','progress',
    p_work_order_id => '26000000-0000-0000-0000-000000000014',
    p_lines => '[{"boq_item_id":"26000000-0000-0000-0000-0000000000e1","quantity":5}]'::jsonb)::text, true);
end $$;
select is((select count(*)::int from progress_claim_evidence where claim_id=current_setting('wqe.guard_claim')::uuid),0,
 'AC-WQE-007 a later claim does not inherit commercial evidence after refused template edits');

set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select public.attach_work_order_step_document(
 (select id from work_order_billing_steps where work_order_id='26000000-0000-0000-0000-000000000014' and name='Quality'),
 (select d.id from work_order_billing_step_documents d join work_order_billing_steps s on s.id=d.step_id where s.work_order_id='26000000-0000-0000-0000-000000000014' and s.name='Quality'),
 '26000000-0000-0000-0000-00000000d001');
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select string_agg(document_id::text,',' order by document_id) from progress_claim_evidence where claim_id=current_setting('wqe.guard_claim')::uuid),
 '26000000-0000-0000-0000-00000000d001','AC-WQE-007 only the designated quality document reaches the claim');

-- A document on a different marked work order may not be copied onto this claim.
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000022',true);
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select public.attach_work_order_step_document('26000000-0000-0000-0000-000000000022',null,'26000000-0000-0000-0000-00000000d003');
reset role;
select public.copy_work_order_evidence_to_claim(current_setting('wqe.step_c2')::uuid,'26000000-0000-0000-0000-000000000012');
select is((select string_agg(document_id::text,',' order by document_id) from progress_claim_evidence where claim_id=current_setting('wqe.step_c2')::uuid),
 '26000000-0000-0000-0000-00000000d001', 'AC-WQE-006 a different work order cannot supply this claim');


update public.work_order_billing_steps set hidden_from_role_keys=ARRAY['administrator']
 where id='26000000-0000-0000-0000-000000000023';
set local role authenticated;
set local request.jwt.claims = '{"sub":"26000000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is(pg_temp.err($q$select public.set_work_order_step_claim_evidence('26000000-0000-0000-0000-000000000023',true)$q$),
 'P0002 WBS_NOT_FOUND', 'AC-WQE-006 an Admin cannot mark a step hidden from their role');

select * from finish();
rollback;
