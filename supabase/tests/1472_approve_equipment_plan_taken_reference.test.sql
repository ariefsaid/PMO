-- 1472_approve_equipment_plan_taken_reference.test.sql — approving a plan refuses with a clear reason, before creating anything,
-- when a purchase under one of the plan's derived line references already exists with another requester; a purchase under the
-- same approver (an identical earlier request) is still taken over idempotently. Migrations under test: 1472 (and 1358, 1359).
-- Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name, default_currency, default_timezone) values
  ('47020000-0000-0000-0000-00000000000a', 'EQP Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('47020000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('47020000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('47020000-0000-0000-0000-0000000000a3', 'eqp-eng@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('47020000-0000-0000-0000-0000000000a1', '47020000-0000-0000-0000-00000000000a', 'EQP Admin',    'eqp-admin@example.com', 'Admin',           'active'),
  ('47020000-0000-0000-0000-0000000000a2', '47020000-0000-0000-0000-00000000000a', 'EQP PM',       'eqp-pm@example.com',    'Project Manager', 'active'),
  ('47020000-0000-0000-0000-0000000000a3', '47020000-0000-0000-0000-00000000000a', 'EQP Engineer', 'eqp-eng@example.com',   'Engineer',        'active');
insert into projects (id, org_id, name, status) values
  ('47020000-0000-0000-0000-0000000000c1', '47020000-0000-0000-0000-00000000000a', 'EQP Project', 'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('47020000-0000-0000-0000-0000000000e1', '47020000-0000-0000-0000-00000000000a', 'EQP Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('47020000-0000-0000-0000-0000000000d1', '47020000-0000-0000-0000-00000000000a', '47020000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0);
insert into org_purchase_type_settings (org_id, enabled) values ('47020000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('47020000-0000-0000-0000-0000000000f2', '47020000-0000-0000-0000-00000000000a', 'Hire', true, 2);
insert into org_equipment_plan_settings (org_id, enabled) values ('47020000-0000-0000-0000-00000000000a', true);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
create or replace function pg_temp._pid(p_plan uuid, p_n int) returns uuid language sql security definer set search_path = public as $$
  select md5('eqplan:' || (md5(p_plan::text || p_n::text)::uuid)::text)::uuid
$$;
grant execute on function pg_temp._pid(uuid, int) to authenticated;
create or replace function pg_temp._iid(p_plan uuid, p_n int) returns uuid language sql security definer set search_path = public as $$
  select md5('eqplanitem:' || (md5(p_plan::text || p_n::text)::uuid)::text)::uuid
$$;
grant execute on function pg_temp._iid(uuid, int) to authenticated;
-- run as the table owner: a Draft plan by the PM with two lines, then Submitted (the one legal move)
create or replace function pg_temp._mkplan(p_plan uuid, p_month date) returns void language plpgsql as $$
begin
  insert into equipment_plans (id, org_id, project_id, plan_month, created_by)
    values (p_plan, '47020000-0000-0000-0000-00000000000a', '47020000-0000-0000-0000-0000000000c1', p_month, '47020000-0000-0000-0000-0000000000a2');
  insert into equipment_plan_lines (id, org_id, plan_id, work_order_id, description, quantity, rate, vendor_id, date_from, date_to) values
    (md5(p_plan::text || '1')::uuid, '47020000-0000-0000-0000-00000000000a', p_plan, '47020000-0000-0000-0000-0000000000d1', 'Excavator', 2, 1000, '47020000-0000-0000-0000-0000000000e1', p_month + 4, p_month + 19),
    (md5(p_plan::text || '2')::uuid, '47020000-0000-0000-0000-00000000000a', p_plan, null, 'Generator', 1, 500, '47020000-0000-0000-0000-0000000000e1', p_month + 9, p_month + 27);
  update equipment_plans set status = 'Submitted', submitted_at = now() where id = p_plan;
end $$;

select pg_temp._mkplan('47020000-0000-0000-0000-000000000b01', '2026-01-01');
select pg_temp._mkplan('47020000-0000-0000-0000-000000000b02', '2026-02-01');
-- someone else already raised the purchase under the second line's derived reference
insert into procurements (id, org_id, title, status, requested_by_id)
  values (pg_temp._pid('47020000-0000-0000-0000-000000000b01', 2), '47020000-0000-0000-0000-00000000000a', 'taken id', 'Draft', '47020000-0000-0000-0000-0000000000a3');
set local role authenticated;

select pg_temp._as('47020000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_equipment_plan('47020000-0000-0000-0000-000000000b01') $$, '42501',
  'EQP_PID_TAKEN: one of this plan''s purchase references is already in use; save the line again in the Draft plan to pick a new one',
  'a purchase under another requester is refused naming the cause');
select is((select status from equipment_plans where id = '47020000-0000-0000-0000-000000000b01'), 'Submitted', 'the plan stays Submitted');
select is((select count(*)::int from equipment_plan_lines where plan_id = '47020000-0000-0000-0000-000000000b01' and procurement_id is not null), 0,
  'no line was linked');
select is((select count(*)::int from procurements p where p.id = any (array[pg_temp._pid('47020000-0000-0000-0000-000000000b01', 1), pg_temp._pid('47020000-0000-0000-0000-000000000b01', 2)])), 1,
  'nothing was created before the refusal: only the pre-existing purchase exists');

-- a purchase the approver raised themselves, with the exact payload the approval would send, is taken over idempotently
select lives_ok($$ select public.create_procurement_with_items(
  pg_temp._pid('47020000-0000-0000-0000-000000000b02', 1),
  jsonb_build_object('title', 'Excavator (2026-02-05 – 2026-02-20)',
                     'project_id', '47020000-0000-0000-0000-0000000000c1'::uuid,
                     'vendor_id', '47020000-0000-0000-0000-0000000000e1'::uuid,
                     'purchase_type_id', '47020000-0000-0000-0000-0000000000f2'::uuid,
                     'rental_from', '2026-02-05'::date, 'rental_to', '2026-02-20'::date),
  jsonb_build_array(jsonb_build_object('id', pg_temp._iid('47020000-0000-0000-0000-000000000b02', 1),
                     'name', 'Excavator', 'description', 'Monthly plan 2026-02 · Work order EQP WO on project',
                     'quantity', 2, 'rate', 1000))) $$, 'the approver raises the first purchase of the second plan themselves');
select lives_ok($$ select public.approve_equipment_plan('47020000-0000-0000-0000-000000000b02') $$,
  'the approval takes that purchase over instead of refusing it');
select is((select p.status || ':' || count(*)::text from equipment_plan_lines l
            join procurements p on p.id = l.procurement_id
           where l.plan_id = '47020000-0000-0000-0000-000000000b02' group by p.status), 'Draft:2', 'both lines link to their Draft purchases, the first one the earlier request');
select is((select count(*)::int from procurements where title like 'Excavator (2026-02%' or title like 'Generator (2026-02%'), 2,
  'and the earlier request was not duplicated');

select * from finish();
rollback;
