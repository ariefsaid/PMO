-- safety_days.test.sql — #2596 daily safety records (docs/specs/daily-safety-records.spec.md).
-- Migrations under test: 1410..1414. AC-DSF-001..007, 009..013, 017. (AC-DSF-008/014/018 are unit tests; 015/016 e2e.)
begin;
create extension if not exists pgtap;
select plan(87);

-- ── fixtures (table owner) ───────────────────────────────────────────────────────────────────────
insert into organizations (id, name, default_currency, default_timezone) values
  ('25960000-0000-0000-0000-0000000000a1', 'SAF Org A', 'USD', 'Asia/Jakarta'),
  ('25960000-0000-0000-0000-0000000000a2', 'SAF Org B', 'USD', 'UTC');
-- safety records are on by default now; these cases start from organisations that switched them off
update organizations set safety_records_enabled = false where id in ('25960000-0000-0000-0000-0000000000a1','25960000-0000-0000-0000-0000000000a2');
insert into auth.users (id, email) values
  ('25960000-0000-0000-0000-0000000000b1', 'saf-admin@example.com'),
  ('25960000-0000-0000-0000-0000000000b2', 'saf-eng@example.com'),
  ('25960000-0000-0000-0000-0000000000b3', 'saf-finance@example.com'),
  ('25960000-0000-0000-0000-0000000000b4', 'saf-pm1@example.com'),
  ('25960000-0000-0000-0000-0000000000b5', 'saf-pm2@example.com'),
  ('25960000-0000-0000-0000-0000000000b6', 'saf-exec@example.com'),
  ('25960000-0000-0000-0000-0000000000b7', 'saf-b-eng@example.com'),
  ('25960000-0000-0000-0000-0000000000b8', 'saf-eng2@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25960000-0000-0000-0000-0000000000b1', '25960000-0000-0000-0000-0000000000a1', 'Saf Admin', 'saf-admin@example.com', 'Admin', 'active'),
  ('25960000-0000-0000-0000-0000000000b2', '25960000-0000-0000-0000-0000000000a1', 'Saf Eng', 'saf-eng@example.com', 'Engineer', 'active'),
  ('25960000-0000-0000-0000-0000000000b3', '25960000-0000-0000-0000-0000000000a1', 'Saf Finance', 'saf-finance@example.com', 'Finance', 'active'),
  ('25960000-0000-0000-0000-0000000000b4', '25960000-0000-0000-0000-0000000000a1', 'Saf PM1', 'saf-pm1@example.com', 'Project Manager', 'active'),
  ('25960000-0000-0000-0000-0000000000b5', '25960000-0000-0000-0000-0000000000a1', 'Saf PM2', 'saf-pm2@example.com', 'Project Manager', 'active'),
  ('25960000-0000-0000-0000-0000000000b6', '25960000-0000-0000-0000-0000000000a1', 'Saf Exec', 'saf-exec@example.com', 'Executive', 'active'),
  ('25960000-0000-0000-0000-0000000000b7', '25960000-0000-0000-0000-0000000000a2', 'Saf B Eng', 'saf-b-eng@example.com', 'Engineer', 'active'),
  ('25960000-0000-0000-0000-0000000000b8', '25960000-0000-0000-0000-0000000000a1', 'Saf Eng2', 'saf-eng2@example.com', 'Engineer', 'active');
insert into projects (id, org_id, name, status, currency, project_manager_id) values
  ('25960000-0000-0000-0000-0000000000c1', '25960000-0000-0000-0000-0000000000a1', 'Saf P1', 'Ongoing Project', 'USD', '25960000-0000-0000-0000-0000000000b4'),
  ('25960000-0000-0000-0000-0000000000c2', '25960000-0000-0000-0000-0000000000a1', 'Saf P2', 'Ongoing Project', 'USD', '25960000-0000-0000-0000-0000000000b5'),
  ('25960000-0000-0000-0000-0000000000c3', '25960000-0000-0000-0000-0000000000a1', 'Saf P3', 'Ongoing Project', 'USD', '25960000-0000-0000-0000-0000000000b4'),
  ('25960000-0000-0000-0000-0000000000c4', '25960000-0000-0000-0000-0000000000a1', 'Saf P4', 'Ongoing Project', 'USD', '25960000-0000-0000-0000-0000000000b4'),
  ('25960000-0000-0000-0000-0000000000c9', '25960000-0000-0000-0000-0000000000a2', 'Saf PB', 'Ongoing Project', 'USD', null);
insert into work_orders (id, org_id, project_id, title, status, order_value, tax_treatment, tax_amount) values
  ('25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c1', 'WO issued', 'Issued', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e2', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c1', 'WO draft', 'Draft', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e3', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c1', 'WO closed', 'Closed', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e4', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c4', 'WO rostered none', 'Issued', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e5', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c3', 'WO hours', 'Issued', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e6', '25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000c2', 'WO other project', 'Issued', 1000, 'exclusive', 0),
  ('25960000-0000-0000-0000-0000000000e9', '25960000-0000-0000-0000-0000000000a2', '25960000-0000-0000-0000-0000000000c9', 'WO B', 'Issued', 1000, 'exclusive', 0);
insert into crews (id, org_id, code, name) values
  ('25960000-0000-0000-0000-000000000c01', '25960000-0000-0000-0000-0000000000a1', 'SF-A', 'Saf Crew A'),
  ('25960000-0000-0000-0000-000000000c02', '25960000-0000-0000-0000-0000000000a1', 'SF-B', 'Saf Crew B');
insert into people (id, org_id, kind, name) values
  ('25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000a1', 'vendor', 'Saf Worker One'),
  ('25960000-0000-0000-0000-000000000f02', '25960000-0000-0000-0000-0000000000a1', 'vendor', 'Saf Worker Two'),
  ('25960000-0000-0000-0000-000000000f03', '25960000-0000-0000-0000-0000000000a1', 'vendor', 'Saf Worker Three'),
  ('25960000-0000-0000-0000-000000000f09', '25960000-0000-0000-0000-0000000000a1', 'vendor', 'Saf Not Rostered');
insert into crew_members (org_id, crew_id, worker_id, valid_from) values
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000c01', '25960000-0000-0000-0000-000000000f01', '2026-01-01'),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000c01', '25960000-0000-0000-0000-000000000f02', '2026-01-01'),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000c01', '25960000-0000-0000-0000-000000000f03', '2026-01-01');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-000000000c01', '2026-01-01'),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-0000000000e4', '25960000-0000-0000-0000-000000000c02', '2026-01-01');
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;

-- ── off until switched on; Admin-only switch ──────────────────────────────────────────────────────
select is((select safety_records_enabled from organizations where id = '25960000-0000-0000-0000-0000000000a1'), false, 'the switch reads off for an organisation that switched it off');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(public.safety_records_enabled(), false, 'an organisation that has not switched safety records on sees them off');
select throws_ok($$select public.set_safety_records_enabled(true)$$, '42501', null, 'AC-DSF-017 an Engineer cannot switch safety records on');
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-10')$$,
  '42501', null, 'AC-DSF-018 with the switch off no safety day can be created');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select lives_ok($$select public.set_safety_records_enabled(true)$$, 'an Admin switches safety records on');

-- ── AC-DSF-017: the lists ─────────────────────────────────────────────────────────────────────────
insert into safety_list_items (kind, label, position) values
  ('check_type', 'General fitness', 1), ('check_type', 'Retired check', 2), ('permit_type', 'Hot work', 1),
  ('checklist_item', 'Area barricaded', 1), ('checklist_item', 'Tools inspected', 2);
select is((select count(*)::int from safety_list_items), 5, 'AC-DSF-017 an Admin adds list entries');
update safety_list_items set label = 'General fitness check' where label = 'General fitness';
update safety_list_items set archived_at = now() where label = 'Retired check';
select is((select count(*)::int from safety_list_items where label = 'General fitness check'), 1, 'AC-DSF-017 an Admin renames an entry');
select throws_ok($$insert into safety_list_items (kind, label) values ('permit_type', 'hot work')$$, '23505', null,
  'AC-DSF-017 a duplicate entry (any letter case) is refused');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$insert into safety_list_items (kind, label) values ('permit_type', 'Mine')$$, '42501', null, 'AC-DSF-017 an Engineer cannot add an entry');
select is((select count(*)::int from safety_list_items), 5, 'AC-DSF-017 an Engineer reads the whole list');
update safety_list_items set label = 'Hacked';
select is((select count(*)::int from safety_list_items where label = 'Hacked'), 0, 'AC-DSF-017 an Engineer cannot rename an entry');

-- ── AC-DSF-001 / 006: creating a day ──────────────────────────────────────────────────────────────
insert into ids select 'd1', id from (select id from safety_days limit 0) x;  -- keep the temp table shape
insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-10');
insert into ids select 'd1', id from safety_days where work_date = '2026-03-10';
select is((select count(*)::int from safety_checklist_answers where day_id = (select v from ids where k = 'd1')), 2,
  'AC-DSF-017 the active checklist is copied onto a new day');
select is((select project_id from safety_days where id = (select v from ids where k = 'd1')), '25960000-0000-0000-0000-0000000000c1'::uuid,
  'AC-DSF-001 the project is derived from the work order');
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-10')$$,
  '23505', null, 'AC-DSF-001 a second original for the same work order and date is refused');
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e2', '2026-03-10')$$,
  '23514', 'work order is not issued', 'AC-DSF-001 a Draft work order is refused');
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e3', '2026-03-10')$$,
  '23514', 'work order is not issued', 'AC-DSF-001 a Closed work order is refused');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-11')$$,
  '42501', null, 'AC-DSF-006 a Finance user (read-only role) cannot create a safety day');
select is((select count(*)::int from safety_days), 1, 'AC-DSF-006 a Finance user (read-only role) reads the day (counts)');
select is((select count(*)::int from safety_fitness_checks), 0, 'AC-DSF-006 a Finance user (read-only role) sees no worker names');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-11')$$,
  '42501', null, 'AC-DSF-006 another project''s Project Manager cannot create a day');
select lives_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e6', '2026-03-11')$$,
  'AC-DSF-006 a Project Manager creates a day on their own project');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($$insert into safety_days (work_order_id, work_date) values ('25960000-0000-0000-0000-0000000000e1', '2026-03-12')$$,
  'AC-DSF-006 the project''s Project Manager creates a day');

-- ── the parts (as the Engineer, author of d1) ────────────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$insert into safety_fitness_checks (day_id, worker_id, result) select v, '25960000-0000-0000-0000-000000000f09', 'fit' from ids where k = 'd1'$$,
  '23514', 'worker is not on the work order roster for this date', 'AC-DSF-002 a worker not on the roster is refused');
select throws_ok($$insert into safety_fitness_checks (day_id, worker_id, result) select v, '25960000-0000-0000-0000-000000000f01', 'not_fit' from ids where k = 'd1'$$,
  '23514', null, 'a not-fit result needs a note');
select throws_ok($$insert into safety_fitness_checks (day_id, worker_id, check_type_id, result)
  select (select v from ids where k = 'd1'), '25960000-0000-0000-0000-000000000f01', id, 'fit' from safety_list_items where label = 'Retired check'$$,
  '23514', 'not an active entry of this list', 'AC-DSF-017 an archived entry cannot be picked on a new check');
insert into safety_fitness_checks (day_id, worker_id, check_type_id, result)
  select (select v from ids where k = 'd1'), '25960000-0000-0000-0000-000000000f01', id, 'fit' from safety_list_items where label = 'General fitness check';
insert into safety_fitness_checks (day_id, visitor_name, result) select v, 'A Visitor', 'fit' from ids where k = 'd1';
select is((select count(*)::int from safety_fitness_checks), 2, 'AC-DSF-002 a rostered worker and a named visitor are accepted');

select throws_ok($$select public.safety_save_talk((select v from ids where k = 'd1'), 'Lifting', 'Foreman', now(), '[]'::jsonb)$$,
  '23514', 'a toolbox talk needs at least one attendee', 'AC-DSF-002 a talk with no attendee is refused');
select throws_ok($$select public.safety_save_talk((select v from ids where k = 'd1'), 'Lifting', 'Foreman', now(),
  jsonb_build_array(jsonb_build_object('worker_id', '25960000-0000-0000-0000-000000000f09')))$$,
  '23514', 'worker is not on the work order roster for this date', 'AC-DSF-002 an attendee not on the roster is refused');
select is((select count(*)::int from safety_toolbox_talks), 0, 'AC-DSF-002 a refused talk leaves nothing behind');
insert into ids select 't1', public.safety_save_talk((select v from ids where k = 'd1'), 'Lifting', 'Foreman', now(),
  jsonb_build_array(jsonb_build_object('worker_id', '25960000-0000-0000-0000-000000000f01'), jsonb_build_object('visitor_name', 'A Visitor')));
select is((select count(*)::int from safety_toolbox_attendees), 2, 'a talk saves with a rostered attendee and a visitor');

select throws_ok($$insert into safety_permits (day_id, permit_number, type_id, valid_from, valid_to)
  select (select v from ids where k = 'd1'), 'P-1', id, '2026-03-10 10:00+00', '2026-03-10 08:00+00' from safety_list_items where label = 'Hot work'$$,
  '23514', null, 'AC-DSF-003 a permit valid-to before valid-from is refused');
insert into safety_permits (day_id, permit_number, type_id, valid_from, valid_to)
  select (select v from ids where k = 'd1'), 'P-1', id, '2026-03-10 08:00+00', '2026-03-10 16:00+00' from safety_list_items where label = 'Hot work';
select is((select count(*)::int from safety_permits), 1, 'AC-DSF-003 a valid permit saves');

-- photo: the object must exist, in the day's own folder
select throws_ok($$insert into safety_toolbox_photos (id, day_id, talk_id, file_path)
  select '25960000-0000-0000-0000-000000000a01', (select v from ids where k = 'd1'), (select v from ids where k = 't1'),
         '25960000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'd1') || '/25960000-0000-0000-0000-000000000a01/none.png'$$,
  '42501', null, 'AC-DSF-007 a photo row cannot claim an absent object');
reset role;
insert into storage.objects (bucket_id, name, owner)
  select 'safety-photos', '25960000-0000-0000-0000-0000000000a1/' || v || '/25960000-0000-0000-0000-000000000a01/talk.png', '25960000-0000-0000-0000-0000000000b2'
    from ids where k = 'd1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
insert into safety_toolbox_photos (id, day_id, talk_id, file_path)
  select '25960000-0000-0000-0000-000000000a01', (select v from ids where k = 'd1'), (select v from ids where k = 't1'),
         '25960000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'd1') || '/25960000-0000-0000-0000-000000000a01/talk.png';
select is((select count(*)::int from safety_toolbox_photos), 1, 'the attendance photo saves against the talk');

-- ── completeness derivation (server side of AC-DSF-008) ─────────────────────────────────────────────
reset role;
insert into attendance_days (org_id, worker_id, work_order_id, project_id, work_date, status, hours, source) values
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000c1', '2026-03-10', 'present', 8, 'manual_correction'),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f02', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000c1', '2026-03-10', 'present', 8, 'manual_correction');
select is((select public.safety_day_missing((select v from ids where k = 'd1'))), array['checklist', 'fitness_check']::text[],
  'AC-DSF-008 the unanswered checklist and the second present worker without a fitness check are reported missing');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
update safety_checklist_answers set answer = 'yes' where day_id = (select v from ids where k = 'd1');
insert into safety_fitness_checks (day_id, worker_id, result) select v, '25960000-0000-0000-0000-000000000f02', 'fit' from ids where k = 'd1';
reset role;
select is((select public.safety_day_missing((select v from ids where k = 'd1'))), '{}'::text[], 'AC-DSF-008 nothing is missing once every part is in');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
update safety_checklist_answers set answer = 'no' where id = (select id from safety_checklist_answers where day_id = (select v from ids where k = 'd1') order by position limit 1);

-- ── submit and lock (AC-DSF-004) ────────────────────────────────────────────────────────────────────
select throws_ok($$select public.submit_safety_day((select v from ids where k = 'd1'))$$, '23514', 'a checklist item answered no needs a note', 'a no without a note blocks submit');
update safety_checklist_answers set note = 'Fixed on site' where answer = 'no';
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select throws_ok($$select public.submit_safety_day((select v from ids where k = 'd1'))$$, '42501', 'only the author submits a safety day', 'AC-DSF-004 only the author submits');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok($$select public.submit_safety_day((select v from ids where k = 'd1'))$$, 'AC-DSF-004 the author submits');
select is((select status from safety_days where id = (select v from ids where k = 'd1')), 'locked', 'AC-DSF-004 submitting locks the day');

update safety_fitness_checks set result = 'not_checked' where day_id = (select v from ids where k = 'd1');
select is((select count(*)::int from safety_fitness_checks where result = 'not_checked'), 0, 'AC-DSF-004 an enterer cannot edit a locked day (no row changes)');
delete from safety_permits where day_id = (select v from ids where k = 'd1');
select is((select count(*)::int from safety_permits), 1, 'AC-DSF-004 an enterer cannot delete from a locked day');
reset role;   -- the guard itself, independent of RLS (table owner)
select throws_ok($$update safety_fitness_checks set result = 'not_checked' where day_id = (select v from ids where k = 'd1')$$,
  '23514', 'a locked safety day cannot be changed', 'AC-DSF-004 the locking guard refuses an edit of a locked day');
select throws_ok($$delete from safety_permits where day_id = (select v from ids where k = 'd1')$$,
  '23514', 'a locked safety day cannot be changed', 'AC-DSF-004 the locking guard refuses a delete from a locked day');
select throws_ok($$update safety_days set status = 'draft', submitted_at = null where id = (select v from ids where k = 'd1')$$,
  '23514', 'a locked safety day cannot be changed', 'AC-DSF-004 a locked day cannot be reopened');

-- ── correction (AC-DSF-004) ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b5","role":"authenticated"}';
select throws_ok($$select public.correct_safety_day((select v from ids where k = 'd1'), 'x')$$, '42501', null, 'AC-DSF-006 another project''s Project Manager cannot correct a day');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$select public.correct_safety_day((select v from ids where k = 'd1'), '  ')$$, '23514', 'a correction needs a reason', 'a correction needs a reason');
insert into ids select 'd1v2', public.correct_safety_day((select v from ids where k = 'd1'), 'Wrong checklist answer');
select is((select supersedes_id from safety_days where id = (select v from ids where k = 'd1v2')), (select v from ids where k = 'd1'), 'AC-DSF-004 version 2 names version 1');
select is((select version from safety_days where id = (select v from ids where k = 'd1v2')), 2, 'AC-DSF-004 the correction is version 2');
select is((select status from safety_days where id = (select v from ids where k = 'd1')), 'locked', 'AC-DSF-004 version 1 stays locked and readable');
select is((select count(*)::int from safety_fitness_checks where day_id = (select v from ids where k = 'd1v2')), 3, 'the correction carries the parts forward');
select throws_ok($$select public.correct_safety_day((select v from ids where k = 'd1'), 'again')$$, '23505', null, 'a day is corrected once; the correction is what changes next');
select lives_ok($$update safety_fitness_checks set result = 'fit', note = null where day_id = (select v from ids where k = 'd1v2') and visitor_name is not null$$, 'the correction is editable while a draft');

-- ── AC-DSF-005: the safety officer's entry on a locked day ──────────────────────────────────────────
select lives_ok($$insert into safety_officer_entries (day_id, body, near_misses, observations) select v, 'Two near misses at the laydown area', 2, 3 from ids where k = 'd1'$$,
  'AC-DSF-005 an entry is added to a locked day');
select is((select author_id from safety_officer_entries limit 1), '25960000-0000-0000-0000-0000000000b2'::uuid, 'AC-DSF-005 the entry is signed by its writer');
select is((select count(*)::int from safety_fitness_checks where day_id = (select v from ids where k = 'd1')), 3, 'AC-DSF-005 the locked parts are unchanged');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select throws_ok($$insert into safety_officer_entries (day_id, body) select v, 'x' from ids where k = 'd1'$$, '42501', null, 'AC-DSF-006 a Finance user (read-only role) cannot add an officer entry');
reset role;
select throws_ok($$update safety_officer_entries set body = 'edited'$$, '23514', 'a safety officer entry is never changed', 'an officer entry is never edited');

-- ── AC-DSF-007: storage and tenancy ──────────────────────────────────────────────────────────────────
select is((select (public = false and file_size_limit = 10485760 and allowed_mime_types @> array['image/jpeg'] and not (allowed_mime_types @> array['application/pdf']))
             from storage.buckets where id = 'safety-photos'), true, 'AC-DSF-007 the bucket is private, 10 MB, images only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'safety-photos'), 1, 'AC-DSF-007 an Engineer of the organisation reads the photo object');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'safety-photos'), 0, 'AC-DSF-007 a Finance user (read-only role) cannot read the photo (OD-DSF-6)');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'safety-photos'), 0, 'AC-DSF-007 a member of another organisation cannot read the photo');
select is((select count(*)::int from safety_toolbox_photos), 0, 'AC-DSF-007 nor the photo row');
select throws_ok($$insert into storage.objects (bucket_id, name, owner) values ('safety-photos', '25960000-0000-0000-0000-0000000000a1/' || (select v from ids where k = 'd1') || '/x/y.png', auth.uid())$$,
  '42501', null, 'AC-DSF-007 another organisation cannot write into this organisation''s folder');

-- ── lost-time marker (OD-DSF-3) ───────────────────────────────────────────────────────────────────
reset role;
insert into incident_reports (id, org_id, incident_date, type, severity, status, project_id, assignee_id) values
  ('25960000-0000-0000-0000-0000000000d1', '25960000-0000-0000-0000-0000000000a1', '2026-03-10', 'Injury', 'Low', 'Open', '25960000-0000-0000-0000-0000000000c3', '25960000-0000-0000-0000-0000000000b2');
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ok($$update incident_reports set lost_time = true where id = '25960000-0000-0000-0000-0000000000d1'$$, '42501', null, 'OD-DSF-3 an assignee cannot classify an incident lost-time');
select throws_ok($$insert into incident_reports (incident_date, type, severity, lost_time) values ('2026-03-10', 'Injury', 'Low', true)$$, '42501', null, 'OD-DSF-3 nor set it when raising one');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($$update incident_reports set lost_time = true where id = '25960000-0000-0000-0000-0000000000d1'$$, 'OD-DSF-3 a Project Manager classifies it');
reset role;
update incident_reports set lost_time = false where id = '25960000-0000-0000-0000-0000000000d1';

-- ── AC-DSF-009 / 010 / 011 / 012 / 013: the lists and the summary ────────────────────────────────────
insert into attendance_days (org_id, worker_id, work_order_id, project_id, work_date, status, hours, overtime_hours, source, locked_at) values
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000e5', '25960000-0000-0000-0000-0000000000c3', '2026-03-10', 'present', 8, 2, 'manual_correction', now()),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000e5', '25960000-0000-0000-0000-0000000000c3', '2026-03-11', 'present', 8, 2, 'manual_correction', now()),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000e5', '25960000-0000-0000-0000-0000000000c3', '2026-04-01', 'present', 8, 0, 'manual_correction', now()),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f01', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000c1', '2026-03-20', 'present', 8, 0, 'manual_correction', null),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f02', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000c1', '2026-03-20', 'present', 8, 0, 'manual_correction', null),
  ('25960000-0000-0000-0000-0000000000a1', '25960000-0000-0000-0000-000000000f03', '25960000-0000-0000-0000-0000000000e1', '25960000-0000-0000-0000-0000000000c1', '2026-03-20', 'present', 8, 0, 'manual_correction', null);
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((select (select count(*) from public.safety_work_order_days('25960000-0000-0000-0000-0000000000e1', '2026-03-01', '2026-03-31') x
                    where x.work_date = '2026-03-20' and x.workers_present = 3 and x.day_id is null and x.missing = array['safety_record']::text[] and not x.complete)::int),
  1, 'AC-DSF-009 three workers present and no safety day: the date is listed as worked without a safety record');
select is((select complete from public.safety_work_order_days('25960000-0000-0000-0000-0000000000e1', '2026-03-01', '2026-03-31') where work_date = '2026-03-10'),
  false, 'AC-DSF-008 a locked day with the corrected version still open is not complete');
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c1', '2026-03-01') ->> 'days_without_record')::int, 1,
  'AC-DSF-009 the summary counts the date without a locked record');
select is(jsonb_array_length(public.get_safety_summary_detail('days_without_record', '25960000-0000-0000-0000-0000000000c1', '2026-03-01')), 1,
  'AC-DSF-009 and the drill-down lists exactly that date');

-- AC-DSF-010: P3, two locked days of 8 + 2 hours; a lost-time incident dated on the first day
reset role;
select set_config('request.jwt.claims', '', true);
update incident_reports set lost_time = true where id = '25960000-0000-0000-0000-0000000000d1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c3', '2026-03-01') ->> 'worked_minutes')::int, 1200,
  'AC-DSF-010 worked hours in the month are 20');
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c3', '2026-03-01') ->> 'safe_minutes')::int, 600,
  'AC-DSF-010 safe hours are the 10 after the incident day');
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c3', '2026-03-01') ->> 'lost_time_incidents')::int, 1, 'AC-DSF-010 the lost-time incident is counted');
select is(jsonb_array_length(public.get_safety_summary_detail('lost_time_incidents', '25960000-0000-0000-0000-0000000000c3', '2026-03-01')), 1,
  'AC-DSF-010 and listed behind its count');

-- AC-DSF-011: the month is the organisation-local month
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c3', '2026-04-15') ->> 'worked_minutes')::int, 480,
  'AC-DSF-011 an event on the first local day of April belongs to April, not March');
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c3', null) ->> 'month')::date,
  public.org_current_month('Asia/Jakarta', now()), 'AC-DSF-011 the default month is the organisation''s local month (UTC+7), not the server''s');
select is(public.get_safety_summary(null, '2026-03-20') ->> 'timezone', 'Asia/Jakarta', 'AC-DSF-011 the summary names the organisation timezone');

-- AC-DSF-012: a rostered work order with no locked or approved attendance
select is(public.get_safety_summary('25960000-0000-0000-0000-0000000000c4', '2026-03-01') -> 'worked_minutes', 'null'::jsonb, 'AC-DSF-012 worked hours are hidden, not 0');
select is(public.get_safety_summary('25960000-0000-0000-0000-0000000000c4', '2026-03-01') -> 'safe_minutes', 'null'::jsonb, 'AC-DSF-012 safe hours are hidden, not 0');
select ok(public.get_safety_summary('25960000-0000-0000-0000-0000000000c4', '2026-03-01') -> 'hidden' ->> 'worked_minutes' is not null, 'AC-DSF-012 the reason is given');

-- AC-DSF-013: tenancy
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b7","role":"authenticated"}';
select is(public.get_safety_summary(null, '2026-03-01') -> 'worked_minutes', 'null'::jsonb, 'AC-DSF-013 another organisation sees none of these hours');
select is((public.get_safety_summary(null, '2026-03-01') ->> 'days_without_record')::int, 0, 'AC-DSF-013 nor these days');
select throws_ok($$select public.get_safety_summary('25960000-0000-0000-0000-0000000000c1', '2026-03-01')$$, '42501', null, 'AC-DSF-013 nor ask for this organisation''s project');
select is((select count(*)::int from safety_days), 0, 'AC-DSF-013 nor read its days');
set local request.jwt.claims = '{"sub":"25960000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is((public.get_safety_summary('25960000-0000-0000-0000-0000000000c1', '2026-03-01') ->> 'toolbox_talks')::int, 0, 'a Finance user (read-only role) reads the counts (the corrected day is a draft)');

-- the history of the day (FR-DSF-017)
reset role;
select is((select count(*)::int from record_changes where entity_type = 'safety_day' and entity_id = (select v from ids where k = 'd1')), 2,
  'FR-DSF-017 the day''s creation and its submission are in record history');

select * from finish();
rollback;
