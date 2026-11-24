-- 2042_people_team_role_rights.test.sql — HR Officer and HR Manager people rights (migration 2042).
-- Each right: the named job role is allowed; a person at the same access level with another job role is refused; a person with no job
-- role is judged by access level as before; a field account is refused. Kept rules: only an Admin marks a person as left; only an Admin
-- names themselves a manager (1930); the HR Officer approves no timesheet and ticks no checklist of their own.
-- MUTATION NOTES (remove the condition tagged in 2042; the named assertion must go red; restore):
--   mut:rr_hr_people ...... 'RR-HR-01 the HR Officer adds a person to the register'
--   mut:rr_hr_clear ....... 'RR-HR-05 the HR Officer ticks a worker''s cleared-for-site item'
--   mut:rr_hr_clear_own ... 'RR-HR-06 the HR Officer cannot tick their own cleared-for-site item'
--   mut:rr_hr_leave ....... 'RR-HR-08 the HR Officer enters leave for a worker'
--   mut:rr_hr_sheets ...... 'RR-HR-10 the HR Officer reads every timesheet and its entries'
--   mut:rr_hrm_types ...... 'RR-HR-12 the HR Manager adds a person document type' and 'RR-HR-14 ... sets the warning days'
begin;
create extension if not exists pgtap;
select plan(33);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled, leave_requests_enabled) values
  ('20420000-0000-0000-0000-00000000000a', 'RR HR Org', 'IDR', 'UTC', true, true);
insert into auth.users (id, email)
select ('20420000-0000-0000-0000-0000000000' || k)::uuid, 'rrhr-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('20420000-0000-0000-0000-0000000000a1', '20420000-0000-0000-0000-00000000000a', 'Admin',      'rrhr-a1@example.com', 'Admin', 'active', null),
  ('20420000-0000-0000-0000-0000000000a2', '20420000-0000-0000-0000-00000000000a', 'HR officer', 'rrhr-a2@example.com', 'Engineer', 'active', 'hr_officer'),
  ('20420000-0000-0000-0000-0000000000a3', '20420000-0000-0000-0000-00000000000a', 'HR manager', 'rrhr-a3@example.com', 'Project Manager', 'active', 'hr_manager'),
  ('20420000-0000-0000-0000-0000000000a4', '20420000-0000-0000-0000-00000000000a', 'Store',      'rrhr-a4@example.com', 'Engineer', 'active', 'storekeeper'),
  ('20420000-0000-0000-0000-0000000000a5', '20420000-0000-0000-0000-00000000000a', 'Engineer',   'rrhr-a5@example.com', 'Engineer', 'active', null),
  ('20420000-0000-0000-0000-0000000000a6', '20420000-0000-0000-0000-00000000000a', 'Field',      'rrhr-a6@example.com', 'Engineer', 'active', 'field_user'),
  ('20420000-0000-0000-0000-0000000000a7', '20420000-0000-0000-0000-00000000000a', 'PM',         'rrhr-a7@example.com', 'Project Manager', 'active', null),
  ('20420000-0000-0000-0000-0000000000a8', '20420000-0000-0000-0000-00000000000a', 'Quality mgr','rrhr-a8@example.com', 'Project Manager', 'active', 'quality_manager');
insert into people (id, org_id, code, name, profile_id) values
  ('20420000-0000-0000-0000-000000000051', '20420000-0000-0000-0000-00000000000a', 'W1', 'Worker one', null),
  ('20420000-0000-0000-0000-000000000052', '20420000-0000-0000-0000-00000000000a', 'W2', 'HR officer self', '20420000-0000-0000-0000-0000000000a2');
insert into clearance_items (id, org_id, name, is_required) values
  ('20420000-0000-0000-0000-000000000061', '20420000-0000-0000-0000-00000000000a', 'Site induction', true);
insert into leave_types (id, org_id, name) values
  ('20420000-0000-0000-0000-000000000071', '20420000-0000-0000-0000-00000000000a', 'Annual');
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('20420000-0000-0000-0000-000000000081', '20420000-0000-0000-0000-00000000000a', '20420000-0000-0000-0000-0000000000a5', '2026-11-16', 'Submitted');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('20420000-0000-0000-0000-000000000091', '20420000-0000-0000-0000-00000000000a', 'Site pass', 'person', false),
  ('20420000-0000-0000-0000-000000000092', '20420000-0000-0000-0000-00000000000a', 'Medical check', 'person', true);

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"20420000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"20420000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.person(p_name text) returns text language sql as $$
  select format('insert into people (code, name) values (%L, %L)', upper(replace(p_name, ' ', '')), p_name) $$;
create function pg_temp.tick(p_person text) returns text language sql as $$
  select format('insert into person_clearances (person_id, item_id, done_on) values (%L, %L, current_date)',
                '20420000-0000-0000-0000-0000000000' || p_person, '20420000-0000-0000-0000-000000000061') $$;
create function pg_temp.dtype(p_name text, p_applies text, p_medical boolean) returns text language sql as $$
  select format('insert into document_types (name, applies_to, is_medical) values (%L, %L, %L)', p_name, p_applies, p_medical) $$;

-- ── people register ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.person('Hired by HR')), 'ok', 'RR-HR-01 the HR Officer adds a person to the register');
select is(pg_temp.err('a2', $$update people set name = 'Worker one (welder)' where code = 'W1'$$), 'ok', 'RR-HR-01 and edits one');
select is((select name from people where code = 'W1'), 'Worker one (welder)', 'RR-HR-01 the edit is stored');
select is(pg_temp.err('a4', pg_temp.person('Hired by store')), '42501 new row violates row-level security policy for table "people"',
  'RR-HR-02 a Storekeeper at the same access level cannot add a person');
select is(pg_temp.err('a5', pg_temp.person('Hired by eng')), '42501 new row violates row-level security policy for table "people"',
  'RR-HR-02 an Engineer with no job role still cannot add a person');
select is(pg_temp.err('a6', pg_temp.person('Hired by field')), '42501 new row violates row-level security policy for table "people"',
  'RR-HR-02 a field account cannot add a person');
select is(pg_temp.err('a7', pg_temp.person('Hired by PM')), 'ok', 'RR-HR-02 a Project Manager with no job role still adds a person');
select is(pg_temp.err('a2', $$update people set archived_at = now() where code = 'W1'$$), '42501 only an Admin archives a person',
  'RR-HR-03 the HR Officer cannot mark a person as left');
select is(pg_temp.err('a2', $$update people set manager_id = '20420000-0000-0000-0000-0000000000a2' where code = 'W1'$$), '42501 PPL_MANAGER_SELF',
  'RR-HR-04 the HR Officer cannot name themselves a person''s manager (1930 kept)');

-- ── cleared-for-site checklist ───────────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a2', pg_temp.tick('51')), 'ok', 'RR-HR-05 the HR Officer ticks a worker''s cleared-for-site item');
select is(pg_temp.val('a2', 'select count(*)::text from person_clearances'), '1', 'RR-HR-05 and reads the checklist');
select is(pg_temp.err('a2', pg_temp.tick('52')), '42501 new row violates row-level security policy for table "person_clearances"',
  'RR-HR-06 the HR Officer cannot tick their own cleared-for-site item');
select is(pg_temp.err('a4', $$update person_clearances set note = 'x'$$ ), 'ok', 'RR-HR-07 (a Storekeeper''s update touches no row)');
select is((select note from person_clearances limit 1), null, 'RR-HR-07 a Storekeeper cannot change the checklist');
select is(pg_temp.val('a4', 'select count(*)::text from person_clearances'), '0', 'RR-HR-07 a Storekeeper reads no checklist');
select is(pg_temp.val('a5', 'select count(*)::text from person_clearances'), '0', 'RR-HR-07 an Engineer with no job role reads no checklist, as before');
select is(pg_temp.err('a6', pg_temp.tick('51')), '42501 new row violates row-level security policy for table "person_clearances"',
  'RR-HR-07 a field account cannot tick an item');

-- ── leave on behalf of a worker ──────────────────────────────────────────────────────────────────────────────────────────────────
select ok(pg_temp.val('a2', $$select string_agg(name, ',' order by name) from leave_requestable_people()$$) like '%Worker one%',
  'RR-HR-08 the HR Officer may pick any worker for a leave request');
select is(pg_temp.err('a2', $$select leave_request_submit('20420000-0000-0000-0000-000000000051', '20420000-0000-0000-0000-000000000071', current_date + 7, current_date + 8, 'family')$$),
  'ok', 'RR-HR-08 the HR Officer enters leave for a worker');
select is(pg_temp.err('a4', $$select leave_request_submit('20420000-0000-0000-0000-000000000051', '20420000-0000-0000-0000-000000000071', current_date + 20, current_date + 21, 'x')$$),
  '42501 LV_FORBIDDEN', 'RR-HR-09 a Storekeeper cannot enter leave for a worker');
select is(pg_temp.err('a5', $$select leave_request_submit('20420000-0000-0000-0000-000000000051', '20420000-0000-0000-0000-000000000071', current_date + 20, current_date + 21, 'x')$$),
  '42501 LV_FORBIDDEN', 'RR-HR-09 an Engineer with no job role still cannot');

-- ── timesheets: read to review, never approve ───────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.val('a2', 'select count(*)::text from timesheets'), '1', 'RR-HR-10 the HR Officer reads every timesheet and its entries');
select is(pg_temp.val('a4', 'select count(*)::text from timesheets'), '0', 'RR-HR-11 a Storekeeper reads no one else''s timesheet');
select is(pg_temp.val('a6', 'select count(*)::text from timesheets'), '0', 'RR-HR-11 a field account reads no one else''s timesheet');
select isnt(pg_temp.err('a2', $$select transition_timesheet('20420000-0000-0000-0000-000000000081', 'Approved', null)$$), 'ok',
  'RR-HR-11 the HR Officer cannot approve a timesheet');

-- ── document types and warning days ──────────────────────────────────────────────────────────────────────────────────────────────
select is(pg_temp.err('a3', pg_temp.dtype('Work permit', 'person', false)), 'ok', 'RR-HR-12 the HR Manager adds a person document type');
select is(pg_temp.err('a3', $$update document_types set notify_roles = array['Project Manager'] where name = 'Site pass'$$), 'ok', 'RR-HR-12 and sets its recipients');
select is((select notify_roles::text from document_types where name = 'Site pass'), '{"Project Manager"}', 'RR-HR-12 the recipients are stored');
select is(pg_temp.err('a3', pg_temp.dtype('Fitness', 'person', true)), '42501 new row violates row-level security policy for table "document_types"',
  'RR-HR-13 the HR Manager cannot add a medical type');
select is(pg_temp.err('a3', pg_temp.dtype('Crane cert', 'equipment', false)), '42501 new row violates row-level security policy for table "document_types"',
  'RR-HR-13 the HR Manager cannot add an equipment type');
select is(pg_temp.err('a8', pg_temp.dtype('QA pass', 'person', false)), '42501 new row violates row-level security policy for table "document_types"',
  'RR-HR-13 a Quality Manager at the same access level cannot add a type');
select is(pg_temp.err('a3', $$select set_document_warning_days(array[30, 7])$$), 'ok', 'RR-HR-14 the HR Manager sets the warning days');
select is(pg_temp.err('a7', $$select set_document_warning_days(array[30, 7])$$), '42501 only an Admin or the HR Manager sets the document warning days',
  'RR-HR-14 a Project Manager with no job role still cannot');

select * from finish();
rollback;
