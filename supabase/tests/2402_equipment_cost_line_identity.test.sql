-- 1390_issue_tasks_root_cause.test.sql — #2677 (docs/specs/issue-tasks-root-cause.spec.md).
-- Migrations under test: 1390_incident_tasks, 1391_incident_root_cause, 1392_add_task_to_incident.
-- AC-ITR-001 several tasks · 002 who may add · 003 no client write · 004 legacy link mirrored · 005 reads · 006 root cause · 007 independence.
-- Fixtures are written as the table owner; every client check runs as `authenticated` with a JWT.
begin;
create extension if not exists pgtap;
select plan(4);

insert into organizations (id, name, default_currency) values
  ('26770000-0000-0000-0000-00000000000a', 'ITR Org',   'IDR'),
  ('26770000-0000-0000-0000-00000000000b', 'ITR Other', 'IDR'),
  ('26770000-0000-0000-0000-00000000000c', 'ITR Off',   'IDR');
insert into auth.users (id, email) values
  ('26770000-0000-0000-0000-0000000000a1', 'itr-admin@example.com'),
  ('26770000-0000-0000-0000-0000000000a3', 'itr-pm@example.com'),
  ('26770000-0000-0000-0000-0000000000a4', 'itr-reporter@example.com'),
  ('26770000-0000-0000-0000-0000000000a5', 'itr-assignee@example.com'),
  ('26770000-0000-0000-0000-0000000000a6', 'itr-gone@example.com'),
  ('26770000-0000-0000-0000-0000000000b1', 'itr-xorg@example.com'),
  ('26770000-0000-0000-0000-0000000000c1', 'itr-off@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26770000-0000-0000-0000-0000000000a1', '26770000-0000-0000-0000-00000000000a', 'ITR Admin',    'itr-admin@example.com',    'Admin', 'active'),
  ('26770000-0000-0000-0000-0000000000a3', '26770000-0000-0000-0000-00000000000a', 'ITR PM',       'itr-pm@example.com',       'Project Manager', 'active'),
  ('26770000-0000-0000-0000-0000000000a4', '26770000-0000-0000-0000-00000000000a', 'ITR Reporter', 'itr-reporter@example.com', 'Engineer', 'active'),
  ('26770000-0000-0000-0000-0000000000a5', '26770000-0000-0000-0000-00000000000a', 'ITR Assignee', 'itr-assignee@example.com', 'Engineer', 'active'),
  ('26770000-0000-0000-0000-0000000000a6', '26770000-0000-0000-0000-00000000000a', 'ITR Gone',     'itr-gone@example.com',     'Engineer', 'disabled'),
  ('26770000-0000-0000-0000-0000000000b1', '26770000-0000-0000-0000-00000000000b', 'ITR XOrg',     'itr-xorg@example.com',     'Admin', 'active'),
  ('26770000-0000-0000-0000-0000000000c1', '26770000-0000-0000-0000-00000000000c', 'ITR Off',      'itr-off@example.com',      'Admin', 'active');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('26770000-0000-0000-0000-0000000000d1', '26770000-0000-0000-0000-00000000000a', 'ITR Site',  'Ongoing Project', '26770000-0000-0000-0000-0000000000a3'),
  ('26770000-0000-0000-0000-0000000000dc', '26770000-0000-0000-0000-00000000000c', 'ITR Off Site', 'Ongoing Project', null);
insert into org_features (org_id, feature_key, enabled) values ('26770000-0000-0000-0000-00000000000c', 'incidents', false);


insert into work_orders(id,org_id,project_id,title,status,order_value,tax_treatment,tax_amount)
values('26770000-0000-0000-0000-000000000e01','26770000-0000-0000-0000-00000000000a','26770000-0000-0000-0000-0000000000d1','Resource work','Draft',1000,'exclusive',0);
insert into equipment_assets(id,org_id,code,name,default_unit)
values('26770000-0000-0000-0000-000000000e02','26770000-0000-0000-0000-00000000000a','CR-1','Site crane','days');
insert into equipment_usage_entries(id,org_id,asset_id,project_id,work_order_id,author_id,work_date,quantity,unit,kind,status)
values('26770000-0000-0000-0000-000000000e03','26770000-0000-0000-0000-00000000000a','26770000-0000-0000-0000-000000000e02','26770000-0000-0000-0000-0000000000d1','26770000-0000-0000-0000-000000000e01','26770000-0000-0000-0000-0000000000a4',current_date,1,'days','work','Draft');
set local role authenticated;
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select reference from work_order_cost_lines where record_id='26770000-0000-0000-0000-000000000e03'),'CR-1 · Site crane','JOB-PC9 own equipment usage names the asset');
select is((select quantity from work_order_cost_lines where record_id='26770000-0000-0000-0000-000000000e03'),1::numeric,'JOB-PC9 equipment quantity remains visible');
set local request.jwt.claims = '{"sub":"26770000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select is((select count(*) from work_order_cost_lines where record_id='26770000-0000-0000-0000-000000000e03'),0::bigint,'JOB-PC9 source row access is unchanged for a same-level non-author');
reset role;
select ok((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.work_order_cost_lines'::regclass),'JOB-PC9 source and asset RLS remain the authority');
select * from finish();
rollback;
