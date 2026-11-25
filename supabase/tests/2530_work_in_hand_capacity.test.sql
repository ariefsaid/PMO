-- 2530_work_in_hand_capacity.test.sql — M8: monthly capacity setting on organizations and get_work_in_hand output.
-- Migration under test: 2530_work_in_hand_capacity.sql.
-- Spec: docs/specs/work-in-hand-capacity.spec.md (AC-M8-002, AC-M8-003).
-- Mutation check: widen organizations_update_work_in_hand_capacity to allow Project Manager, or drop the > 0 check constraint, and AC-M8-002 goes red.
begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, default_timezone) values
  ('25300000-0000-0000-0000-00000000010a', 'M8 Org',       'IDR', 'Asia/Jakarta'),
  ('25300000-0000-0000-0000-00000000010b', 'M8 Other Org', 'USD', 'UTC');

insert into auth.users (id, email) values
  ('25300000-0000-0000-0000-0000000001a1', 'm8-admin@example.com'),
  ('25300000-0000-0000-0000-0000000001a2', 'm8-pm@example.com'),
  ('25300000-0000-0000-0000-0000000001a3', 'm8-fin@example.com'),
  ('25300000-0000-0000-0000-0000000001a4', 'm8-exec@example.com'),
  ('25300000-0000-0000-0000-0000000001a5', 'm8-eng@example.com'),
  ('25300000-0000-0000-0000-0000000001a6', 'm8-off-adm@example.com'),
  ('25300000-0000-0000-0000-0000000001b1', 'm8-xorg-adm@example.com');

insert into profiles (id, org_id, full_name, email, role, status) values
  ('25300000-0000-0000-0000-0000000001a1', '25300000-0000-0000-0000-00000000010a', 'M8 Admin',   'm8-admin@example.com',    'Admin',           'active'),
  ('25300000-0000-0000-0000-0000000001a2', '25300000-0000-0000-0000-00000000010a', 'M8 PM',      'm8-pm@example.com',       'Project Manager', 'active'),
  ('25300000-0000-0000-0000-0000000001a3', '25300000-0000-0000-0000-00000000010a', 'M8 Fin',     'm8-fin@example.com',      'Finance',         'active'),
  ('25300000-0000-0000-0000-0000000001a4', '25300000-0000-0000-0000-00000000010a', 'M8 Exec',    'm8-exec@example.com',     'Executive',       'active'),
  ('25300000-0000-0000-0000-0000000001a5', '25300000-0000-0000-0000-00000000010a', 'M8 Eng',     'm8-eng@example.com',      'Engineer',        'active'),
  ('25300000-0000-0000-0000-0000000001a6', '25300000-0000-0000-0000-00000000010a', 'M8 Off Adm', 'm8-off-adm@example.com',  'Admin',           'disabled'),
  ('25300000-0000-0000-0000-0000000001b1', '25300000-0000-0000-0000-00000000010b', 'M8 XOrg',    'm8-xorg-adm@example.com', 'Admin',           'active');

insert into projects (id, org_id, name, status, contract_value, tax_treatment, tax_amount, currency, project_manager_id) values
  ('25300000-0000-0000-0000-000000000201', '25300000-0000-0000-0000-00000000010a', 'M8 IDR Project', 'Ongoing Project', 25000000, 'exclusive', 0, 'IDR', '25300000-0000-0000-0000-0000000001a2'),
  ('25300000-0000-0000-0000-000000000202', '25300000-0000-0000-0000-00000000010a', 'M8 USD Project', 'Ongoing Project', 900000,   'exclusive', 0, 'USD', null);

-- Verify policy shape and column grants as superuser before switching role.
select ok(
  (select q.qual = t.qual and q.with_check = t.with_check and q.roles = array['authenticated']::name[]
     from pg_policies q
     join pg_policies t on t.schemaname = q.schemaname and t.tablename = q.tablename
    where q.schemaname = 'public' and q.tablename = 'organizations'
      and q.policyname = 'organizations_update_work_in_hand_capacity'
      and t.policyname = 'organizations_update_tax_default'),
  'AC-M8-002 policy matches retained own-org active Admin predicate');

select ok(
  has_column_privilege('authenticated', 'organizations', 'work_in_hand_monthly_capacity', 'UPDATE')
  and not has_column_privilege('anon', 'organizations', 'work_in_hand_monthly_capacity', 'UPDATE'),
  'AC-M8-002 authenticated has column UPDATE grant; anon does not');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;
select pg_temp.act_as('25300000-0000-0000-0000-0000000001a1');

-- AC-M8-003: defaults to null before Admin sets it.
select is(
  (select work_in_hand_monthly_capacity from organizations where id = '25300000-0000-0000-0000-00000000010a'),
  null::numeric,
  'AC-M8-003 monthly capacity defaults to null');
select is(
  public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity',
  null::text,
  'AC-M8-003 get_work_in_hand returns null monthly_capacity when unset');

-- AC-M8-002: check constraint rejects zero and negative capacity.
select throws_ok(
  $$ update organizations set work_in_hand_monthly_capacity = 0 where id = '25300000-0000-0000-0000-00000000010a' $$,
  '23514', null, 'AC-M8-002 zero monthly capacity is rejected');
select throws_ok(
  $$ update organizations set work_in_hand_monthly_capacity = -100 where id = '25300000-0000-0000-0000-00000000010a' $$,
  '23514', null, 'AC-M8-002 negative monthly capacity is rejected');

-- AC-M8-002: Admin sets monthly capacity and writes an audit event.
with changed as (
  update organizations set work_in_hand_monthly_capacity = 2500000.00
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 1, 'AC-M8-002 active Admin updates monthly capacity');
select is(
  (select work_in_hand_monthly_capacity from organizations where id = '25300000-0000-0000-0000-00000000010a'),
  2500000.00,
  'AC-M8-002 saved monthly capacity persists');

-- AC-M8-002: Non-Admin roles, disabled Admin, and other-org Admin update 0 rows.
select pg_temp.act_as('25300000-0000-0000-0000-0000000001a2');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 Project Manager cannot update monthly capacity');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a3');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 Finance cannot update monthly capacity');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a4');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 Executive cannot update monthly capacity');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a5');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 Engineer cannot update monthly capacity');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a6');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 disabled Admin cannot update monthly capacity');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001b1');
with changed as (
  update organizations set work_in_hand_monthly_capacity = 100
   where id = '25300000-0000-0000-0000-00000000010a' returning id
)
select is((select count(*)::int from changed), 0, 'AC-M8-002 other-org Admin cannot update monthly capacity');

-- AC-M8-003: Admin, Executive, Finance, and PM receive monthly_capacity in get_work_in_hand; Engineer is refused.
select pg_temp.act_as('25300000-0000-0000-0000-0000000001a1');
select is(public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity', '2500000.00',
  'AC-M8-003 Admin reads monthly_capacity from get_work_in_hand');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a4');
select is(public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity', '2500000.00',
  'AC-M8-003 Executive reads monthly_capacity from get_work_in_hand');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a3');
select is(public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity', '2500000.00',
  'AC-M8-003 Finance reads monthly_capacity from get_work_in_hand');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a2');
select is(public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity', '2500000.00',
  'AC-M8-003 Project Manager reads monthly_capacity from get_work_in_hand');
select is(jsonb_array_length(public.get_work_in_hand('2026-12-10') -> 'contracts'), 1,
  'AC-M8-003 Project Manager still sees only assigned projects');

select pg_temp.act_as('25300000-0000-0000-0000-0000000001a5');
select throws_ok($$ select public.get_work_in_hand('2026-12-10') $$, '42501', 'not authorized',
  'AC-M8-003 Engineer is still refused');

-- AC-M8-002: Admin can clear monthly capacity back to null.
select pg_temp.act_as('25300000-0000-0000-0000-0000000001a1');
update organizations set work_in_hand_monthly_capacity = null where id = '25300000-0000-0000-0000-00000000010a';
select is(public.get_work_in_hand('2026-12-10') ->> 'monthly_capacity', null::text,
  'AC-M8-002 Admin clears monthly_capacity back to null');

reset role;
select is(
  (select count(*)::int from public.audit_events
    where action = 'org.setting.change'
      and org_id = '25300000-0000-0000-0000-00000000010a'
      and detail ->> 'setting' = 'organizations.work_in_hand_monthly_capacity'),
  2,
  'AC-M8-002 setting and clearing monthly capacity each write an audit event');

select * from finish();
rollback;
