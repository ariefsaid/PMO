begin;
select plan(5);

insert into organizations (id, name) values
  ('69000000-0000-0000-0000-000000000001', 'Participant org'),
  ('69000000-0000-0000-0000-000000000002', 'Other org');
insert into auth.users (id) values
  ('69000000-0000-0000-0000-000000000011'), ('69000000-0000-0000-0000-000000000012'),
  ('69000000-0000-0000-0000-000000000013'), ('69000000-0000-0000-0000-000000000014'),
  ('69000000-0000-0000-0000-000000000015');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('69000000-0000-0000-0000-000000000011', '69000000-0000-0000-0000-000000000001', 'Duplicate entries', 'p1@example.invalid', 'Project Manager', 'active'),
  ('69000000-0000-0000-0000-000000000012', '69000000-0000-0000-0000-000000000001', 'Confirmed link', 'p2@example.invalid', 'Project Manager', 'active'),
  ('69000000-0000-0000-0000-000000000013', '69000000-0000-0000-0000-000000000001', 'Inactive member', 'p3@example.invalid', 'Project Manager', 'disabled'),
  ('69000000-0000-0000-0000-000000000014', '69000000-0000-0000-0000-000000000001', 'No time recorded', 'p4@example.invalid', 'Project Manager', 'active'),
  ('69000000-0000-0000-0000-000000000015', '69000000-0000-0000-0000-000000000002', 'Other org member', 'p5@example.invalid', 'Project Manager', 'active');
insert into projects (id, org_id, name, status) values
  ('69000000-0000-0000-0000-000000000021', '69000000-0000-0000-0000-000000000001', 'P', 'Ongoing Project'),
  ('69000000-0000-0000-0000-000000000022', '69000000-0000-0000-0000-000000000002', 'Q', 'Ongoing Project');
insert into timesheets (id, org_id, user_id, week_start_date) values
  ('69000000-0000-0000-0000-000000000031', '69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000011', '2026-10-05'),
  ('69000000-0000-0000-0000-000000000032', '69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000011', '2026-10-12'),
  ('69000000-0000-0000-0000-000000000033', '69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000012', '2026-10-05'),
  ('69000000-0000-0000-0000-000000000034', '69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000013', '2026-10-05'),
  ('69000000-0000-0000-0000-000000000035', '69000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000015', '2026-10-05');
insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours) values
  ('69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000031', '69000000-0000-0000-0000-000000000021', '2026-10-05', 4),
  ('69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000031', '69000000-0000-0000-0000-000000000021', '2026-10-06', 4),
  ('69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000032', '69000000-0000-0000-0000-000000000021', '2026-10-12', 2),
  ('69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000033', '69000000-0000-0000-0000-000000000021', '2026-10-05', 3),
  ('69000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000034', '69000000-0000-0000-0000-000000000021', '2026-10-05', 3),
  ('69000000-0000-0000-0000-000000000002', '69000000-0000-0000-0000-000000000035', '69000000-0000-0000-0000-000000000022', '2026-10-05', 3);
insert into erp_employees (org_id, employee_number, profile_id, link_state) values
  ('69000000-0000-0000-0000-000000000001', 'HR-EMP-1', '69000000-0000-0000-0000-000000000012', 'confirmed');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(erp_setup_unlinked_participant_count('69000000-0000-0000-0000-000000000001'), 1,
  'counts a participant once despite several entries, skipping the confirmed link, the inactive member and the member with no time');
select is(erp_setup_unlinked_participant_count('69000000-0000-0000-0000-000000000002'), 1, 'is scoped to the requested org');
reset role;
update erp_employees set link_state = 'proposed' where profile_id = '69000000-0000-0000-0000-000000000012';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(erp_setup_unlinked_participant_count('69000000-0000-0000-0000-000000000001'), 2, 'a proposed (unconfirmed) link still counts as unlinked');
reset role;
update timesheet_entries set hours = 0 where timesheet_id = '69000000-0000-0000-0000-000000000031';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(erp_setup_unlinked_participant_count('69000000-0000-0000-0000-000000000001'), 2, 'zero-hour entries do not make a participant (the other entry of that member still does)');
reset role;
set local role authenticated;
select throws_ok($$ select erp_setup_unlinked_participant_count('69000000-0000-0000-0000-000000000001') $$, '42501', null, 'not callable by authenticated');

select * from finish();
rollback;
