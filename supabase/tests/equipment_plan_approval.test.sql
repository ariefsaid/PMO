-- equipment_plan_approval.test.sql — #2700: who may approve a plan, the author refused (SoD), reject, and the locks after approval.
-- AC-EQP-008 approver route (mutation-checked) · AC-EQP-009 no self-approval (mutation-checked) · AC-EQP-014 reject, closed after approval · AC-EQP-015 tenancy.
-- Migrations under test: 1358, 1359. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(29);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27003000-0000-0000-0000-00000000000a', 'EQP Org',       'IDR', 'Asia/Jakarta'),
  ('27003000-0000-0000-0000-00000000000b', 'EQP Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27003000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('27003000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('27003000-0000-0000-0000-0000000000a3', 'eqp-eng-on@example.com'),
  ('27003000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('27003000-0000-0000-0000-0000000000a5', 'eqp-eng-off@example.com'),
  ('27003000-0000-0000-0000-0000000000b1', 'eqp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27003000-0000-0000-0000-0000000000a1', '27003000-0000-0000-0000-00000000000a', 'EQP Admin',   'eqp-admin@example.com',   'Admin', 'active'),
  ('27003000-0000-0000-0000-0000000000a2', '27003000-0000-0000-0000-00000000000a', 'EQP PM',      'eqp-pm@example.com',      'Project Manager', 'active'),
  ('27003000-0000-0000-0000-0000000000a3', '27003000-0000-0000-0000-00000000000a', 'EQP Eng On',  'eqp-eng-on@example.com',  'Engineer', 'active'),
  ('27003000-0000-0000-0000-0000000000a4', '27003000-0000-0000-0000-00000000000a', 'EQP Finance', 'eqp-fin@example.com',     'Finance', 'active'),
  ('27003000-0000-0000-0000-0000000000a5', '27003000-0000-0000-0000-00000000000a', 'EQP Eng Off', 'eqp-eng-off@example.com', 'Engineer', 'active'),
  ('27003000-0000-0000-0000-0000000000b1', '27003000-0000-0000-0000-00000000000b', 'EQP XAdmin',  'eqp-xadmin@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('27003000-0000-0000-0000-0000000000c1', '27003000-0000-0000-0000-00000000000a', 'EQP Project',       'Ongoing Project'),
  ('27003000-0000-0000-0000-0000000000c2', '27003000-0000-0000-0000-00000000000a', 'EQP Other Project', 'Ongoing Project'),
  ('27003000-0000-0000-0000-0000000000c3', '27003000-0000-0000-0000-00000000000b', 'EQP Foreign',       'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27003000-0000-0000-0000-0000000000e1', '27003000-0000-0000-0000-00000000000a', 'EQP Vendor',         'Vendor'),
  ('27003000-0000-0000-0000-0000000000e2', '27003000-0000-0000-0000-00000000000b', 'EQP Foreign Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('27003000-0000-0000-0000-0000000000d1', '27003000-0000-0000-0000-00000000000a', '27003000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0),
  ('27003000-0000-0000-0000-0000000000d2', '27003000-0000-0000-0000-00000000000a', '27003000-0000-0000-0000-0000000000c2', 'EQP WO elsewhere',  10, 'exclusive', 0);
-- the first type is a decoy: named like a rental, but not flagged; the flag, not the name, marks the real one
insert into org_purchase_type_settings (org_id, enabled) values ('27003000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27003000-0000-0000-0000-0000000000f1', '27003000-0000-0000-0000-00000000000a', 'Rental', false, 1),
  ('27003000-0000-0000-0000-0000000000f2', '27003000-0000-0000-0000-00000000000a', 'Hire',   true,  2);
-- an Engineer who raised a purchase on the project is "on" it
insert into procurements (id, org_id, title, status, project_id, requested_by_id) values
  ('27003000-0000-0000-0000-000000000a01', '27003000-0000-0000-0000-00000000000a', 'EQP engineer purchase', 'Draft', '27003000-0000-0000-0000-0000000000c1', '27003000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one plan line as the RPC takes it; p_extra overrides any key
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27003000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;

insert into org_equipment_plan_settings (org_id, enabled) values ('27003000-0000-0000-0000-00000000000a', true);
insert into org_equipment_plan_settings (org_id, enabled) values ('27003000-0000-0000-0000-00000000000b', true);
-- run as the table owner: a Draft plan with two lines, then Submitted (the one legal move)
create or replace function pg_temp._mkplan(p_plan uuid, p_project uuid, p_month date, p_author uuid) returns void language plpgsql as $$
begin
  insert into equipment_plans (id, org_id, project_id, plan_month, created_by) values (p_plan, '27003000-0000-0000-0000-00000000000a', p_project, p_month, p_author);
  insert into equipment_plan_lines (id, org_id, plan_id, work_order_id, description, quantity, rate, vendor_id, date_from, date_to) values
    (md5(p_plan::text || '1')::uuid, '27003000-0000-0000-0000-00000000000a', p_plan, '27003000-0000-0000-0000-0000000000d1', 'Excavator', 2, 1000, '27003000-0000-0000-0000-0000000000e1', p_month + 4, p_month + 19),
    (md5(p_plan::text || '2')::uuid, '27003000-0000-0000-0000-00000000000a', p_plan, null, 'Generator', 1, 500, '27003000-0000-0000-0000-0000000000e1', p_month + 9, p_month + 27);
  update equipment_plans set status = 'Submitted', submitted_at = now() where id = p_plan;
end $$;

select pg_temp._mkplan('27003000-0000-0000-0000-000000000b01', '27003000-0000-0000-0000-0000000000c1', '2026-01-01', '27003000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27003000-0000-0000-0000-000000000b02', '27003000-0000-0000-0000-0000000000c1', '2026-02-01', '27003000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27003000-0000-0000-0000-000000000b03', '27003000-0000-0000-0000-0000000000c1', '2026-03-01', '27003000-0000-0000-0000-0000000000a1');
select pg_temp._mkplan('27003000-0000-0000-0000-000000000b04', '27003000-0000-0000-0000-0000000000c1', '2026-04-01', '27003000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27003000-0000-0000-0000-000000000b05', '27003000-0000-0000-0000-0000000000c1', '2026-05-01', '27003000-0000-0000-0000-0000000000a2');
set local role authenticated;

-- the approver's route. No spend approvers are set up: the Admin is the approver (DD-APR-4).
select pg_temp._as('27003000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-008 an Engineer cannot approve');
select pg_temp._as('27003000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-008 Finance is not an approver while no approver is named and an Admin holds the step');
select pg_temp._as('27003000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_SELF_APPROVAL: you cannot approve your own plan', 'AC-EQP-009 the author cannot approve their own plan');
select is((select status from equipment_plans where id = '27003000-0000-0000-0000-000000000b01'), 'Submitted', 'AC-EQP-008 every refusal left the plan Submitted');
select is((select count(*)::int from equipment_plan_lines where procurement_id is not null), 0, 'AC-EQP-008 and created nothing');

-- the project names its approver: the Admin no longer is one for that project
reset role;
insert into spend_approvers (org_id, project_id, profile_id) values ('27003000-0000-0000-0000-00000000000a', '27003000-0000-0000-0000-0000000000c1', '27003000-0000-0000-0000-0000000000a4');
set local role authenticated;
select pg_temp._as('27003000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-008 with a project approver named, the Admin is not the approver of that project');
select is(public.equipment_plan_approver_ok('27003000-0000-0000-0000-000000000b01'), false, 'AC-EQP-008 the screen''s check says the same');
select pg_temp._as('27003000-0000-0000-0000-0000000000a4');
select is(public.equipment_plan_approver_ok('27003000-0000-0000-0000-000000000b01'), true, 'AC-EQP-008 and says yes for the named approver');
select lives_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, 'AC-EQP-008 the named approver approves');
select is((select status || ':' || approved_by::text from equipment_plans where id = '27003000-0000-0000-0000-000000000b01'), 'Approved:27003000-0000-0000-0000-0000000000a4', 'AC-EQP-008 the plan is Approved by them');

-- the senior_role step: any role with spend authority, not an Engineer
reset role;
delete from spend_approvers;
update org_equipment_plan_settings set approval_step = 'senior_role';
set local role authenticated;
select pg_temp._as('27003000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b02') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-008 on the senior-role step an Engineer is refused');
select pg_temp._as('27003000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b02') $$, 'AC-EQP-008 and a role with spend authority approves');

-- AC-EQP-009 self-approval is a setting; an Admin author is refused too while it is off
reset role;
update org_equipment_plan_settings set approval_step = 'spend_approvers';
set local role authenticated;
select pg_temp._as('27003000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b03') $$, '42501',
  'EQP_SELF_APPROVAL: you cannot approve your own plan', 'AC-EQP-009 an Admin cannot approve their own plan');
select throws_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b03', 'no') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-009 nor reject it');
reset role;
update org_equipment_plan_settings set allow_self_approval = true;
set local role authenticated;
select pg_temp._as('27003000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b03') $$, 'AC-EQP-009 with the setting on the author may approve');
reset role;
update org_equipment_plan_settings set allow_self_approval = false;
set local role authenticated;

-- AC-EQP-014 reject: a reason, an approver, and it creates nothing; an approved plan is closed
select pg_temp._as('27003000-0000-0000-0000-0000000000a3');
select throws_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b04', 'not needed') $$, '42501',
  'EQP_NOT_APPROVER: you cannot approve or reject this plan', 'AC-EQP-014 an Engineer cannot reject');
select pg_temp._as('27003000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b04', '  ') $$, '22023',
  'EQP_INVALID: give a reason of 1 to 500 characters', 'AC-EQP-014 a reason is required');
select lives_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b04', 'Too many cranes') $$, 'AC-EQP-014 an approver rejects with a reason');
select is((select status || ':' || reject_reason from equipment_plans where id = '27003000-0000-0000-0000-000000000b04'), 'Rejected:Too many cranes', 'AC-EQP-014 the plan is Rejected with the reason');
select is((select count(*)::int from equipment_plan_lines where plan_id = '27003000-0000-0000-0000-000000000b04' and procurement_id is not null), 0, 'AC-EQP-014 and nothing was created');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b04') $$, '55000',
  'EQP_STATE: only a submitted plan can be approved', 'AC-EQP-014 a Rejected plan cannot be approved');
select throws_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b01', 'late') $$, '55000',
  'EQP_STATE: only a submitted plan can be rejected', 'AC-EQP-014 an approved plan cannot be rejected');
select pg_temp._as('27003000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.reopen_equipment_plan('27003000-0000-0000-0000-000000000b01') $$, '55000',
  'EQP_STATE: only a rejected plan can be reopened', 'AC-EQP-014 an approved plan cannot be reopened');
select lives_ok($$ select public.reopen_equipment_plan('27003000-0000-0000-0000-000000000b04') $$, 'AC-EQP-007 the author reopens a Rejected plan');
select is((select status || ':' || coalesce(reject_reason, 'none') from equipment_plans where id = '27003000-0000-0000-0000-000000000b04'), 'Draft:none', 'AC-EQP-007 it is a Draft again, the reason cleared');
reset role;
select throws_ok($$ update equipment_plan_lines set quantity = 9 where plan_id = '27003000-0000-0000-0000-000000000b01' $$, '55000',
  'EQP_LOCKED: the plan is not a Draft, so its lines cannot change', 'AC-EQP-014 the lines of a plan that created purchases cannot change');
select throws_ok($$ update equipment_plans set reject_reason = 'x' where id = '27003000-0000-0000-0000-000000000b01' $$, '55000',
  'EQP_LOCKED: an approved plan has created its purchases and cannot change', 'AC-EQP-014 nor the plan itself');
set local role authenticated;

-- AC-EQP-015 tenancy: another organisation's Admin cannot act on our plan
select pg_temp._as('27003000-0000-0000-0000-0000000000b1');
select throws_ok($$ select public.approve_equipment_plan('27003000-0000-0000-0000-000000000b05') $$, '23503',
  'EQP_NOT_FOUND: the plan is not available', 'AC-EQP-015 another organisation''s Admin cannot approve our plan');
select throws_ok($$ select public.reject_equipment_plan('27003000-0000-0000-0000-000000000b05', 'x') $$, '23503',
  'EQP_NOT_FOUND: the plan is not available', 'AC-EQP-015 nor reject it');

select * from finish();
rollback;
