-- timesheet_transition_map.test.sql — AC-900 (re-homed from the deleted isLegalTimesheetTransition
-- TS helper, #1710). The transition map is ENFORCED by the shipped security-definer RPC
-- transition_timesheet (0180 body — the final re-creation; map carried verbatim from 0161), so its
-- owning test is pgTAP:
-- Draft→Submitted, Submitted→Approved, Submitted→Rejected, Rejected→Draft and the Slice-A edge
-- Approved→Draft are accepted; Draft→Approved, Submitted→Draft and Approved→Submitted are refused
-- with P0001 "illegal transition" (the map check runs BEFORE the authorization matrix, so the
-- refusal is the map's own).
-- Mutation-check: edit 0180's v_legal map (e.g. drop 'Submitted' from Draft, add 'Draft' to
-- Submitted) and the matching cases here go red.
-- (FR-TS-001; owner/manager/SoD authority is owned by 0022/0023/0025 — fixtures here only carry
-- the minimum authority each legal leg needs.)
-- Isolated org; UUID prefix 17110000-… (issue #1710).
begin;
create extension if not exists pgtap;
select plan(38);

insert into organizations (id, name) values
  ('17110000-0000-0000-0000-000000000001','Timesheet Map Org (1710)'), ('17110000-0000-0000-0000-000000000002','Other Org');

insert into auth.users (id, email) values
  ('17110000-0000-0000-0000-0000000000a1','owner-map1710@example.com'),
  ('17110000-0000-0000-0000-0000000000a2','admin-map1710@example.com'),
  ('17110000-0000-0000-0000-0000000000a3','other-map1710@example.com'), ('17110000-0000-0000-0000-0000000000b1','foreign-map1710@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('17110000-0000-0000-0000-0000000000a1','17110000-0000-0000-0000-000000000001','Owner 1710','owner-map1710@example.com','Engineer'),
  ('17110000-0000-0000-0000-0000000000a2','17110000-0000-0000-0000-000000000001','Admin 1710','admin-map1710@example.com','Admin'),
  ('17110000-0000-0000-0000-0000000000a3','17110000-0000-0000-0000-000000000001','Other 1710','other-map1710@example.com','Engineer'), ('17110000-0000-0000-0000-0000000000b1','17110000-0000-0000-0000-000000000002','Foreign','foreign-map1710@example.com','Engineer');

-- The owner has NO manager_id, so the Admin/Exec fallback authorizes the approve/reject/reopen
-- arms (0023/0025 own that matrix — here it is only the map's gatekeeper).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('17110000-0000-0000-0000-000000000010','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-01','Draft'),
  ('17110000-0000-0000-0000-000000000011','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-08','Submitted'),
  ('17110000-0000-0000-0000-000000000012','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-15','Submitted'),
  ('17110000-0000-0000-0000-000000000013','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-22','Rejected'),
  ('17110000-0000-0000-0000-000000000014','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-06-29','Approved'),
  ('17110000-0000-0000-0000-000000000015','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-06','Draft'),
  ('17110000-0000-0000-0000-000000000016','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-13','Submitted'),
  ('17110000-0000-0000-0000-000000000017','17110000-0000-0000-0000-000000000001','17110000-0000-0000-0000-0000000000a1','2026-07-20','Approved');

-- ── AC-900: legal pairs are accepted ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000010','Submitted') $$,
  'AC-900: Draft → Submitted is legal (FR-TS-001)');

select lives_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000013','Draft') $$,
  'AC-900: Rejected → Draft (rework) is legal (FR-TS-001/FR-TS-006)');

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select lives_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000011','Approved') $$,
  'AC-900: Submitted → Approved is legal (FR-TS-001)');

select lives_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','Please revise') $$,
  'AC-900: Submitted → Rejected is legal (FR-TS-001)');

-- Slice A (FR-TSC-001): Approved is no longer terminal — the un-pushed sheet re-opens.
select lives_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000014','Draft') $$,
  'AC-900: Approved → Draft (re-open, Slice A) is legal (FR-TSC-001)');

-- ── AC-900: illegal jumps are rejected (the map fires before the matrix) ────
select throws_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000015','Approved') $$,
  'P0001', null,
  'AC-900: Draft → Approved (illegal jump) is rejected (FR-TS-001)');

select throws_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000016','Draft') $$,
  'P0001', null,
  'AC-900: Submitted → Draft (illegal jump) is rejected (FR-TS-001)');

select throws_ok(
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000017','Submitted') $$,
  'P0001', null,
  'AC-900: Approved → Submitted is rejected — re-open to Draft is the only Approved exit (FR-TS-001)');

reset role;

-- ── AC-900: the five legal legs actually LANDED in their target status ──────
select is(
  (select count(*) from timesheets where
       (id = '17110000-0000-0000-0000-000000000010' and status::text = 'Submitted') or
       (id = '17110000-0000-0000-0000-000000000011' and status::text = 'Approved') or
       (id = '17110000-0000-0000-0000-000000000012' and status::text = 'Rejected') or
       (id = '17110000-0000-0000-0000-000000000013' and status::text = 'Draft') or
       (id = '17110000-0000-0000-0000-000000000014' and status::text = 'Draft')),
  5::bigint,
  'AC-900: every accepted legal pair landed in its target status (FR-TS-001)');

select is((select rejection_reason from timesheets where id = '17110000-0000-0000-0000-000000000012'), 'Please revise', 'AC-RSN-007: reason is retained');
select is((select rejected_by from timesheets where id = '17110000-0000-0000-0000-000000000012'), '17110000-0000-0000-0000-0000000000a2'::uuid, 'AC-RSN-007: actor is recorded');
select isnt((select rejected_at from timesheets where id = '17110000-0000-0000-0000-000000000012'), null::timestamptz, 'AC-RSN-007: decision time is recorded');
set local role authenticated;
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select rejected_by from timesheets where id = '17110000-0000-0000-0000-000000000012'), '17110000-0000-0000-0000-0000000000a2'::uuid, 'AC-RSN-003 owner can read decision actor');
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*) from timesheets where id = '17110000-0000-0000-0000-000000000012'), 0::bigint, 'AC-RSN-003 unrelated user cannot read timesheet');
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Draft') $$, 'AC-RSN-002 correction');
select is((select rejected_by from timesheets where id = '17110000-0000-0000-0000-000000000012'), '17110000-0000-0000-0000-0000000000a2'::uuid, 'AC-RSN-002 actor remains visible');
select lives_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Submitted') $$, 'AC-RSN-002 resubmit');
select is((select rejected_by from timesheets where id = '17110000-0000-0000-0000-000000000012'), null::uuid, 'AC-RSN-002 actor cleared');
select throws_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','reason') $$, '42501', null, 'AC-RSN-003 owner cannot reject own timesheet');
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected',' reason ') $$, 'AC-RSN-007 reject with notes');
select is((select rejection_reason from timesheets where id = '17110000-0000-0000-0000-000000000012'), 'reason', 'AC-RSN-007 reason trimmed');
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select transition_timesheet('17110000-0000-0000-0000-000000000012','Draft');
select ok((select rejection_reason='reason' and rejected_by='17110000-0000-0000-0000-0000000000a2'::uuid and rejected_at is not null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-002 all timesheet decision details retained');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Submitted');
select ok((select rejection_reason is null and rejected_by is null and rejected_at is null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-002 all timesheet decision details cleared');
set local request.jwt.claims = '{"sub":"17110000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','reason');

reset role;
select ok(has_function_privilege('authenticated', (select oid from pg_proc where pronamespace='public'::regnamespace and proname='transition_timesheet'), 'execute'), 'AC-RSN-003 existing authenticated execution preserved');
select ok(not has_function_privilege('anon', (select oid from pg_proc where pronamespace='public'::regnamespace and proname='transition_timesheet'), 'execute'), 'AC-RSN-003 anonymous execution denied');
select ok(not has_column_privilege('authenticated', 'public.timesheets', 'rejected_by', 'UPDATE'), 'AC-RSN-003 actor is not client writable');
select ok(not has_column_privilege('authenticated', 'public.timesheets', 'rejected_by', 'INSERT'), 'AC-RSN-003 actor is not client insertable');
select is((select confdeltype::text from pg_constraint where conrelid = 'public.timesheets'::regclass and conname = 'timesheets_rejected_by_fkey'), 'n', 'AC-RSN-003 deleting the actor sets rejected_by null');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a1', 'role','authenticated')::text, true);
select transition_timesheet('17110000-0000-0000-0000-000000000012','Draft');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Submitted');
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a2', 'role','authenticated')::text, true);
select throws_ok($$select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','   ')$$, '22023', 'A rejection reason is required', 'AC-RSN-001 spaces-only notes refused');
select ok((select status='Submitted' and rejection_reason is null and rejected_by is null and rejected_at is null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-001 refused decision leaves record unchanged');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', repeat('x',1000));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a1', 'role','authenticated')::text, true);
select transition_timesheet('17110000-0000-0000-0000-000000000012','Draft');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Submitted');
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a2', 'role','authenticated')::text, true);
select throws_ok($$select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', E' \t\n ')$$, '22023', 'A rejection reason is required', 'AC-RSN-001 whitespace-only notes refused');
select ok((select status='Submitted' and rejection_reason is null and rejected_by is null and rejected_at is null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-001 refused decision leaves record unchanged');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', repeat('x',1000));
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a1', 'role','authenticated')::text, true);
select transition_timesheet('17110000-0000-0000-0000-000000000012','Draft');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Submitted');
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a2', 'role','authenticated')::text, true);
select throws_ok($$select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', ' ' || repeat('x',5000) || ' ')$$, '22023', 'A rejection reason is required', 'AC-RSN-001 long notes refused');
select ok((select status='Submitted' and rejection_reason is null and rejected_by is null and rejected_at is null from timesheets where id='17110000-0000-0000-0000-000000000012'), 'AC-RSN-001 refused decision leaves record unchanged');
select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected', repeat('x',1000));
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a1', 'role','authenticated')::text, true);
select ok(coalesce((select rejection_reason=repeat('x',1000) and rejected_by is not null and rejected_at is not null from timesheets where id='17110000-0000-0000-0000-000000000012'),false), 'AC-RSN-003 submitter reads reason actor time');
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000a3', 'role','authenticated')::text, true);
select is((select count(*) from timesheets where id='17110000-0000-0000-0000-000000000012'), 0::bigint, 'AC-RSN-003 unrelated member cannot read');
select set_config('request.jwt.claims', json_build_object('sub', '17110000-0000-0000-0000-0000000000b1', 'role','authenticated')::text, true);
select is((select count(*) from timesheets where id='17110000-0000-0000-0000-000000000012'), 0::bigint, 'AC-RSN-003 other organization cannot read');
reset role;
do $$ begin delete from profiles where id='17110000-0000-0000-0000-0000000000a2'; exception when foreign_key_violation then null; end $$;
select ok(case when exists(select 1 from profiles where id='17110000-0000-0000-0000-0000000000a2') then (select confdeltype='n' from pg_constraint where conrelid='public.timesheets'::regclass and conname='timesheets_rejected_by_fkey') else (select rejected_by is null and rejected_at is not null and rejection_reason is not null from timesheets where id='17110000-0000-0000-0000-000000000012') end, 'AC-RSN-003 deleted actor is nullable or FK requires set null');
select * from finish();
rollback;
