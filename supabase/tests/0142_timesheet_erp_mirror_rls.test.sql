-- 0142_timesheet_erp_mirror_rls.test.sql
-- AC-TSP-050 (storage half): the Posture-B side-mirror `timesheet_erp_mirror` (migration 0118).
--
-- ADR-0059 Posture B: PMO is the SoT for timesheet entry + approval, so there is NO per-command RLS flip
-- (unlike P3a's sales_invoices/incoming_payments). The side mirror holds ERP-side state only and is:
--   • machine-written ONLY — no INSERT/UPDATE/DELETE policy or grant for `authenticated` ⇒ default-deny;
--     the service role (dispatch/sweep) writes it, bypassing RLS.
--   • SELECT-readable to exactly the audience that may read the parent timesheet (own / line-manager /
--     privileged), never wider — the ERP state of a sheet is never more visible than the sheet.
--   • FORCE RLS'd (the global AC-LOW-1 invariant).
--   • carrying all four erp_* feed columns + the read-back oracles DAY ONE (the 0103 lesson).
-- 1:1 with timesheets (unique timesheet_id) and cascade-deleted with the PMO row (timesheets is SoT).
begin;
select plan(22);

-- ── Fixtures (inserted as table owner; org_id stamped explicitly) ────────────────────────────────
insert into organizations (id, name) values
  ('01420000-0000-0000-0000-00000000000a','TS Mirror Org A'),
  ('01420000-0000-0000-0000-00000000000b','TS Mirror Org B');

insert into auth.users (id, email) values
  ('01420000-0000-0000-0000-0000000000a1','u-ts@example.com'),
  ('01420000-0000-0000-0000-0000000000a2','m-ts@example.com'),
  ('01420000-0000-0000-0000-0000000000a3','f-ts@example.com'),
  ('01420000-0000-0000-0000-0000000000a4','x-ts@example.com'),
  ('01420000-0000-0000-0000-0000000000b1','b-ts@example.com');

-- M is U's line manager (an Engineer-role one — NOT in the privileged-read set; the FR-TSP-171 point).
insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01420000-0000-0000-0000-0000000000a2','01420000-0000-0000-0000-00000000000a','Mgr TS','m-ts@example.com','Engineer', null),
  ('01420000-0000-0000-0000-0000000000a1','01420000-0000-0000-0000-00000000000a','User TS','u-ts@example.com','Engineer','01420000-0000-0000-0000-0000000000a2'),
  ('01420000-0000-0000-0000-0000000000a3','01420000-0000-0000-0000-00000000000a','Fin TS','f-ts@example.com','Finance', null),
  ('01420000-0000-0000-0000-0000000000a4','01420000-0000-0000-0000-00000000000a','Bystander TS','x-ts@example.com','Engineer', null),
  ('01420000-0000-0000-0000-0000000000b1','01420000-0000-0000-0000-00000000000b','OrgB TS','b-ts@example.com','Engineer', null);

-- U's approved weekly sheet (approved by the line manager M).
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01420000-0000-0000-0000-000000000010','01420000-0000-0000-0000-00000000000a',
   '01420000-0000-0000-0000-0000000000a1','2026-01-05','Approved',
   '01420000-0000-0000-0000-0000000000a2', now());

-- The machine-written side-mirror row (as owner — the service-role writer's stand-in).
insert into timesheet_erp_mirror (id, org_id, timesheet_id, push_state) values
  ('01420000-0000-0000-0000-000000000020','01420000-0000-0000-0000-00000000000a',
   '01420000-0000-0000-0000-000000000010','pending');

-- ── A) Day-one columns (the 0103 lesson) + FORCE RLS + the 1:1 seam ───────────────────────────────
select has_column('public','timesheet_erp_mirror','push_state','AC-TSP-050: push_state day-one');
select has_column('public','timesheet_erp_mirror','push_error','AC-TSP-050: push_error day-one');
select has_column('public','timesheet_erp_mirror','approved_at_pushed','AC-TSP-050: approved_at_pushed day-one (key witness)');
select has_column('public','timesheet_erp_mirror','erp_total_hours','AC-TSP-050: erp_total_hours read-back oracle day-one');
select has_column('public','timesheet_erp_mirror','erp_total_costing_amount','AC-TSP-050: erp_total_costing_amount oracle day-one');
select has_column('public','timesheet_erp_mirror','erp_docstatus','AC-TSP-050: erp_docstatus feed col day-one');
select has_column('public','timesheet_erp_mirror','erp_modified','AC-TSP-050: erp_modified feed col day-one');
select has_column('public','timesheet_erp_mirror','erp_amended_from','AC-TSP-050: erp_amended_from feed col day-one');
select has_column('public','timesheet_erp_mirror','erp_cancelled_at','AC-TSP-050: erp_cancelled_at feed col day-one');

select ok((select relforcerowsecurity from pg_class where oid = 'public.timesheet_erp_mirror'::regclass),
  'AC-TSP-050: timesheet_erp_mirror FORCE RLS (AC-LOW-1 invariant)');

-- unique (timesheet_id): a second mirror row for the same sheet → 23505.
select throws_ok(
  $$ insert into timesheet_erp_mirror (org_id, timesheet_id)
     values ('01420000-0000-0000-0000-00000000000a','01420000-0000-0000-0000-000000000010') $$,
  '23505', null,
  'AC-TSP-050: unique(timesheet_id) enforces 1:1 with timesheets');

-- ── B) Machine-only: `authenticated` cannot write (no policy AND no grant ⇒ 42501) ────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a1","role":"authenticated"}';

select throws_ok(
  $$ insert into timesheet_erp_mirror (timesheet_id)
     values ('01420000-0000-0000-0000-000000000010') $$,
  '42501', null,
  'AC-TSP-050: user INSERT into timesheet_erp_mirror denied (machine-only)');
select throws_ok(
  $$ update timesheet_erp_mirror set push_state = 'pushed'
     where id = '01420000-0000-0000-0000-000000000020' $$,
  '42501', null,
  'AC-TSP-050: user UPDATE of timesheet_erp_mirror denied (machine-only)');
select throws_ok(
  $$ delete from timesheet_erp_mirror where id = '01420000-0000-0000-0000-000000000020' $$,
  '42501', null,
  'AC-TSP-050: user DELETE of timesheet_erp_mirror denied (machine-only)');

-- U (the sheet owner) may READ the ERP state of their own sheet.
select is((select count(*)::int from timesheet_erp_mirror), 1,
  'AC-TSP-050: sheet owner reads their mirror row');
reset role;

-- ── C) Read parity with the parent sheet's audience (FR-TSP-171) ──────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from timesheet_erp_mirror), 1,
  'AC-TSP-050: the owner''s line manager (Engineer) reads the mirror row');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from timesheet_erp_mirror), 1,
  'AC-TSP-050: a privileged (Finance) reader reads the mirror row');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from timesheet_erp_mirror), 0,
  'AC-TSP-050: an unrelated in-org Engineer reads 0 (never wider than the sheet)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01420000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from timesheet_erp_mirror), 0,
  'AC-TSP-050: a cross-org user reads 0 (tenancy)');
reset role;

-- ── D) The service role IS the writer (bypasses RLS; has the grant) ───────────────────────────────
set local role service_role;
select lives_ok(
  $$ update timesheet_erp_mirror
        set push_state = 'pushed', ts_number = 'TS-0001', erp_total_hours = 7.50, erp_docstatus = 1
      where id = '01420000-0000-0000-0000-000000000020' $$,
  'AC-TSP-050: service_role writes the mirror (dispatch/sweep path)');
reset role;
select is((select push_state from timesheet_erp_mirror where id = '01420000-0000-0000-0000-000000000020'),
  'pushed', 'AC-TSP-050: the service-role write took effect');

-- ── E) Cascade: the PMO row is SoT — deleting it drops the mirror ─────────────────────────────────
delete from timesheets where id = '01420000-0000-0000-0000-000000000010';
select is((select count(*)::int from timesheet_erp_mirror
             where id = '01420000-0000-0000-0000-000000000020'), 0,
  'AC-TSP-050: deleting the parent timesheet cascades the mirror row');

select * from finish();
rollback;
