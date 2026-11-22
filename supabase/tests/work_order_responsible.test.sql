-- work_order_responsible.test.sql — a work order's responsible person (1860; spec docs/specs/usage-warning.spec.md FR-UW-010..012).
-- AC-UW-013 default null, set and cleared by Admin/PM · AC-UW-014 a role that may not edit work orders is refused ·
-- AC-UW-015 a person of another organisation or a disabled member is refused · AC-UW-016 another organisation's work order is not found.
-- Mutation checks (break the marked line in 1860, expect the named AC red, restore): mut:rsp_role (014) · mut:rsp_same_org (015) · mut:rsp_org (016).
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values
  ('18600000-0000-0000-0000-00000000000a', 'RSP Org', 'IDR', 'UTC'), ('18600000-0000-0000-0000-00000000000b', 'RSP Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('18600000-0000-0000-0000-0000000000a1', 'rsp-admin@example.com'), ('18600000-0000-0000-0000-0000000000a2', 'rsp-eng@example.com'),
  ('18600000-0000-0000-0000-0000000000a3', 'rsp-pm@example.com'), ('18600000-0000-0000-0000-0000000000a4', 'rsp-off@example.com'),
  ('18600000-0000-0000-0000-0000000000a5', 'rsp-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('18600000-0000-0000-0000-0000000000a1', '18600000-0000-0000-0000-00000000000a', 'RSP Admin', 'rsp-admin@example.com', 'Admin', 'active'),
  ('18600000-0000-0000-0000-0000000000a2', '18600000-0000-0000-0000-00000000000a', 'RSP Eng', 'rsp-eng@example.com', 'Engineer', 'active'),
  ('18600000-0000-0000-0000-0000000000a3', '18600000-0000-0000-0000-00000000000a', 'RSP PM', 'rsp-pm@example.com', 'Project Manager', 'active'),
  ('18600000-0000-0000-0000-0000000000a4', '18600000-0000-0000-0000-00000000000a', 'RSP Off', 'rsp-off@example.com', 'Engineer', 'disabled'),
  ('18600000-0000-0000-0000-0000000000a5', '18600000-0000-0000-0000-00000000000b', 'RSP Other', 'rsp-other@example.com', 'Admin', 'active');
insert into projects (id, org_id, name, status) values
  ('18600000-0000-0000-0000-0000000000d1', '18600000-0000-0000-0000-00000000000a', 'RSP Site', 'Ongoing Project');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-00000000000a', '18600000-0000-0000-0000-0000000000d1', 'RSP WO', 'Issued', 10000, 'exclusive', 0);

create or replace function pg_temp._as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp._as(uuid) to authenticated;

select is((select responsible_person_id from public.work_orders where id = '18600000-0000-0000-0000-000000001401'), null::uuid, 'AC-UW-013 the default is no responsible person');
set local role authenticated;
select pg_temp._as('18600000-0000-0000-0000-0000000000a3');
select lives_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-0000000000a2') $$, 'AC-UW-013 a project manager sets the engineer');
select is((select responsible_person_id from public.work_orders where id = '18600000-0000-0000-0000-000000001401'), '18600000-0000-0000-0000-0000000000a2'::uuid, 'AC-UW-013 it is stored');
select pg_temp._as('18600000-0000-0000-0000-0000000000a1');
select lives_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', null) $$, 'AC-UW-013 an Admin clears it');
select pg_temp._as('18600000-0000-0000-0000-0000000000a2');
select throws_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-0000000000a2') $$, '42501', null, 'AC-UW-014 an Engineer cannot set it');
select pg_temp._as('18600000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-0000000000a5') $$, '23514', null, 'AC-UW-015 a person of another organisation is refused');
select throws_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-0000000000a4') $$, '23514', null, 'AC-UW-015 a disabled member is refused');
select pg_temp._as('18600000-0000-0000-0000-0000000000a5');
select throws_ok($$ select public.set_work_order_responsible_person('18600000-0000-0000-0000-000000001401', '18600000-0000-0000-0000-0000000000a5') $$, 'P0002', null, 'AC-UW-016 another organisation''s work order is not found');
reset role;
select is((select responsible_person_id from public.work_orders where id = '18600000-0000-0000-0000-000000001401'), null::uuid, 'AC-UW-016 nothing changed');
select * from finish();
rollback;
