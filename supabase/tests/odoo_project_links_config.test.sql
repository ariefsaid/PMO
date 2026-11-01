-- #1504 S6-T6/T7 (migration 0486): a PMO project links to one Odoo cost account (an analytic account of the chosen plan),
-- without the Project app. AC-ODC-050 (who may link, one account per project, one project per account), AC-ODC-053
-- (un-link is audited and refused through the one shared in-use check), the analytic-plan choice, and the setup accept /
-- unlink paths for tier odoo (ECA-2's accept, decide and unlink reach the same writer).
begin;
select plan(60);

insert into organizations (id, name) values
 ('a6050000-0000-0000-0000-000000000001','Odoo Links A'),
 ('a6050000-0000-0000-0000-000000000002','Odoo Links B');
insert into auth.users (id, email) values
 ('a6050000-0000-0000-0000-0000000000a1','a605-admin@example.com'),
 ('a6050000-0000-0000-0000-0000000000f1','a605-finance@example.com'),
 ('a6050000-0000-0000-0000-0000000000a2','a605-pm1@example.com'),
 ('a6050000-0000-0000-0000-0000000000a3','a605-pm2@example.com'),
 ('a6050000-0000-0000-0000-0000000000e1','a605-eng@example.com'),
 ('a6050000-0000-0000-0000-0000000000b1','a605-b-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
 ('a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-000000000001','Admin','a605-admin@example.com','Admin','active'),
 ('a6050000-0000-0000-0000-0000000000f1','a6050000-0000-0000-0000-000000000001','Finance','a605-finance@example.com','Finance','active'),
 ('a6050000-0000-0000-0000-0000000000a2','a6050000-0000-0000-0000-000000000001','PM One','a605-pm1@example.com','Project Manager','active'),
 ('a6050000-0000-0000-0000-0000000000a3','a6050000-0000-0000-0000-000000000001','PM Two','a605-pm2@example.com','Project Manager','active'),
 ('a6050000-0000-0000-0000-0000000000e1','a6050000-0000-0000-0000-000000000001','Engineer','a605-eng@example.com','Engineer','active'),
 ('a6050000-0000-0000-0000-0000000000b1','a6050000-0000-0000-0000-000000000002','B Admin','a605-b-admin@example.com','Admin','active');
insert into external_org_bindings (org_id, external_tier, site_url, secret_ref, status, config, activated_at) values
 ('a6050000-0000-0000-0000-000000000001','odoo','https://odoo.example.test','a605_a','active','{"database":"db1","odoo_company_id":1,"analytic_plan_id":7}', now()),
 ('a6050000-0000-0000-0000-000000000002','odoo','https://odoo.example.test','a605_b','active','{"database":"db1","odoo_company_id":1,"analytic_plan_id":7}', now());
insert into projects (id, org_id, name, status, project_manager_id) values
 ('a6050000-0000-0000-0000-0000000000c1','a6050000-0000-0000-0000-000000000001','Bridge One','Ongoing Project','a6050000-0000-0000-0000-0000000000a2'),
 ('a6050000-0000-0000-0000-0000000000c2','a6050000-0000-0000-0000-000000000001','Bridge Two','Ongoing Project','a6050000-0000-0000-0000-0000000000a3'),
 ('a6050000-0000-0000-0000-0000000000c3','a6050000-0000-0000-0000-000000000001','Bridge Three','Ongoing Project','a6050000-0000-0000-0000-0000000000a3'),
 ('a6050000-0000-0000-0000-0000000000cb','a6050000-0000-0000-0000-000000000002','B Project','Ongoing Project',null);
insert into external_master_records (org_id, external_tier, kind, external_id, name, code, parent_external_id, active, tombstoned_at, source_write_date) values
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_plan','7','Projects',null,null,true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_plan','8','Other plan',null,null,true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','101','PRJ-1 Bridge One','PRJ-1','7',true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','102','PRJ-2 Bridge Two','PRJ-2','7',true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','103','Gone','PRJ-3','7',true,now(),'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','104','Archived','PRJ-4','7',false,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','105','Spare','PRJ-5','7',true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000001','odoo','analytic_account','201','Other plan account','X-1','8',true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000002','odoo','analytic_account','301','B account','PRJ-B','7',true,null,'2026-11-01 00:00:00'),
 ('a6050000-0000-0000-0000-000000000002','odoo','analytic_plan','7','Projects',null,null,true,null,'2026-11-01 00:00:00');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- AC-ODC-050 who may link
select isnt(public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c1','101'), null,
  'AC-ODC-050 the Admin links P1 to account 101');
select is((select external_container_id || '|' || (config->>'plan_id') from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c1' and external_tier='odoo'), '101|7',
  'AC-ODC-050 the binding names the account and the plan');
select is((select linked_by from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c1'), 'a6050000-0000-0000-0000-0000000000a1'::uuid, 'the actor is recorded');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a2','a6050000-0000-0000-0000-0000000000c2','102')$$, '42501', null,
  'AC-ODC-050 a PM who does not manage P2 cannot link it');
select isnt(public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a3','a6050000-0000-0000-0000-0000000000c2','102'), null,
  'AC-ODC-050 the PM who manages P2 links it');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000e1','a6050000-0000-0000-0000-0000000000c3','105')$$, '42501', null,
  'an Engineer cannot link');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000f1','a6050000-0000-0000-0000-0000000000c3','105')$$, '42501', null,
  'Finance cannot link a project either (the project''s PM or an Admin does)');

-- one account per project, one project per account
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','101')$$, '23505', null,
  'AC-ODC-050 an account already held by another project is refused');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c1','105')$$, 'P0001', null,
  'AC-ODC-050 a second account on one project is refused');
select is(public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c1','101'),
  (select id from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c1'), 'linking the same pair again returns the same binding');
select is((select count(*)::int from external_project_bindings where org_id='a6050000-0000-0000-0000-000000000001' and external_tier='odoo'), 2, 'two bindings in all');

-- candidates: only the chosen plan's live accounts of THIS org
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','201')$$, 'P0001', 'not a cost account of the chosen plan',
  'AC-ODC-050 an account of another plan is refused');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','103')$$, 'P0001', 'not a cost account of the chosen plan',
  'AC-ODC-050 a tombstoned account is refused');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','104')$$, 'P0001', 'not a cost account of the chosen plan',
  'AC-ODC-050 an archived account is refused');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','301')$$, 'P0001', 'not a cost account of the chosen plan',
  'NFR-ODC-002 another organisation''s account id is not a candidate');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000b1','a6050000-0000-0000-0000-0000000000c1','301')$$, '42501', null,
  'NFR-ODC-002 an Admin of another organisation cannot link this organisation''s project');
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000b1','a6050000-0000-0000-0000-0000000000c3','105')$$, '42501', null,
  'NFR-ODC-002 an actor outside the organisation is refused');

-- the holder is named by project number only
reset role;
update projects set pmo_project_number = 'PRJ-26-0001' where id = 'a6050000-0000-0000-0000-0000000000c1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c3','101')$$, '23505', 'cost account already linked to PRJ-26-0001',
  'FR-ODC-070 the holder is named by project number, not by its name');

-- the audit trail
select is((select count(*)::int from audit_events where action='integration.odoo.link' and org_id='a6050000-0000-0000-0000-000000000001'), 2, 'each new link leaves one audit row (the repeat does not)');

-- activation gate
reset role;
update external_org_bindings set activated_at = null where org_id='a6050000-0000-0000-0000-000000000002';
set local role service_role;
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000b1','a6050000-0000-0000-0000-0000000000cb','301')$$, 'P0001', null,
  'a connection that is not activated links nothing');

-- the analytic plan: chosen by an Admin from the mirror, not changeable while projects are linked
reset role;
update external_org_bindings set activated_at = now() where org_id='a6050000-0000-0000-0000-000000000002';
update external_org_bindings set config = config - 'analytic_plan_id' where org_id='a6050000-0000-0000-0000-000000000002';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.link_odoo_cost_account('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000b1','a6050000-0000-0000-0000-0000000000cb','301')$$, 'P0001', 'choose the analytic plan first',
  'with no plan chosen nothing is a candidate');
select throws_ok($$select public.set_odoo_analytic_plan('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000a1','7')$$, '42501', null, 'an Admin of another organisation cannot choose this organisation''s plan');
select throws_ok($$select public.set_odoo_analytic_plan('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000b1','999')$$, 'P0001', 'not an analytic plan of this connection',
  'a plan Odoo did not report is refused');
select lives_ok($$select public.set_odoo_analytic_plan('a6050000-0000-0000-0000-000000000002','a6050000-0000-0000-0000-0000000000b1','7')$$, 'the Admin chooses the plan from the mirror');
select is((select config->>'analytic_plan_id' from external_org_bindings where org_id='a6050000-0000-0000-0000-000000000002' and external_tier='odoo'), '7', 'the plan id is stored');
select is((select jsonb_typeof(config->'analytic_plan_id') from external_org_bindings where org_id='a6050000-0000-0000-0000-000000000002' and external_tier='odoo'), 'number', 'as a number, the shape the adapter reads');
select throws_ok($$select public.set_odoo_analytic_plan('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','8')$$, 'P0001', 'unlink the projects before changing the plan',
  'the plan cannot change while projects are linked to its accounts');
select throws_ok($$select public.set_odoo_analytic_plan('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000e1','7')$$, '42501', null, 'an Engineer cannot choose the plan');

-- AC-ODC-053 un-link
select throws_ok($$select public.unlink_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a2','a6050000-0000-0000-0000-0000000000c2')$$, '42501', null,
  'a PM who does not manage the project cannot un-link it');
select lives_ok($$select public.unlink_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a3','a6050000-0000-0000-0000-0000000000c2')$$,
  'AC-ODC-053 the managing PM un-links; in O1 nothing references the link');
select is((select count(*)::int from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c2'), 0, 'AC-ODC-053 the binding is gone');
select is((select count(*)::int from audit_events where action='integration.odoo.unlink' and entity_id='a6050000-0000-0000-0000-0000000000c2'), 1, 'AC-ODC-053 the un-link is audited');
select lives_ok($$select public.unlink_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a3','a6050000-0000-0000-0000-0000000000c2')$$, 'un-linking an unlinked project is a no-op');
select is((select count(*)::int from audit_events where action='integration.odoo.unlink'), 1, 'and leaves no second audit row');

-- the one shared in-use check (FR-ODC-073): a project with a pushed native invoice cannot be un-linked
reset role;
insert into sales_invoices (id, org_id, project_id, customer_id, amount, tax_treatment, tax_amount, currency, status, pmo_native, native_lines) values
 ('a6050000-0000-0000-0000-0000000000f4','a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000c1',
  (select id from companies limit 1),1,'exclusive',0,'IDR','Draft', true, '[{"item_code":"SVC","description":null,"qty":1,"rate":1,"amount":1.00}]');
insert into external_refs (org_id, domain, pmo_record_id, external_tier, external_record_id) values
 ('a6050000-0000-0000-0000-000000000001','revenue','a6050000-0000-0000-0000-0000000000f4','odoo','INV-1');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.unlink_odoo_cost_account('a6050000-0000-0000-0000-000000000001','a6050000-0000-0000-0000-0000000000a1','a6050000-0000-0000-0000-0000000000c1')$$, 'P0001', 'project link is in use',
  'AC-ODC-053 a project with an ERP document reference cannot be un-linked (the shared check)');
select is((select count(*)::int from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c1'), 1, 'and its link stays');

-- grants: service role only
reset role;
select is(has_function_privilege('authenticated', f, 'execute'), false, f || ' is not executable by authenticated')
  from unnest(array['public.link_odoo_cost_account(uuid,uuid,uuid,text)', 'public.unlink_odoo_cost_account(uuid,uuid,uuid)', 'public.set_odoo_analytic_plan(uuid,uuid,text)']) f;
select is(has_function_privilege('anon', f, 'execute'), false, f || ' is not executable by anon')
  from unnest(array['public.link_odoo_cost_account(uuid,uuid,uuid,text)', 'public.unlink_odoo_cost_account(uuid,uuid,uuid)', 'public.set_odoo_analytic_plan(uuid,uuid,text)']) f;
select is(has_function_privilege('service_role', f, 'execute'), true, f || ' is executable by service_role')
  from unnest(array['public.link_odoo_cost_account(uuid,uuid,uuid,text)', 'public.unlink_odoo_cost_account(uuid,uuid,uuid)', 'public.set_odoo_analytic_plan(uuid,uuid,text)']) f;
select is(has_function_privilege(r, 'public.connect_link_odoo_project(uuid,text,text,uuid)', 'execute'), false, 'the internal writer is executable by nobody: ' || r)
  from unnest(array['anon','authenticated','service_role']) r;

-- the setup paths for tier odoo: accept, decide and unlink reach the same writer (ECA-2's verbs, no second link store)
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select set_config('a605.run', public.start_connect_run('a6050000-0000-0000-0000-000000000001','odoo','a6050000-0000-0000-0000-0000000000a1')::text, true);
select public.replace_connect_proposals('a6050000-0000-0000-0000-000000000001','odoo',current_setting('a605.run')::uuid,'project','[
  {"outcome":"link","pmoIds":["a6050000-0000-0000-0000-0000000000c3"],"externalIds":["105"],"key":"code","snapshot":{}},
  {"outcome":"link","pmoIds":["a6050000-0000-0000-0000-0000000000c2"],"externalIds":["101"],"key":"code","snapshot":{}},
  {"outcome":"link","pmoIds":["a6050000-0000-0000-0000-0000000000c2"],"externalIds":["201"],"key":"name","snapshot":{}}]'::jsonb, true);
select public.record_connect_review('a6050000-0000-0000-0000-000000000001','odoo','project',
  array['a6050000-0000-0000-0000-0000000000c2'], array['102','105'], 'ambiguous', 'Two or more records could be this one');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6050000-0000-0000-0000-0000000000f1","role":"authenticated"}';
select throws_ok($$select public.accept_connect_proposals('odoo','project')$$, '42501', null, 'Finance cannot accept project links');
set local request.jwt.claims = '{"sub":"a6050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select set_config('a605.accept', public.accept_connect_proposals('odoo','project')::text, true);
select is((current_setting('a605.accept')::jsonb)#>>'{counts,project,link}', '1', 'AC-ECA-004 accept links the one clean project to its cost account');
select is((current_setting('a605.accept')::jsonb)#>>'{counts,project,left_open}', '2', 'the held account and the other plan''s account stay open with a reason');
reset role;
select is((select external_container_id || '|' || linked_by::text from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c3' and external_tier='odoo'),
  '105|a6050000-0000-0000-0000-0000000000a1', 'AC-ODC-050 the accepted link is the Odoo binding, stamped with the accepting Admin');
select is((select count(*)::int from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c2'), 0, 'the refused rows linked nothing');
select is((select count(*)::int from erp_connect_proposals where external_tier='odoo' and kind='project' and state='open' and outcome='link' and reason_text is not null), 2, 'and say why in plain words');
select is((select count(*)::int from jsonb_object_keys((select config from external_org_bindings where org_id='a6050000-0000-0000-0000-000000000001' and external_tier='odoo')) k where k='project_map'), 0,
  'no ERPNext-style project map is written for Odoo');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.decide_connect_review((select id from erp_connect_proposals where external_tier='odoo' and outcome='review'), '{"action":"link","pmoId":"a6050000-0000-0000-0000-0000000000c2","externalId":"102"}'::jsonb)$$,
  'an Admin decides a review row: link the project to the account they chose');
reset role;
select is((select external_container_id from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c2' and external_tier='odoo'), '102', 'the decided link is the Odoo binding');
set local role authenticated;
set local request.jwt.claims = '{"sub":"a6050000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.unlink_connect_match((select id from erp_connect_proposals where external_tier='odoo' and outcome='link' and state='applied' and pmo_ids='{a6050000-0000-0000-0000-0000000000c3}'))$$,
  'AC-ECA-007 an Admin undoes an accepted project link');
reset role;
select is((select count(*)::int from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c3'), 0, 'AC-ECA-007 the Odoo binding is gone');
select is((select count(*)::int from external_project_bindings where project_id='a6050000-0000-0000-0000-0000000000c1'), 1, 'and the project in use keeps its link');

select * from finish();
rollback;
