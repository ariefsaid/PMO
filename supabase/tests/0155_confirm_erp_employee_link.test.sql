-- 0155_confirm_erp_employee_link.test.sql
-- AC-TSP-091 — the `confirm_erp_employee_link` RPC (migration 0140): the OQ-TSP-10(C) adopt-then-confirm
-- link-state machine, DB-side. `erp_employees` + its RLS + the partial-unique confirmed-link index are
-- ALREADY covered by 0143_erp_employees_rls.test.sql (storage only, no transition logic) — this file
-- proves ONLY the confirm transition: Admin-only, server-resolved witness columns, org re-assertion
-- (SECURITY DEFINER bypasses RLS, so the function must re-assert internally — the ADR-0011/0012 lesson),
-- the partial-unique collision, and the audit trail.
begin;
select plan(13);

-- ── Fixtures ─────────────────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01550000-0000-0000-0000-00000000000a','Link Org A'),
  ('01550000-0000-0000-0000-00000000000b','Link Org B');

insert into auth.users (id, email) values
  ('01550000-0000-0000-0000-0000000000a1','admin-link@example.com'),
  ('01550000-0000-0000-0000-0000000000a2','finance-link@example.com'),
  ('01550000-0000-0000-0000-0000000000a3','pm-link@example.com'),
  ('01550000-0000-0000-0000-0000000000a4','engineer-link@example.com'),
  ('01550000-0000-0000-0000-0000000000a5','other-engineer-link@example.com'),
  ('01550000-0000-0000-0000-0000000000b1','admin-orgb-link@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01550000-0000-0000-0000-0000000000a1','01550000-0000-0000-0000-00000000000a','Admin Link','admin-link@example.com','Admin'),
  ('01550000-0000-0000-0000-0000000000a2','01550000-0000-0000-0000-00000000000a','Finance Link','finance-link@example.com','Finance'),
  ('01550000-0000-0000-0000-0000000000a3','01550000-0000-0000-0000-00000000000a','PM Link','pm-link@example.com','Project Manager'),
  ('01550000-0000-0000-0000-0000000000a4','01550000-0000-0000-0000-00000000000a','Engineer Link','engineer-link@example.com','Engineer'),
  ('01550000-0000-0000-0000-0000000000a5','01550000-0000-0000-0000-00000000000a','Other Engineer Link','other-engineer-link@example.com','Engineer'),
  ('01550000-0000-0000-0000-0000000000b1','01550000-0000-0000-0000-00000000000b','Admin OrgB Link','admin-orgb-link@example.com','Admin');

-- erp_employees rows (as owner — the adopt feed's stand-in; erp_employees is machine-written).
insert into erp_employees (id, org_id, employee_number, employee_name, work_email, link_state) values
  ('01550000-0000-0000-0000-0000000000e1','01550000-0000-0000-0000-00000000000a','HR-EMP-90001','Unlinked One','u1@example.com','unlinked'),
  ('01550000-0000-0000-0000-0000000000e2','01550000-0000-0000-0000-00000000000a','HR-EMP-90002','Unlinked Two','u2@example.com','unlinked'),
  ('01550000-0000-0000-0000-0000000000e3','01550000-0000-0000-0000-00000000000a','HR-EMP-90003','Proposed Three','u3@example.com','proposed');
update erp_employees set profile_id = '01550000-0000-0000-0000-0000000000a5'
  where id = '01550000-0000-0000-0000-0000000000e3';

-- ── A) Non-Admin callers are refused, even the subject themselves ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e1'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  '42501', null,
  'AC-TSP-091: a Finance caller is refused — Admin-only');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e1'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  '42501', null,
  'AC-TSP-091: a Project Manager caller is refused — Admin-only');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e1'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  '42501', null,
  'AC-TSP-091: the subject themselves (an Engineer) is refused — self-confirm is not authorization');
reset role;

-- ── B) Admin in ANOTHER org cannot confirm org A's Employee (internal org re-assertion) ───────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e1'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  '42501', null,
  'AC-TSP-091: a cross-org Admin is refused — SECURITY DEFINER re-asserts org internally (ADR-0011/0012)');
reset role;

-- (the org-A row must be untouched by the refused cross-org attempt)
select is((select link_state from erp_employees where id = '01550000-0000-0000-0000-0000000000e1'),
  'unlinked', 'AC-TSP-091: the refused cross-org attempt left the row unlinked');

-- ── C) An in-org Admin confirms: link_state, profile_id, linked_by, linked_at are ALL server-set ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e1'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  'AC-TSP-091: an in-org Admin confirms successfully');
reset role;

select is((select link_state from erp_employees where id = '01550000-0000-0000-0000-0000000000e1'),
  'confirmed', 'AC-TSP-091: link_state flips to confirmed');
select is((select profile_id from erp_employees where id = '01550000-0000-0000-0000-0000000000e1'),
  '01550000-0000-0000-0000-0000000000a4'::uuid, 'AC-TSP-091: profile_id is set to the confirmed PMO user');
select is((select linked_by from erp_employees where id = '01550000-0000-0000-0000-0000000000e1'),
  '01550000-0000-0000-0000-0000000000a1'::uuid,
  'AC-TSP-014: linked_by is the confirming ADMIN''s auth.uid(), server-resolved (the function takes no linked_by parameter — a caller cannot forge the witness)');
select ok((select linked_at from erp_employees where id = '01550000-0000-0000-0000-0000000000e1') is not null,
  'AC-TSP-014: linked_at is server-stamped (now())');

-- ── D) A second confirm for the SAME profile_id collides on the partial-unique index ──────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01550000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ select confirm_erp_employee_link('01550000-0000-0000-0000-0000000000e2'::uuid, '01550000-0000-0000-0000-0000000000a4'::uuid) $$,
  '23505', null,
  'AC-TSP-091/OQ-TSP-10(ii): confirming a SECOND Employee for the same PMO user collides on the partial-unique index');
reset role;

-- ── E) A 'proposed' row is NOT authoritative — it must never satisfy a link_state='confirmed' filter ──
select is(
  (select count(*)::int from erp_employees
     where profile_id = '01550000-0000-0000-0000-0000000000a5' and link_state = 'confirmed'),
  0,
  'AC-TSP-092: a merely-proposed link (never confirmed) does NOT authorize a push — filtered by link_state=confirmed it is 0 rows');

-- ── F) The confirm writes exactly ONE audit_events row naming the actor + the link ────────────────
select is(
  (select count(*)::int from audit_events
     where action = 'confirm_erp_employee_link'
       and actor_id = '01550000-0000-0000-0000-0000000000a1'
       and entity_id = '01550000-0000-0000-0000-0000000000e1'),
  1,
  'AC-TSP-091: the confirm writes exactly one audit_events row naming the confirming Admin + the linked Employee');

select * from finish();
rollback;
