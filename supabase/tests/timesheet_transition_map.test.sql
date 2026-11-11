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
select plan(9);

insert into organizations (id, name) values
  ('17110000-0000-0000-0000-000000000001','Timesheet Map Org (1710)');

insert into auth.users (id, email) values
  ('17110000-0000-0000-0000-0000000000a1','owner-map1710@example.com'),
  ('17110000-0000-0000-0000-0000000000a2','admin-map1710@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('17110000-0000-0000-0000-0000000000a1','17110000-0000-0000-0000-000000000001','Owner 1710','owner-map1710@example.com','Engineer'),
  ('17110000-0000-0000-0000-0000000000a2','17110000-0000-0000-0000-000000000001','Admin 1710','admin-map1710@example.com','Admin');

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
  $$ select transition_timesheet('17110000-0000-0000-0000-000000000012','Rejected','Please correct this week') $$,
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

select * from finish();
rollback;
