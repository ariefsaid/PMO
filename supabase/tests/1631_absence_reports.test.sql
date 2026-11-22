-- 1631_absence_reports.test.sql — "I am not coming in today": one own report a day, the roster shows it, the roster keeper
-- is told, nobody reports for someone else. Mutation check: let report_absence take a person argument, or drop the
-- people.profile_id = auth.uid() join, and the own-person assertions fail.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency) values
  ('16310000-0000-0000-0000-00000000000a', 'ABS Org', 'IDR'),
  ('16310000-0000-0000-0000-00000000000b', 'ABS Other Org', 'IDR');
insert into auth.users (id, email) values
  ('16310000-0000-0000-0000-0000000000a1', 'abs-fc@example.com'),
  ('16310000-0000-0000-0000-0000000000a2', 'abs-worker@example.com'),
  ('16310000-0000-0000-0000-0000000000a3', 'abs-pm@example.com'),
  ('16310000-0000-0000-0000-0000000000b1', 'abs-xorg@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('16310000-0000-0000-0000-0000000000a1', '16310000-0000-0000-0000-00000000000a', 'ABS FC',     'abs-fc@example.com', 'Engineer', 'active'),
  ('16310000-0000-0000-0000-0000000000a2', '16310000-0000-0000-0000-00000000000a', 'ABS Worker', 'abs-worker@example.com', 'Engineer', 'active'),
  ('16310000-0000-0000-0000-0000000000a3', '16310000-0000-0000-0000-00000000000a', 'ABS PM',     'abs-pm@example.com', 'Project Manager', 'active'),
  ('16310000-0000-0000-0000-0000000000b1', '16310000-0000-0000-0000-00000000000b', 'ABS XOrg',   'abs-xorg@example.com', 'Admin', 'active');
create temp table abs_today as select public.equipment_org_today('16310000-0000-0000-0000-00000000000a') as d;
grant select on abs_today to authenticated;
insert into projects (id, org_id, name, status, project_manager_id) values
  ('16310000-0000-0000-0000-0000000000d1', '16310000-0000-0000-0000-00000000000a', 'ABS Site', 'Ongoing Project', '16310000-0000-0000-0000-0000000000a3');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('16310000-0000-0000-0000-000000000401', '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-0000000000d1', 'ABS WO', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('16310000-0000-0000-0000-000000000c01', '16310000-0000-0000-0000-00000000000a', 'AB-A', 'Crew', '16310000-0000-0000-0000-0000000000a1');
insert into people (id, org_id, kind, name, profile_id) values
  ('16310000-0000-0000-0000-000000000f01', '16310000-0000-0000-0000-00000000000a', 'own', 'Absent Worker', '16310000-0000-0000-0000-0000000000a2'),
  ('16310000-0000-0000-0000-000000000f02', '16310000-0000-0000-0000-00000000000a', 'vendor', 'Other Worker', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from)
  select '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000c01', v.x, a.d - 30
    from (values ('16310000-0000-0000-0000-000000000f01'::uuid), ('16310000-0000-0000-0000-000000000f02'::uuid)) v(x), abs_today a;
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from)
  select '16310000-0000-0000-0000-00000000000a', '16310000-0000-0000-0000-000000000401', '16310000-0000-0000-0000-000000000c01', d - 30 from abs_today;

select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$ select public.report_absence('sick', 'fever') $$, 'a worker reports themself absent');
select is((select count(*)::int from public.absence_reports), 1, 'the worker reads their own report');
select lives_ok($$ select public.report_absence('other', null) $$, 'reporting again the same day replaces, not duplicates');
select is((select reason from public.absence_reports), 'other', 'the latest report stands');
select throws_ok($$ select public.report_absence('holiday', null) $$, '22022', null, 'an unknown reason is refused');

-- The roster shows the report as reported-absent for the keeper; the person without a report has none.
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
select is((select m->'reported_absent'->>'reason'
             from public.work_order_roster('16310000-0000-0000-0000-000000000401', (select d from abs_today)) r,
                  jsonb_array_elements(r.members) m where m->>'worker_id' = '16310000-0000-0000-0000-000000000f01'),
          'other', 'the roster shows the reported absence');
select is((select count(*)::int
             from public.work_order_roster('16310000-0000-0000-0000-000000000401', (select d from abs_today)) r,
                  jsonb_array_elements(r.members) m where m ? 'reported_absent'),
          1, 'only the reporting person is marked');
select is((select count(*)::int from public.notifications
            where owner_id = '16310000-0000-0000-0000-0000000000a1' and title = 'A crew member reports absent today'),
          1, 'the crew''s field controller was told');

-- Another organisation reads nothing.
select set_config('request.jwt.claims', json_build_object('sub', '16310000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.absence_reports), 0, 'another organisation sees no report');

select * from finish();
rollback;
