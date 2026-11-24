-- 2005_loaned_worker_visible_to_host_foreman.test.sql — the foreman of the host crew sees the loan (so the worker is on the phone roster);
-- a foreman with no part in the loan sees no loan row.
begin;
select plan(4);

insert into organizations (id, name, default_currency, built_in_roles_enabled) values ('20050000-0000-0000-0000-00000000000a', 'LHF Org', 'IDR', true);
insert into auth.users (id, email) values
  ('20050000-0000-0000-0000-0000000000a1', 'lhf-admin@example.com'), ('20050000-0000-0000-0000-0000000000a2', 'lhf-host@example.com'),
  ('20050000-0000-0000-0000-0000000000a3', 'lhf-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20050000-0000-0000-0000-0000000000a1', '20050000-0000-0000-0000-00000000000a', 'LHF Admin', 'lhf-admin@example.com', 'Admin', 'active', null),
  ('20050000-0000-0000-0000-0000000000a2', '20050000-0000-0000-0000-00000000000a', 'LHF Host Foreman', 'lhf-host@example.com', 'Engineer', 'active', 'foreman'),
  ('20050000-0000-0000-0000-0000000000a3', '20050000-0000-0000-0000-00000000000a', 'LHF Other Foreman', 'lhf-other@example.com', 'Engineer', 'active', 'foreman');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('20050000-0000-0000-0000-0000000000d1', '20050000-0000-0000-0000-00000000000a', 'LHF Site', 'Ongoing Project', '20050000-0000-0000-0000-0000000000a1');
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('20050000-0000-0000-0000-000000000402', '20050000-0000-0000-0000-00000000000a', '20050000-0000-0000-0000-0000000000d1', 'LHF WO host', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name, field_controller_id) values
  ('20050000-0000-0000-0000-000000000c01', '20050000-0000-0000-0000-00000000000a', 'LH-A', 'Home crew', '20050000-0000-0000-0000-0000000000a3'),
  ('20050000-0000-0000-0000-000000000c02', '20050000-0000-0000-0000-00000000000a', 'LH-B', 'Host crew', '20050000-0000-0000-0000-0000000000a2');
insert into people (id, org_id, kind, name, profile_id) values
  ('20050000-0000-0000-0000-000000000f01', '20050000-0000-0000-0000-00000000000a', 'vendor', 'Lent Worker', null);
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('20050000-0000-0000-0000-00000000000a', '20050000-0000-0000-0000-000000000c01', '20050000-0000-0000-0000-000000000f01', current_date - 40);
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('20050000-0000-0000-0000-00000000000a', '20050000-0000-0000-0000-000000000402', '20050000-0000-0000-0000-000000000c02', current_date - 40);
insert into crew_loans (org_id, worker_id, home_crew_id, host_crew_id, valid_from, valid_to) values
  ('20050000-0000-0000-0000-00000000000a', '20050000-0000-0000-0000-000000000f01',
   '20050000-0000-0000-0000-000000000c01', '20050000-0000-0000-0000-000000000c02', current_date - 1, current_date + 1);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '20050000-0000-0000-0000-0000000000a2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.crew_loans), 1, 'the host crew''s foreman reads the loan into their crew');
select is((select count(*)::int from public.work_order_roster('20050000-0000-0000-0000-000000000402', public.equipment_org_today('20050000-0000-0000-0000-00000000000a')) r
            where r.members @> '[{"worker_id": "20050000-0000-0000-0000-000000000f01"}]'::jsonb), 1, 'so the lent worker is on the host foreman''s roster today');

select set_config('request.jwt.claims', json_build_object('sub', '20050000-0000-0000-0000-0000000000a3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.crew_loans where host_crew_id = '20050000-0000-0000-0000-000000000c02'), 0, 'the foreman of the home crew does not read the host crew''s loan row');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '20050000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from public.crew_loans), 1, 'a full account reads loans as before');

select * from finish();
rollback;
