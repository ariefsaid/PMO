-- 1471_procurement_plan_author_cannot_approve_purchase.test.sql — the author of a monthly equipment plan cannot approve the
-- purchases that the plan created (SoD): the author priced the lines and the plan approver became the requester, so the
-- requester ≠ approver rule alone does not reach them. Migrations under test: 1471 (and 1351, 1358, 1359, 1016, 1017, 0243).
-- Every denial asserts errcode AND message. Mutation: the guard trigger is dropped in-transaction and the approval goes through.
begin;
create extension if not exists pgtap;
select plan(16);

insert into organizations (id, name, default_currency, default_timezone) values
  ('47010000-0000-0000-0000-00000000000a', 'EQP Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('47010000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('47010000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('47010000-0000-0000-0000-0000000000a3', 'eqp-eng@example.com'),
  ('47010000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('47010000-0000-0000-0000-0000000000a5', 'eqp-exec@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('47010000-0000-0000-0000-0000000000a1', '47010000-0000-0000-0000-00000000000a', 'EQP Admin',    'eqp-admin@example.com', 'Admin',           'active'),
  ('47010000-0000-0000-0000-0000000000a2', '47010000-0000-0000-0000-00000000000a', 'EQP PM',       'eqp-pm@example.com',    'Project Manager', 'active'),
  ('47010000-0000-0000-0000-0000000000a3', '47010000-0000-0000-0000-00000000000a', 'EQP Engineer', 'eqp-eng@example.com',   'Engineer',        'active'),
  ('47010000-0000-0000-0000-0000000000a4', '47010000-0000-0000-0000-00000000000a', 'EQP Finance',  'eqp-fin@example.com',   'Finance',         'active'),
  ('47010000-0000-0000-0000-0000000000a5', '47010000-0000-0000-0000-00000000000a', 'EQP Executive','eqp-exec@example.com',  'Executive',       'active');
insert into projects (id, org_id, name, status) values
  ('47010000-0000-0000-0000-0000000000c1', '47010000-0000-0000-0000-00000000000a', 'EQP Project', 'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('47010000-0000-0000-0000-0000000000e1', '47010000-0000-0000-0000-00000000000a', 'EQP Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('47010000-0000-0000-0000-0000000000d1', '47010000-0000-0000-0000-00000000000a', '47010000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0);
insert into org_purchase_type_settings (org_id, enabled) values ('47010000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('47010000-0000-0000-0000-0000000000f2', '47010000-0000-0000-0000-00000000000a', 'Hire', true, 2);
insert into org_equipment_plan_settings (org_id, enabled) values ('47010000-0000-0000-0000-00000000000a', true);
-- the named approver set of the organisation: the plan author sits on it too, so the routing alone cannot be what refuses them
insert into spend_approvers (org_id, project_id, profile_id) values
  ('47010000-0000-0000-0000-00000000000a', null, '47010000-0000-0000-0000-0000000000a2'),
  ('47010000-0000-0000-0000-00000000000a', null, '47010000-0000-0000-0000-0000000000a4'),
  ('47010000-0000-0000-0000-00000000000a', null, '47010000-0000-0000-0000-0000000000a5');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- run as the table owner: a Draft plan by the PM with two lines, then Submitted (the one legal move)
create or replace function pg_temp._mkplan(p_plan uuid, p_month date) returns void language plpgsql as $$
begin
  insert into equipment_plans (id, org_id, project_id, plan_month, created_by)
    values (p_plan, '47010000-0000-0000-0000-00000000000a', '47010000-0000-0000-0000-0000000000c1', p_month, '47010000-0000-0000-0000-0000000000a2');
  insert into equipment_plan_lines (id, org_id, plan_id, work_order_id, description, quantity, rate, vendor_id, date_from, date_to) values
    (md5(p_plan::text || '1')::uuid, '47010000-0000-0000-0000-00000000000a', p_plan, '47010000-0000-0000-0000-0000000000d1', 'Excavator', 2, 1000, '47010000-0000-0000-0000-0000000000e1', p_month + 4, p_month + 19),
    (md5(p_plan::text || '2')::uuid, '47010000-0000-0000-0000-00000000000a', p_plan, null, 'Generator', 1, 500, '47010000-0000-0000-0000-0000000000e1', p_month + 9, p_month + 27);
  update equipment_plans set status = 'Submitted', submitted_at = now() where id = p_plan;
end $$;
create or replace function pg_temp._pid(p_plan uuid, p_n int) returns uuid language sql as $$
  select md5('eqplan:' || (md5(p_plan::text || p_n::text)::uuid)::text)::uuid
$$;

select pg_temp._mkplan('47010000-0000-0000-0000-000000000b01', '2026-01-01');
select pg_temp._mkplan('47010000-0000-0000-0000-000000000b02', '2026-02-01');
set local role authenticated;

-- the plan approver (Finance) approves the plan: the two Draft purchases are theirs
select pg_temp._as('47010000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.approve_equipment_plan('47010000-0000-0000-0000-000000000b01') $$, 'the plan approver approves the plan');
select is((select count(*)::int from procurements p join equipment_plan_lines l on l.procurement_id = p.id
            where l.plan_id = '47010000-0000-0000-0000-000000000b01' and p.requested_by_id = '47010000-0000-0000-0000-0000000000a4'), 2,
  'both purchases are requested by the plan approver, so the requester rule alone never reaches the plan''s author');

-- the plan approver submits the first purchase
select lives_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1), 'Requested') $$,
  'the plan approver submits the purchase');
-- the plan's author sits on the approver set and is not the requester: everything but the plan rule admits them
select pg_temp._as('47010000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1), 'Approved') $$, '42501',
  'separation of duties: the author of the equipment plan that created this purchase cannot approve it',
  'the plan''s author cannot approve the purchase the plan created');
select is((select status from procurements where id = pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1)), 'Requested', 'the purchase stays Requested');
select is((select approved_by_id from procurements where id = pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1)), null, 'and no approver is recorded');

-- the requester rule still holds underneath
select pg_temp._as('47010000-0000-0000-0000-0000000000a4');
select throws_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1), 'Approved') $$, '42501',
  'separation of duties: requester cannot approve/reject own procurement', 'the requester still cannot approve their own purchase');

-- a third eligible approver, who authored no plan over this purchase, approves it
select pg_temp._as('47010000-0000-0000-0000-0000000000a5');
select lives_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1), 'Approved') $$,
  'a third eligible approver approves the purchase');
select is((select status || ':' || approved_by_id::text from procurements where id = pg_temp._pid('47010000-0000-0000-0000-000000000b01', 1)),
  'Approved:47010000-0000-0000-0000-0000000000a5', 'and it is their approval that is recorded');

-- the second purchase of the same plan is refused for the author too
select pg_temp._as('47010000-0000-0000-0000-0000000000a4');
select lives_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 2), 'Requested') $$,
  'the plan approver submits the second purchase');
select pg_temp._as('47010000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 2), 'Approved') $$, '42501',
  'separation of duties: the author of the equipment plan that created this purchase cannot approve it',
  'every purchase the plan created is refused to its author');

-- an author of some plan may still approve a purchase no plan line points at
select pg_temp._as('47010000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.create_procurement_with_items(
  '47010000-0000-0000-0000-000000000a02'::uuid,
  jsonb_build_object('title', 'Plain purchase', 'project_id', '47010000-0000-0000-0000-0000000000c1'::uuid),
  jsonb_build_array(jsonb_build_object('id', md5('plain-rope')::uuid::text, 'name', 'Rope', 'quantity', 1, 'rate', 10))) $$, 'an ordinary purchase is raised');
select lives_ok($$ select public.transition_procurement('47010000-0000-0000-0000-000000000a02'::uuid, 'Requested') $$, 'and submitted');
select pg_temp._as('47010000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.transition_procurement('47010000-0000-0000-0000-000000000a02'::uuid, 'Approved') $$,
  'the plan''s author approves a purchase the plan did not create');

-- mutation: without the guard trigger the author's approval of the plan's purchase goes through
reset role;
drop trigger if exists procurements_guard_plan_author on public.procurements;
set local role authenticated;
select pg_temp._as('47010000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.transition_procurement(pg_temp._pid('47010000-0000-0000-0000-000000000b01', 2), 'Approved') $$,
  'mut:guard is what refuses: without the trigger the author approves');
select is((select approved_by_id from procurements where id = pg_temp._pid('47010000-0000-0000-0000-000000000b01', 2)),
  '47010000-0000-0000-0000-0000000000a2'::uuid, 'mut:guard and it is recorded');

select * from finish();
rollback;
