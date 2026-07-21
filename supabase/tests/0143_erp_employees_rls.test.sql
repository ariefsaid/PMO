-- 0143_erp_employees_rls.test.sql
-- AC-TSP-090 (storage half): the adopted ERP `Employee` master + its PMO-user link (migration 0118).
--
-- OQ-TSP-3 ruling: the Employee-adopt sub-domain. This test covers the STORAGE the ADR/spec pin — the
-- table, the link columns, the link_state column + its CHECK, the partial-unique confirmed-link index,
-- the day-one erp_* feed columns, RLS + FORCE RLS + machine-only writes. It deliberately does NOT test
-- the propose/confirm TRANSITION logic (the adopt probe that sets 'proposed', the Admin confirm RPC) —
-- that is gated on OQ-TSP-10 (the matching key + the link state machine) and is NOT built in this slice.
--
-- RLS: the table carries employee names + work emails (PII), so unlike `companies` it is NOT org-wide
-- readable — SELECT is restricted to a privileged role OR the user's own link (profile_id = auth.uid()).
-- Machine-written: no INSERT/UPDATE/DELETE policy or grant for `authenticated` ⇒ default-deny; the feed
-- writes as service_role and the (deferred) link is an Admin-only RPC — never a direct table write.
begin;
select plan(26);

-- ── Fixtures (as owner) ───────────────────────────────────────────────────────────────────────────
insert into organizations (id, name) values
  ('01430000-0000-0000-0000-00000000000a','Emp Org A'),
  ('01430000-0000-0000-0000-00000000000b','Emp Org B');

insert into auth.users (id, email) values
  ('01430000-0000-0000-0000-0000000000a1','admin-emp@example.com'),
  ('01430000-0000-0000-0000-0000000000a2','linked-emp@example.com'),
  ('01430000-0000-0000-0000-0000000000a3','other-emp@example.com'),
  ('01430000-0000-0000-0000-0000000000b1','orgb-emp@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('01430000-0000-0000-0000-0000000000a1','01430000-0000-0000-0000-00000000000a','Admin Emp','admin-emp@example.com','Admin'),
  ('01430000-0000-0000-0000-0000000000a2','01430000-0000-0000-0000-00000000000a','Linked Emp','linked-emp@example.com','Engineer'),
  ('01430000-0000-0000-0000-0000000000a3','01430000-0000-0000-0000-00000000000a','Other Emp','other-emp@example.com','Engineer'),
  ('01430000-0000-0000-0000-0000000000b1','01430000-0000-0000-0000-00000000000b','OrgB Emp','orgb-emp@example.com','Admin');

-- One adopted, CONFIRMED Employee linked to profile a2 (as owner — the feed/link writer's stand-in).
insert into erp_employees (id, org_id, employee_number, employee_name, work_email, profile_id, link_state) values
  ('01430000-0000-0000-0000-000000000010','01430000-0000-0000-0000-00000000000a',
   'HR-EMP-00001','Linked Emp','linked-emp@example.com',
   '01430000-0000-0000-0000-0000000000a2','confirmed');

-- ── A) Columns (adopt master + link + day-one feed cols) + FORCE RLS ──────────────────────────────
select has_column('public','erp_employees','employee_number','AC-TSP-090: employee_number');
select has_column('public','erp_employees','employee_name','AC-TSP-090: employee_name');
select has_column('public','erp_employees','work_email','AC-TSP-090: work_email (the OQ-TSP-10(C) match candidate)');
select has_column('public','erp_employees','erp_user_id','AC-TSP-090: erp_user_id (Frappe User link)');
select has_column('public','erp_employees','erp_status','AC-TSP-090: erp_status');
select has_column('public','erp_employees','profile_id','AC-TSP-090: profile_id (the crux — the PMO user)');
select has_column('public','erp_employees','link_state','AC-TSP-090: link_state');
select has_column('public','erp_employees','link_proposed_reason','AC-TSP-090: link_proposed_reason');
select has_column('public','erp_employees','linked_by','AC-TSP-090: linked_by');
select has_column('public','erp_employees','linked_at','AC-TSP-090: linked_at');
select has_column('public','erp_employees','erp_docstatus','AC-TSP-090: erp_docstatus day-one');
select has_column('public','erp_employees','erp_modified','AC-TSP-090: erp_modified day-one (staleness cursor)');
select has_column('public','erp_employees','erp_amended_from','AC-TSP-090: erp_amended_from day-one');
select has_column('public','erp_employees','erp_cancelled_at','AC-TSP-090: erp_cancelled_at day-one');

select ok((select relforcerowsecurity from pg_class where oid = 'public.erp_employees'::regclass),
  'AC-TSP-090: erp_employees FORCE RLS (AC-LOW-1 invariant)');

-- link_state CHECK constraint rejects an out-of-domain value.
select throws_ok(
  $$ insert into erp_employees (org_id, employee_number, profile_id, link_state)
     values ('01430000-0000-0000-0000-00000000000a','HR-EMP-09999',
             '01430000-0000-0000-0000-0000000000a3','bogus') $$,
  '23514', null,
  'AC-TSP-090: link_state CHECK rejects an invalid state');

-- Partial-unique: at most ONE confirmed Employee per (org, profile) (OQ-TSP-10(ii) drafted).
select throws_ok(
  $$ insert into erp_employees (org_id, employee_number, profile_id, link_state)
     values ('01430000-0000-0000-0000-00000000000a','HR-EMP-00002',
             '01430000-0000-0000-0000-0000000000a2','confirmed') $$,
  '23505', null,
  'AC-TSP-090: unique(org_id, profile_id) WHERE confirmed — one confirmed link per PMO user');

-- ── B) RLS SELECT audience (PII — NOT org-wide) ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select is((select count(*)::int from erp_employees), 1,
  'AC-TSP-090: an Admin reads the adopted Employee');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select is((select count(*)::int from erp_employees), 1,
  'AC-TSP-090: a user reads their OWN link (profile_id = auth.uid())');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select is((select count(*)::int from erp_employees), 0,
  'AC-TSP-090: an unprivileged, unlinked user reads 0 (PII not org-wide)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from erp_employees), 0,
  'AC-TSP-090: a cross-org Admin reads 0 (tenancy)');
reset role;

-- ── C) Machine-only: even an Admin cannot write directly (no policy AND no grant ⇒ 42501) ──────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"01430000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok(
  $$ insert into erp_employees (org_id, employee_number) values
     ('01430000-0000-0000-0000-00000000000a','HR-EMP-08888') $$,
  '42501', null,
  'AC-TSP-090: Admin direct INSERT denied (machine-written / RPC-only)');
select throws_ok(
  $$ update erp_employees set link_state = 'confirmed'
     where id = '01430000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-TSP-090: Admin direct UPDATE denied (the link is an Admin-only RPC, deferred — never a table write)');
select throws_ok(
  $$ delete from erp_employees where id = '01430000-0000-0000-0000-000000000010' $$,
  '42501', null,
  'AC-TSP-090: Admin direct DELETE denied (machine-written)');
reset role;

-- ── D) Non-confirmed links are NOT subject to the partial-unique; default is 'unlinked' ────────────
select lives_ok(
  $$ insert into erp_employees (org_id, employee_number, profile_id, link_state)
     values ('01430000-0000-0000-0000-00000000000a','HR-EMP-00003',
             '01430000-0000-0000-0000-0000000000a2','proposed') $$,
  'AC-TSP-090: a second NON-confirmed row for the same profile is allowed (partial index)');
insert into erp_employees (id, org_id, employee_number) values
  ('01430000-0000-0000-0000-000000000099','01430000-0000-0000-0000-00000000000a','HR-EMP-00004');
select is((select link_state from erp_employees where id = '01430000-0000-0000-0000-000000000099'),
  'unlinked', 'AC-TSP-090: link_state defaults to unlinked');

select * from finish();
rollback;
