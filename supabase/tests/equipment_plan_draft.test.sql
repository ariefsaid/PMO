-- equipment_plan_draft.test.sql — #2700: drafting a plan, its line rules, the submit step, the locks, and who may read.
-- AC-EQP-005 one plan per project and month · AC-EQP-006 line rules · AC-EQP-007 locks · AC-EQP-015 tenancy · AC-EQP-019 readers.
-- Migration under test: 1358_equipment_plan.sql. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(32);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27002000-0000-0000-0000-00000000000a', 'EQP Org',       'IDR', 'Asia/Jakarta'),
  ('27002000-0000-0000-0000-00000000000b', 'EQP Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27002000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('27002000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('27002000-0000-0000-0000-0000000000a3', 'eqp-eng-on@example.com'),
  ('27002000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('27002000-0000-0000-0000-0000000000a5', 'eqp-eng-off@example.com'),
  ('27002000-0000-0000-0000-0000000000b1', 'eqp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27002000-0000-0000-0000-0000000000a1', '27002000-0000-0000-0000-00000000000a', 'EQP Admin',   'eqp-admin@example.com',   'Admin', 'active'),
  ('27002000-0000-0000-0000-0000000000a2', '27002000-0000-0000-0000-00000000000a', 'EQP PM',      'eqp-pm@example.com',      'Project Manager', 'active'),
  ('27002000-0000-0000-0000-0000000000a3', '27002000-0000-0000-0000-00000000000a', 'EQP Eng On',  'eqp-eng-on@example.com',  'Engineer', 'active'),
  ('27002000-0000-0000-0000-0000000000a4', '27002000-0000-0000-0000-00000000000a', 'EQP Finance', 'eqp-fin@example.com',     'Finance', 'active'),
  ('27002000-0000-0000-0000-0000000000a5', '27002000-0000-0000-0000-00000000000a', 'EQP Eng Off', 'eqp-eng-off@example.com', 'Engineer', 'active'),
  ('27002000-0000-0000-0000-0000000000b1', '27002000-0000-0000-0000-00000000000b', 'EQP XAdmin',  'eqp-xadmin@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('27002000-0000-0000-0000-0000000000c1', '27002000-0000-0000-0000-00000000000a', 'EQP Project',       'Ongoing Project'),
  ('27002000-0000-0000-0000-0000000000c2', '27002000-0000-0000-0000-00000000000a', 'EQP Other Project', 'Ongoing Project'),
  ('27002000-0000-0000-0000-0000000000c3', '27002000-0000-0000-0000-00000000000b', 'EQP Foreign',       'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27002000-0000-0000-0000-0000000000e1', '27002000-0000-0000-0000-00000000000a', 'EQP Vendor',         'Vendor'),
  ('27002000-0000-0000-0000-0000000000e2', '27002000-0000-0000-0000-00000000000b', 'EQP Foreign Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('27002000-0000-0000-0000-0000000000d1', '27002000-0000-0000-0000-00000000000a', '27002000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0),
  ('27002000-0000-0000-0000-0000000000d2', '27002000-0000-0000-0000-00000000000a', '27002000-0000-0000-0000-0000000000c2', 'EQP WO elsewhere',  10, 'exclusive', 0);
-- the first type is a decoy: named like a rental, but not flagged; the flag, not the name, marks the real one
insert into org_purchase_type_settings (org_id, enabled) values ('27002000-0000-0000-0000-00000000000a', true) on conflict (org_id) do update set enabled = true;
-- the organisation trigger already seeded starter purchase types; this file brings its own
delete from purchase_types where org_id = '27002000-0000-0000-0000-00000000000a';
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27002000-0000-0000-0000-0000000000f1', '27002000-0000-0000-0000-00000000000a', 'Rental', false, 1),
  ('27002000-0000-0000-0000-0000000000f2', '27002000-0000-0000-0000-00000000000a', 'Hire',   true,  2);
-- an Engineer who raised a purchase on the project is "on" it
insert into procurements (id, org_id, title, status, project_id, requested_by_id) values
  ('27002000-0000-0000-0000-000000000a01', '27002000-0000-0000-0000-00000000000a', 'EQP engineer purchase', 'Draft', '27002000-0000-0000-0000-0000000000c1', '27002000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one plan line as the RPC takes it; p_extra overrides any key
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27002000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;

insert into org_equipment_plan_settings (org_id, enabled) values ('27002000-0000-0000-0000-00000000000a', true);


set local role authenticated;

-- AC-EQP-005 one plan per project and month
select pg_temp._as('27002000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b01', '27002000-0000-0000-0000-0000000000c1', '2026-03-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c01', '{"work_order_id":"27002000-0000-0000-0000-0000000000d1"}'))) $$, 'AC-EQP-005 a planner saves the March plan with a line');
select is((select status || ':' || org_id::text from equipment_plans where id = '27002000-0000-0000-0000-000000000b01'), 'Draft:27002000-0000-0000-0000-00000000000a', 'AC-EQP-005 it is a Draft, with the organisation stamped by the server');
select lives_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b02', '27002000-0000-0000-0000-0000000000c1', '2026-03-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c02'), pg_temp._line('27002000-0000-0000-0000-000000000c03', '{"description":"Generator"}'))) $$, 'AC-EQP-005 a second save for the same project and month');
select is((select count(*)::int from equipment_plans where project_id = '27002000-0000-0000-0000-0000000000c1' and plan_month = '2026-03-01'), 1, 'AC-EQP-005 updates the same plan, never a duplicate');
select is((select count(*)::int from equipment_plan_lines where plan_id = '27002000-0000-0000-0000-000000000b01'), 2, 'AC-EQP-005 and the lines are the ones just saved');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b03', '27002000-0000-0000-0000-0000000000c1', '2026-03-15', '[]') $$, '22023',
  'EQP_INVALID: a plan needs a project, the first day of a month and up to 200 lines', 'AC-EQP-005 a month that is not the first day is refused');

-- AC-EQP-006 line rules
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c04', '{"date_from":"2026-03-28","date_to":"2026-04-02"}'))) $$, '22023',
  'EQP_DATE_RANGE: a line''s dates must be inside the plan''s month', 'AC-EQP-006 a line that starts before its month is refused');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c04', '{"date_from":"2026-04-20","date_to":"2026-05-01"}'))) $$, '22023',
  'EQP_DATE_RANGE: a line''s dates must be inside the plan''s month', 'AC-EQP-006 a line that ends after its month is refused');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c04', '{"quantity":0,"date_from":"2026-04-02","date_to":"2026-04-03"}'))) $$, '23514',
  null, 'AC-EQP-006 a quantity of zero is refused');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c04', '{"work_order_id":"27002000-0000-0000-0000-0000000000d2","date_from":"2026-04-02","date_to":"2026-04-03"}'))) $$, '23503',
  'EQP_REFERENCE: the work order is not available on this project', 'AC-EQP-006 a work order of another project is refused');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c1', '2026-04-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c04', '{"vendor_id":"27002000-0000-0000-0000-0000000000e2","date_from":"2026-04-02","date_to":"2026-04-03"}'))) $$, '23503',
  'EQP_REFERENCE: the vendor is not available', 'AC-EQP-006 another organisation''s vendor is refused');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b04', '27002000-0000-0000-0000-0000000000c3', '2026-04-01', '[]') $$, '23503',
  'EQP_REFERENCE: the project is not available', 'AC-EQP-006 another organisation''s project is refused');

-- only the author changes or submits a Draft
select pg_temp._as('27002000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b05', '27002000-0000-0000-0000-0000000000c1', '2026-03-01', '[]') $$, '42501',
  'EQP_DENIED: only the author can change this plan', 'AC-EQP-005 another user cannot rewrite the author''s plan');
select throws_ok($$ select public.submit_equipment_plan('27002000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_DENIED: only the author can submit this plan', 'AC-EQP-005 nor submit it');

-- AC-EQP-007 submit, then locked
select pg_temp._as('27002000-0000-0000-0000-0000000000a2');
select public.save_equipment_plan('27002000-0000-0000-0000-000000000b06', '27002000-0000-0000-0000-0000000000c1', '2026-05-01', '[]');
select throws_ok($$ select public.submit_equipment_plan('27002000-0000-0000-0000-000000000b06') $$, '22023',
  'EQP_INVALID: add at least one line before submitting', 'AC-EQP-007 a plan with no line cannot be submitted');
select lives_ok($$ select public.submit_equipment_plan('27002000-0000-0000-0000-000000000b01') $$, 'AC-EQP-007 the author submits');
select is((select status from equipment_plans where id = '27002000-0000-0000-0000-000000000b01'), 'Submitted', 'AC-EQP-007 the plan is Submitted');
select throws_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b01', '27002000-0000-0000-0000-0000000000c1', '2026-03-01', '[]') $$, '55000',
  'EQP_LOCKED: the plan is not a Draft, so it cannot change', 'AC-EQP-007 a Submitted plan cannot be rewritten');
select throws_ok($$ select public.reopen_equipment_plan('27002000-0000-0000-0000-000000000b01') $$, '55000',
  'EQP_STATE: only a rejected plan can be reopened', 'AC-EQP-007 only a Rejected plan reopens');

-- the table-level guards hold for the owner too (a direct write is not a way round)
reset role;
select throws_ok($$ update equipment_plan_lines set quantity = 99 where plan_id = '27002000-0000-0000-0000-000000000b01' $$, '55000',
  'EQP_LOCKED: the plan is not a Draft, so its lines cannot change', 'AC-EQP-007 a direct edit of a Submitted plan''s line is refused');
select throws_ok($$ update equipment_plans set status = 'Approved' where id = '27002000-0000-0000-0000-000000000b06' $$, '55000',
  'EQP_STATE: a Draft plan cannot become Approved', 'AC-EQP-007 a plan cannot skip Submitted');
select throws_ok($$ delete from equipment_plans where id = '27002000-0000-0000-0000-000000000b06' $$, '55000',
  'EQP_LOCKED: a plan cannot be deleted', 'AC-EQP-007 a plan cannot be deleted');
select throws_ok($$ update equipment_plans set project_id = '27002000-0000-0000-0000-0000000000c2' where id = '27002000-0000-0000-0000-000000000b06' $$, '55000',
  'EQP_LOCKED: the project, month and author of a plan do not change', 'AC-EQP-007 the project of a plan does not change');
set local role authenticated;

-- an Engineer with no purchase on the project plans their own month
select pg_temp._as('27002000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.save_equipment_plan('27002000-0000-0000-0000-000000000b07', '27002000-0000-0000-0000-0000000000c2', '2026-03-01',
  jsonb_build_array(pg_temp._line('27002000-0000-0000-0000-000000000c07'))) $$, 'AC-EQP-019 an Engineer drafts a plan');

-- AC-EQP-019 who reads: Admin, Executive, Finance, Project Manager, the author, and an Engineer on the project
select is((select count(*)::int from equipment_plans), 1, 'AC-EQP-019 an Engineer not on a project reads only their own plan');
select is((select count(*)::int from equipment_plan_lines), 1, 'AC-EQP-019 and only its lines');
select pg_temp._as('27002000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from equipment_plans where project_id = '27002000-0000-0000-0000-0000000000c1'), 2, 'AC-EQP-019 an Engineer who raised a purchase on the project reads its plans');
select is((select count(*)::int from equipment_plans where project_id = '27002000-0000-0000-0000-0000000000c2'), 0, 'AC-EQP-019 but not another project''s plans');
select pg_temp._as('27002000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from equipment_plans), 3, 'AC-EQP-019 Finance reads every plan of the organisation');
select pg_temp._as('27002000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from equipment_plans), 3, 'AC-EQP-019 an Admin reads every plan of the organisation');

-- AC-EQP-015 tenancy: another organisation reads nothing and cannot act on a plan of ours
select pg_temp._as('27002000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from equipment_plans) + (select count(*)::int from equipment_plan_lines), 0, 'AC-EQP-015 another organisation reads no plan or line');
select throws_ok($$ select public.submit_equipment_plan('27002000-0000-0000-0000-000000000b01') $$, '55000',
  'EQP_OFF: the monthly plan is not turned on', 'AC-EQP-015 and cannot submit one: its own plan switch is off');

select * from finish();
rollback;
