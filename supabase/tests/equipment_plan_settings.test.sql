-- equipment_plan_settings.test.sql — #2700: the monthly plan is off until an Admin turns it on, and its categories are data.
-- AC-EQP-001 default-off · AC-EQP-002 prerequisites · AC-EQP-003 Admin only (mutation-checked) · AC-EQP-004 categories · AC-EQP-015 tenancy.
-- Migration under test: 1358_equipment_plan.sql. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27001000-0000-0000-0000-00000000000a', 'EQP Org',       'IDR', 'Asia/Jakarta'),
  ('27001000-0000-0000-0000-00000000000b', 'EQP Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27001000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('27001000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('27001000-0000-0000-0000-0000000000a3', 'eqp-eng-on@example.com'),
  ('27001000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('27001000-0000-0000-0000-0000000000a5', 'eqp-eng-off@example.com'),
  ('27001000-0000-0000-0000-0000000000b1', 'eqp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27001000-0000-0000-0000-0000000000a1', '27001000-0000-0000-0000-00000000000a', 'EQP Admin',   'eqp-admin@example.com',   'Admin', 'active'),
  ('27001000-0000-0000-0000-0000000000a2', '27001000-0000-0000-0000-00000000000a', 'EQP PM',      'eqp-pm@example.com',      'Project Manager', 'active'),
  ('27001000-0000-0000-0000-0000000000a3', '27001000-0000-0000-0000-00000000000a', 'EQP Eng On',  'eqp-eng-on@example.com',  'Engineer', 'active'),
  ('27001000-0000-0000-0000-0000000000a4', '27001000-0000-0000-0000-00000000000a', 'EQP Finance', 'eqp-fin@example.com',     'Finance', 'active'),
  ('27001000-0000-0000-0000-0000000000a5', '27001000-0000-0000-0000-00000000000a', 'EQP Eng Off', 'eqp-eng-off@example.com', 'Engineer', 'active'),
  ('27001000-0000-0000-0000-0000000000b1', '27001000-0000-0000-0000-00000000000b', 'EQP XAdmin',  'eqp-xadmin@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('27001000-0000-0000-0000-0000000000c1', '27001000-0000-0000-0000-00000000000a', 'EQP Project',       'Ongoing Project'),
  ('27001000-0000-0000-0000-0000000000c2', '27001000-0000-0000-0000-00000000000a', 'EQP Other Project', 'Ongoing Project'),
  ('27001000-0000-0000-0000-0000000000c3', '27001000-0000-0000-0000-00000000000b', 'EQP Foreign',       'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27001000-0000-0000-0000-0000000000e1', '27001000-0000-0000-0000-00000000000a', 'EQP Vendor',         'Vendor'),
  ('27001000-0000-0000-0000-0000000000e2', '27001000-0000-0000-0000-00000000000b', 'EQP Foreign Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('27001000-0000-0000-0000-0000000000d1', '27001000-0000-0000-0000-00000000000a', '27001000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0),
  ('27001000-0000-0000-0000-0000000000d2', '27001000-0000-0000-0000-00000000000a', '27001000-0000-0000-0000-0000000000c2', 'EQP WO elsewhere',  10, 'exclusive', 0);
-- the first type is a decoy: named like a rental, but not flagged; the flag, not the name, marks the real one
insert into org_purchase_type_settings (org_id, enabled) values ('27001000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27001000-0000-0000-0000-0000000000f1', '27001000-0000-0000-0000-00000000000a', 'Rental', false, 1),
  ('27001000-0000-0000-0000-0000000000f2', '27001000-0000-0000-0000-00000000000a', 'Hire',   true,  2);
-- an Engineer who raised a purchase on the project is "on" it
insert into procurements (id, org_id, title, status, project_id, requested_by_id) values
  ('27001000-0000-0000-0000-000000000a01', '27001000-0000-0000-0000-00000000000a', 'EQP engineer purchase', 'Draft', '27001000-0000-0000-0000-0000000000c1', '27001000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one plan line as the RPC takes it; p_extra overrides any key
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27001000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;

-- this file starts with purchase types OFF so AC-EQP-002 can prove the prerequisite
delete from purchase_types where org_id = '27001000-0000-0000-0000-00000000000a';
delete from org_purchase_type_settings where org_id = '27001000-0000-0000-0000-00000000000a';


set local role authenticated;

-- AC-EQP-001 default off: nothing exists, and every plan RPC refuses
select pg_temp._as('27001000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from org_equipment_plan_settings), 0, 'AC-EQP-001 default-off: a fresh organisation has no settings row');
select is((select count(*)::int from equipment_plans) + (select count(*)::int from equipment_plan_lines) + (select count(*)::int from equipment_plan_categories), 0, 'AC-EQP-001 and no plans, lines or categories');
select throws_ok($$ select public.save_equipment_plan('27001000-0000-0000-0000-000000000b01', '27001000-0000-0000-0000-0000000000c1', '2026-03-01', '[]') $$, '55000',
  'EQP_OFF: the monthly plan is not turned on', 'AC-EQP-001 with the plan off a plan cannot be saved');
select throws_ok($$ select public.approve_equipment_plan('27001000-0000-0000-0000-000000000b01') $$, '55000',
  'EQP_OFF: the monthly plan is not turned on', 'AC-EQP-001 with the plan off approving is refused');

-- AC-EQP-003 only an Admin changes settings or categories
select throws_ok($$ select public.set_equipment_plan_settings(true, 'spend_approvers', false) $$, '42501',
  'EQP_ADMIN_ONLY: only an Admin can change the monthly plan settings', 'AC-EQP-003 a Project Manager cannot change the settings');
select throws_ok($$ select public.upsert_equipment_plan_category(null, 'Cranes', null, 1) $$, '42501',
  'EQP_ADMIN_ONLY: only an Admin can change plan categories', 'AC-EQP-003 a Project Manager cannot add a category');

-- AC-EQP-002 the prerequisites, named
select pg_temp._as('27001000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_equipment_plan_settings(true, 'spend_approvers', false) $$, '55000',
  'EQP_PREREQ: turn on purchase types first', 'AC-EQP-002 with purchase types off the plan cannot be turned on');
select public.set_purchase_types_enabled(true);
select public.upsert_purchase_type((select id from purchase_types where is_rental), 'Hire', null, false, 3);
select throws_ok($$ select public.set_equipment_plan_settings(true, 'spend_approvers', false) $$, '55000',
  'EQP_PREREQ: purchase types need an active rental type first', 'AC-EQP-002 purchase types on but no rental type: refused');
select public.upsert_purchase_type((select id from purchase_types where lower(name) = 'hire'), 'Hire', null, true, 3);
select throws_ok($$ select public.set_equipment_plan_settings(true, 'whenever', false) $$, '22023',
  'EQP_INVALID: check the monthly plan settings', 'AC-EQP-002 an unknown approval step is refused');
select lives_ok($$ select public.set_equipment_plan_settings(true, 'spend_approvers', false) $$, 'AC-EQP-002 with a rental type present the plan turns on');
select is((select enabled and approval_step = 'spend_approvers' and not allow_self_approval from org_equipment_plan_settings), true, 'AC-EQP-002 the settings are stored, self-approval off');

-- AC-EQP-004 categories are the client's own data
select lives_ok($$ select public.upsert_equipment_plan_category(null, 'Cranes', 'Derek', 1) $$, 'AC-EQP-004 an Admin adds a category');
select throws_ok($$ select public.upsert_equipment_plan_category(null, '  cranes ', null, 2) $$, '23505',
  'EQP_DUPLICATE: a category with that name exists', 'AC-EQP-004 the same name in another case is refused');
select lives_ok($$ select public.set_equipment_plan_category_active((select id from equipment_plan_categories where name = 'Cranes'), false) $$, 'AC-EQP-004 a category is retired, not deleted');
select is((select active from equipment_plan_categories where name = 'Cranes'), false, 'AC-EQP-004 and stays on the list, inactive');
select pg_temp._as('27001000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.set_equipment_plan_category_active((select id from equipment_plan_categories where name = 'Cranes'), true) $$, '42501',
  'EQP_ADMIN_ONLY: only an Admin can change plan categories', 'AC-EQP-003 a Project Manager cannot restore a category');
select is((select count(*)::int from equipment_plan_categories), 1, 'AC-EQP-004 members of the organisation read the categories');

-- AC-EQP-015 tenancy: the other organisation sees nothing and its Admin changes nothing of ours
select pg_temp._as('27001000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from org_equipment_plan_settings) + (select count(*)::int from equipment_plan_categories), 0, 'AC-EQP-015 another organisation reads no settings or categories');
select throws_ok($$ select public.upsert_equipment_plan_category(null, 'Cranes', null, 1) $$, '55000',
  'EQP_OFF: the monthly plan is not turned on', 'AC-EQP-015 another organisation''s Admin has its own plan switch, off, and cannot add to ours');
select throws_ok($$ select public.set_equipment_plan_category_active((select id from equipment_plan_categories), true) $$, '55000',
  'EQP_OFF: the monthly plan is not turned on', 'AC-EQP-015 nor reach our category');

select * from finish();
rollback;
