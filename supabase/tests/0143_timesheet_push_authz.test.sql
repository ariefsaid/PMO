-- 0143_timesheet_push_authz.test.sql
-- AC-TSP-012 — `approved_timesheet_for_push` (migration 0138): the ONE server-side read the dispatch
-- (and later the sweep) uses to prove, from DB truth under the CALLER's identity, that
--   (a) the sheet is Approved — THE OWNER'S RULING (FR-TSP-010): nothing else ever reaches ERP;
--   (b) the caller may push it (FR-TSP-011): `approved_by` OR a privileged role;
--   (c) tenancy holds (FR-TSP-054), which a SECURITY DEFINER function must re-assert itself.
--
-- ⚑ The role rule is deliberately NOT the money-write role set: a legitimate approver is very often an
--   ENGINEER-role LINE MANAGER (profiles.manager_id; 0007 A2/A4). Narrowing this to Admin/Finance-style
--   money roles would break the PRIMARY approval path — that is what the M cases below pin.
-- ⚑ The command payload is never trusted to assert approved-ness: the entries come back FROM THIS READ,
--   so a forged payload cannot decide what hours are pushed (ADR-0059 §3.3).
begin;
select plan(16);

insert into organizations (id, name) values
  ('01430000-0000-0000-0000-00000000000a','TS Push Org A'),
  ('01430000-0000-0000-0000-00000000000b','TS Push Org B');

insert into auth.users (id, email) values
  ('01430000-0000-0000-0000-0000000000a1','u-push@example.com'),
  ('01430000-0000-0000-0000-0000000000a2','m-push@example.com'),
  ('01430000-0000-0000-0000-0000000000a3','f-push@example.com'),
  ('01430000-0000-0000-0000-0000000000a4','x-push@example.com'),
  ('01430000-0000-0000-0000-0000000000b1','b-push@example.com');

insert into profiles (id, org_id, full_name, email, role, manager_id) values
  ('01430000-0000-0000-0000-0000000000a2','01430000-0000-0000-0000-00000000000a','Mgr Push','m-push@example.com','Engineer', null),
  ('01430000-0000-0000-0000-0000000000a1','01430000-0000-0000-0000-00000000000a','User Push','u-push@example.com','Engineer','01430000-0000-0000-0000-0000000000a2'),
  ('01430000-0000-0000-0000-0000000000a3','01430000-0000-0000-0000-00000000000a','Fin Push','f-push@example.com','Finance', null),
  ('01430000-0000-0000-0000-0000000000a4','01430000-0000-0000-0000-00000000000a','Bystander Push','x-push@example.com','Engineer', null),
  ('01430000-0000-0000-0000-0000000000b1','01430000-0000-0000-0000-00000000000b','OrgB Push','b-push@example.com','Admin', null);

insert into projects (id, org_id, name, status) values
  ('01430000-0000-0000-0000-000000000030','01430000-0000-0000-0000-00000000000a','TS Push Project','Ongoing Project');

-- An APPROVED sheet (approved by the Engineer line manager M) + two entries, one of them zero-hours.
insert into timesheets (id, org_id, user_id, week_start_date, status, approved_by, approved_at) values
  ('01430000-0000-0000-0000-000000000010','01430000-0000-0000-0000-00000000000a',
   '01430000-0000-0000-0000-0000000000a1','2026-01-05','Approved',
   '01430000-0000-0000-0000-0000000000a2','2026-01-12T03:04:05Z');
insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('01430000-0000-0000-0000-000000000041','01430000-0000-0000-0000-00000000000a',
   '01430000-0000-0000-0000-000000000010','01430000-0000-0000-0000-000000000030','2026-01-05',7.25),
  ('01430000-0000-0000-0000-000000000042','01430000-0000-0000-0000-00000000000a',
   '01430000-0000-0000-0000-000000000010','01430000-0000-0000-0000-000000000030','2026-01-06',0);

-- A SUBMITTED (not yet approved) sheet — the owner's ruling's negative case.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('01430000-0000-0000-0000-000000000011','01430000-0000-0000-0000-00000000000a',
   '01430000-0000-0000-0000-0000000000a1','2026-01-12','Submitted');

-- ── A) The approver (an ENGINEER line manager) may push — the anti-money-role proof ───────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a2","role":"authenticated"}';

select is(
  (select count(*)::int from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  1,
  'AC-TSP-012: the approving Engineer LINE MANAGER may push (NOT narrowed to money-write roles)');

select is(
  (select user_id from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  '01430000-0000-0000-0000-0000000000a1'::uuid,
  'AC-TSP-012: the sheet author is returned as server truth (never from a payload)');

select is(
  (select approved_at from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  '2026-01-12T03:04:05Z'::timestamptz,
  'AC-TSP-012: approved_at is returned as the server-resolved key witness (ADR-0059 §4/§6)');

select is(
  (select jsonb_array_length(entries) from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  1,
  'AC-TSP-012: only non-zero entries are returned (a 0-hour row is never pushed, FR-TSP-056)');

select is(
  (select entries->0->>'hours' from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  '7.25',
  'AC-TSP-012: hours cross as a decimal STRING, never a float (FR-TSP-070)');

select is(
  (select entries->0->>'project_org_id' from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  '01430000-0000-0000-0000-00000000000a',
  'AC-TSP-012: each entry carries its project org for the same-org pre-flight (FR-TSP-054)');
reset role;

-- ── B) A privileged role may push too (FR-TSP-011's second arm) ───────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is(
  (select count(*)::int from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010')),
  1,
  'AC-TSP-012: a privileged (Finance) actor may push');
reset role;

-- ── C) Everyone else is refused — fail-closed ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010') $$,
  '42501', null,
  'AC-TSP-012: an in-org Engineer bystander is refused 42501');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010') $$,
  '42501', null,
  'AC-TSP-012: the AUTHOR (not the approver, not privileged) is refused 42501');
reset role;

-- ── D) THE OWNER'S RULING: a non-Approved sheet can never be pushed, by anyone ────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-000000000011') $$,
  'P0001', null,
  'AC-TSP-012: a Submitted (unapproved) sheet raises P0001 timesheet-not-approved even for a privileged actor');
reset role;

-- ── E) Tenancy — a definer function must re-assert what RLS would have (AC-TSP-031 DB half) ───────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010') $$,
  '42501', null,
  'AC-TSP-012: a cross-org Admin is refused 42501 (definer bypasses RLS — the check must be internal)');
reset role;

-- ── F) A missing sheet is a distinct, non-leaking error ───────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-0000000000ff') $$,
  'P0002', null,
  'AC-TSP-012: an unknown timesheet raises P0002 not-found');
reset role;

-- ── G) IMPERSONATION — `p_actor` must NEVER override a JWT caller's own identity ──────────────────
-- The original `v_actor := coalesce(p_actor, auth.uid())` let p_actor WIN, so any authenticated org
-- member could pass the sheet's `approved_by` and satisfy actor-rule (c) — defeating the check the
-- rule exists to enforce. `p_actor` is only for the service_role sweep (auth.uid() is null there),
-- which `coalesce(auth.uid(), p_actor)` expresses exactly. Bystander is an Engineer with no relation
-- to this sheet: unprivileged AND not the approver, so with their real identity they must be refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push(
       '01430000-0000-0000-0000-000000000010',
       '01430000-0000-0000-0000-0000000000a2') $$,
  '42501', null,
  'AC-TSP-011: a bystander passing the APPROVER''s id as p_actor is still refused 42501 (no impersonation)');
reset role;

-- ── H) OFFBOARDING GATE — a disabled actor may not push, on EITHER path ───────────────────────────
-- `approved_timesheet_for_push` is `grant execute … to authenticated`, i.e. reachable DIRECTLY over
-- PostgREST, so the edge fn's auth guard is NOT in the path. Without this a just-disabled approver
-- holding a still-valid JWT could keep pushing payroll-costing hours into the client's ERP.
update profiles set status = 'disabled' where id = '01430000-0000-0000-0000-0000000000a2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select * from approved_timesheet_for_push('01430000-0000-0000-0000-000000000010') $$,
  '42501', null,
  'AC-TSP-013: a DISABLED approver with a still-valid JWT is refused 42501 (offboarding gate)');
reset role;

-- ⚑ The service_role sweep path must be refused for the SAME disabled actor. This is why the gate is
--   not a bare `is_active_member()` conjunct (that helper keys on auth.uid(), null here) — it checks
--   the RESOLVED actor's status, so `p_actor` cannot be used to route around offboarding either.
set local role service_role;
select throws_ok(
  $$ select * from approved_timesheet_for_push(
       '01430000-0000-0000-0000-000000000010',
       '01430000-0000-0000-0000-0000000000a2') $$,
  '42501', null,
  'AC-TSP-013: the sweep passing a DISABLED actor as p_actor is refused 42501 too');
reset role;

-- ⚑ THE REGRESSION GUARD: re-activate, and the sweep path must WORK again. A naive
--   `and is_active_member()` conjunct would refuse this (auth.uid() is null under service_role),
--   silently disabling the backstop — green on every negative test above and broken in production.
update profiles set status = 'active' where id = '01430000-0000-0000-0000-0000000000a2';
set local role service_role;
select is(
  (select count(*)::int from approved_timesheet_for_push(
     '01430000-0000-0000-0000-000000000010',
     '01430000-0000-0000-0000-0000000000a2')),
  1,
  'AC-TSP-013: the sweep STILL works for an active actor (the gate must not disable the backstop)');
reset role;

select * from finish();
rollback;
