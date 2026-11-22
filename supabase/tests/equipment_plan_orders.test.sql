-- equipment_plan_orders.test.sql — #2700: approving a plan creates the rental purchases, once, all or none.
-- AC-EQP-010 N Draft purchases · AC-EQP-011 idempotent (mutation-checked) · AC-EQP-012 all or nothing · AC-EQP-013 flag not name (mutation-checked) ·
-- AC-EQP-014 ordinary Drafts · AC-EQP-016 prerequisite. Migrations under test: 1358, 1359. Every denial asserts errcode AND message.
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name, default_currency, default_timezone) values
  ('27004000-0000-0000-0000-00000000000a', 'EQP Org',       'IDR', 'Asia/Jakarta'),
  ('27004000-0000-0000-0000-00000000000b', 'EQP Other Org', 'IDR', 'Asia/Jakarta');
insert into auth.users (id, email) values
  ('27004000-0000-0000-0000-0000000000a1', 'eqp-admin@example.com'),
  ('27004000-0000-0000-0000-0000000000a2', 'eqp-pm@example.com'),
  ('27004000-0000-0000-0000-0000000000a3', 'eqp-eng-on@example.com'),
  ('27004000-0000-0000-0000-0000000000a4', 'eqp-fin@example.com'),
  ('27004000-0000-0000-0000-0000000000a5', 'eqp-eng-off@example.com'),
  ('27004000-0000-0000-0000-0000000000b1', 'eqp-xadmin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27004000-0000-0000-0000-0000000000a1', '27004000-0000-0000-0000-00000000000a', 'EQP Admin',   'eqp-admin@example.com',   'Admin', 'active'),
  ('27004000-0000-0000-0000-0000000000a2', '27004000-0000-0000-0000-00000000000a', 'EQP PM',      'eqp-pm@example.com',      'Project Manager', 'active'),
  ('27004000-0000-0000-0000-0000000000a3', '27004000-0000-0000-0000-00000000000a', 'EQP Eng On',  'eqp-eng-on@example.com',  'Engineer', 'active'),
  ('27004000-0000-0000-0000-0000000000a4', '27004000-0000-0000-0000-00000000000a', 'EQP Finance', 'eqp-fin@example.com',     'Finance', 'active'),
  ('27004000-0000-0000-0000-0000000000a5', '27004000-0000-0000-0000-00000000000a', 'EQP Eng Off', 'eqp-eng-off@example.com', 'Engineer', 'active'),
  ('27004000-0000-0000-0000-0000000000b1', '27004000-0000-0000-0000-00000000000b', 'EQP XAdmin',  'eqp-xadmin@example.com',  'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('27004000-0000-0000-0000-0000000000c1', '27004000-0000-0000-0000-00000000000a', 'EQP Project',       'Ongoing Project'),
  ('27004000-0000-0000-0000-0000000000c2', '27004000-0000-0000-0000-00000000000a', 'EQP Other Project', 'Ongoing Project'),
  ('27004000-0000-0000-0000-0000000000c3', '27004000-0000-0000-0000-00000000000b', 'EQP Foreign',       'Ongoing Project');
insert into companies (id, org_id, name, type) values
  ('27004000-0000-0000-0000-0000000000e1', '27004000-0000-0000-0000-00000000000a', 'EQP Vendor',         'Vendor'),
  ('27004000-0000-0000-0000-0000000000e2', '27004000-0000-0000-0000-00000000000b', 'EQP Foreign Vendor', 'Vendor');
insert into work_orders (id, org_id, project_id, title, order_value, tax_treatment, tax_amount) values
  ('27004000-0000-0000-0000-0000000000d1', '27004000-0000-0000-0000-00000000000a', '27004000-0000-0000-0000-0000000000c1', 'EQP WO on project', 10, 'exclusive', 0),
  ('27004000-0000-0000-0000-0000000000d2', '27004000-0000-0000-0000-00000000000a', '27004000-0000-0000-0000-0000000000c2', 'EQP WO elsewhere',  10, 'exclusive', 0);
-- the first type is a decoy: named like a rental, but not flagged; the flag, not the name, marks the real one
insert into org_purchase_type_settings (org_id, enabled) values ('27004000-0000-0000-0000-00000000000a', true);
insert into purchase_types (id, org_id, name, is_rental, position) values
  ('27004000-0000-0000-0000-0000000000f1', '27004000-0000-0000-0000-00000000000a', 'Rental', false, 1),
  ('27004000-0000-0000-0000-0000000000f2', '27004000-0000-0000-0000-00000000000a', 'Hire',   true,  2);
-- an Engineer who raised a purchase on the project is "on" it
insert into procurements (id, org_id, title, status, project_id, requested_by_id) values
  ('27004000-0000-0000-0000-000000000a01', '27004000-0000-0000-0000-00000000000a', 'EQP engineer purchase', 'Draft', '27004000-0000-0000-0000-0000000000c1', '27004000-0000-0000-0000-0000000000a3');

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;
-- one plan line as the RPC takes it; p_extra overrides any key
create or replace function pg_temp._line(p_id uuid, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'description', 'Excavator', 'quantity', 2, 'rate', 1000,
    'vendor_id', '27004000-0000-0000-0000-0000000000e1', 'date_from', '2026-03-05', 'date_to', '2026-03-20') || p_extra
$$;
grant execute on function pg_temp._line(uuid, jsonb) to authenticated;

insert into org_equipment_plan_settings (org_id, enabled) values ('27004000-0000-0000-0000-00000000000a', true);
-- run as the table owner: a Draft plan with two lines, then Submitted (the one legal move)
create or replace function pg_temp._mkplan(p_plan uuid, p_project uuid, p_month date, p_author uuid) returns void language plpgsql as $$
begin
  insert into equipment_plans (id, org_id, project_id, plan_month, created_by) values (p_plan, '27004000-0000-0000-0000-00000000000a', p_project, p_month, p_author);
  insert into equipment_plan_lines (id, org_id, plan_id, work_order_id, description, quantity, rate, vendor_id, date_from, date_to) values
    (md5(p_plan::text || '1')::uuid, '27004000-0000-0000-0000-00000000000a', p_plan, '27004000-0000-0000-0000-0000000000d1', 'Excavator', 2, 1000, '27004000-0000-0000-0000-0000000000e1', p_month + 4, p_month + 19),
    (md5(p_plan::text || '2')::uuid, '27004000-0000-0000-0000-00000000000a', p_plan, null, 'Generator', 1, 500, '27004000-0000-0000-0000-0000000000e1', p_month + 9, p_month + 27);
  update equipment_plans set status = 'Submitted', submitted_at = now() where id = p_plan;
end $$;

select pg_temp._mkplan('27004000-0000-0000-0000-000000000b01', '27004000-0000-0000-0000-0000000000c1', '2026-01-01', '27004000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27004000-0000-0000-0000-000000000b02', '27004000-0000-0000-0000-0000000000c1', '2026-02-01', '27004000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27004000-0000-0000-0000-000000000b03', '27004000-0000-0000-0000-0000000000c1', '2026-03-01', '27004000-0000-0000-0000-0000000000a2');
select pg_temp._mkplan('27004000-0000-0000-0000-000000000b04', '27004000-0000-0000-0000-0000000000c1', '2026-04-01', '27004000-0000-0000-0000-0000000000a2');
set local role authenticated;

-- AC-EQP-010 approving N lines creates N Draft purchases of the rental type
select pg_temp._as('27004000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b01') $$, 'AC-EQP-010 an approver approves a plan of two lines');
select is((select status from equipment_plans where id = '27004000-0000-0000-0000-000000000b01'), 'Approved', 'AC-EQP-010 the plan is Approved');
select is((select count(*)::int from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b01' and procurement_id is not null), 2, 'AC-EQP-010 each line links to one purchase');
select is((select count(*)::int from procurements p join equipment_plan_lines l on l.procurement_id = p.id where l.plan_id = '27004000-0000-0000-0000-000000000b01'), 2, 'AC-EQP-010 and exactly two purchases exist');
select is((select count(*)::int from procurements p join equipment_plan_lines l on l.procurement_id = p.id
            where l.plan_id = '27004000-0000-0000-0000-000000000b01' and p.status = 'Draft' and p.purchase_type_id = '27004000-0000-0000-0000-0000000000f2'
              and p.rental_from = l.date_from and p.rental_to = l.date_to and p.vendor_id = l.vendor_id
              and p.project_id = '27004000-0000-0000-0000-0000000000c1' and p.requested_by_id = '27004000-0000-0000-0000-0000000000a1'), 2,
  'AC-EQP-014 each is an ordinary Draft of the flagged rental type, with the line''s vendor and period, requested by the approver');
select is((select i.quantity = 2 and i.rate = 1000 and i.description = 'Monthly plan 2026-01 · Work order EQP WO on project'
            from procurement_items i join equipment_plan_lines l on l.procurement_id = i.procurement_id
            where l.plan_id = '27004000-0000-0000-0000-000000000b01' and l.work_order_id is not null),
  true, 'AC-EQP-010 the item carries the line''s quantity and rate, and the work order reference');
select is((select count(*)::int from procurements p join equipment_plan_lines l on l.procurement_id = p.id
            where l.plan_id = '27004000-0000-0000-0000-000000000b01' and p.status <> 'Draft'), 0, 'AC-EQP-014 nothing is advanced: the normal request, approval and routing still lie ahead');

-- AC-EQP-011 idempotent: a second approve, or a retry, creates nothing more
select lives_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b01') $$, 'AC-EQP-011 approving again returns the plan');
select lives_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b01') $$, 'AC-EQP-011 and again');
select is((select count(*)::int from procurements where title like 'Excavator (2026-01%' or title like 'Generator (2026-01%'), 2, 'AC-EQP-011 still two purchases');
reset role;
select throws_ok($$ update equipment_plan_lines set procurement_id = (select procurement_id from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b01' order by id limit 1)
  where plan_id = '27004000-0000-0000-0000-000000000b02' and id = md5('27004000-0000-0000-0000-000000000b02' || '1')::uuid $$, '23505', null,
  'AC-EQP-011 one purchase cannot be linked to a second line: the unique index refuses it');
select throws_ok($$ insert into equipment_plan_lines (id, org_id, plan_id, description, quantity, rate, vendor_id, date_from, date_to, procurement_id)
  select md5('x')::uuid, org_id, '27004000-0000-0000-0000-000000000b01', 'dup', 1, 1, vendor_id, date_from, date_to, procurement_id from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b01' limit 1 $$, '55000',
  'EQP_LOCKED: the plan is not a Draft, so its lines cannot change', 'AC-EQP-011 nor a line be added to an approved plan');
select is((select count(*)::int from pg_indexes where indexname = 'equipment_plan_lines_procurement_uq'), 1, 'AC-EQP-011 one purchase belongs to at most one line: the unique index is in place');
set local role authenticated;

-- AC-EQP-013 the flag decides, never the name: rename the real rental type to any word
select public.upsert_purchase_type('27004000-0000-0000-0000-0000000000f2', 'Plant', null, true, 2);
select lives_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b02') $$, 'AC-EQP-013 a plan is approved after the type is renamed');
select is((select count(*)::int from procurements p join equipment_plan_lines l on l.procurement_id = p.id
            where l.plan_id = '27004000-0000-0000-0000-000000000b02' and p.purchase_type_id = '27004000-0000-0000-0000-0000000000f2'), 2,
  'AC-EQP-013 the orders take the flagged type, not the decoy named Rental');

-- AC-EQP-016 purchase types retired or off: refused naming the cause, the plan untouched
select public.set_purchase_type_active('27004000-0000-0000-0000-0000000000f2', false);
select throws_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b03') $$, '55000',
  'EQP_NO_RENTAL_TYPE: purchase types must be on with an active rental type', 'AC-EQP-016 with the rental type retired approval is refused');
select public.set_purchase_type_active('27004000-0000-0000-0000-0000000000f2', true);
select public.set_purchase_types_enabled(false);
select throws_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b03') $$, '55000',
  'EQP_NO_RENTAL_TYPE: purchase types must be on with an active rental type', 'AC-EQP-016 with purchase types off approval is refused');
select public.set_purchase_types_enabled(true);
select is((select status || ':' || (select count(*) from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b03' and procurement_id is not null)::text
            from equipment_plans where id = '27004000-0000-0000-0000-000000000b03'), 'Submitted:0', 'AC-EQP-016 the plan stays Submitted with nothing created');

-- AC-EQP-012 all or nothing: the second line''s purchase id is already taken by someone else, so the approval is refused
-- naming the cause before anything is created
reset role;
insert into procurements (id, org_id, title, status, requested_by_id)
  select md5('eqplan:' || l.id::text)::uuid, l.org_id, 'taken id', 'Draft', '27004000-0000-0000-0000-0000000000a3'
    from equipment_plan_lines l where l.plan_id = '27004000-0000-0000-0000-000000000b04' order by l.date_from desc limit 1;
set local role authenticated;
select pg_temp._as('27004000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.approve_equipment_plan('27004000-0000-0000-0000-000000000b04') $$, '42501',
  'EQP_PID_TAKEN: one of this plan''s purchase references is already in use; save the line again in the Draft plan to pick a new one',
  'AC-EQP-012 when one line''s purchase reference is taken the approval is refused naming the cause');
select is((select status from equipment_plans where id = '27004000-0000-0000-0000-000000000b04'), 'Submitted', 'AC-EQP-012 the plan is still Submitted');
select is((select count(*)::int from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b04' and procurement_id is not null), 0, 'AC-EQP-012 no line is linked');
select is((select count(*)::int from procurements p where p.id in (select md5('eqplan:' || id::text)::uuid from equipment_plan_lines where plan_id = '27004000-0000-0000-0000-000000000b04')), 1,
  'AC-EQP-012 and the first line''s purchase was not left behind (only the pre-existing one exists)');

select * from finish();
rollback;
