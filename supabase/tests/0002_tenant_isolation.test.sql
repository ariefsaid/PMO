begin;
select plan(5);

-- Seed two orgs + two auth users + two profiles inside the test txn (rolled back at end).
insert into organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002','Org B');

-- minimal auth.users rows so profiles FK + auth.uid() resolve
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000a1','a@example.com'),
  ('b0000000-0000-0000-0000-0000000000b1','b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('a0000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','User A','a@example.com','Project Manager'),
  ('b0000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000002','User B','b@example.com','Engineer');

-- a project in each org (insert as table owner, bypassing RLS, to set up fixtures)
insert into projects (id, org_id, name, status) values
  ('a1111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Project A','Ongoing Project'),
  ('b1111111-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000002','Project B','Ongoing Project');

-- Become org-A's authenticated user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-102: org A sees only org-A projects.
select is(
  (select count(*)::int from projects where org_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 1,
  'AC-102: org A reads its own project');
select is(
  (select count(*)::int from projects where org_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 0,
  'AC-102: org A cannot read org B rows (SELECT isolation)');

-- AC-103: org A cannot insert a row stamped with org B (with check rejects). Match SQLSTATE 42501 only;
-- the message text is PG-version-specific so we pass null for the message arg (plan Task 17 note).
select throws_ok(
  $$ insert into projects (org_id, name, status)
     values ('bbbbbbbb-0000-0000-0000-000000000002','Spoofed','Leads') $$,
  '42501', null,
  'AC-103: org A cannot insert spoofed org_id (WRITE isolation)');

-- AC-103b: insert WITHOUT org_id uses the column default (the canonical org), not A -> cross-org -> rejected.
-- Documents D-2: the default is the canonical org, so an org-A caller relying on the default is correctly
-- blocked; writes must go through the data-access layer that sets the caller's own org context.
select throws_ok(
  $$ insert into projects (name, status) values ('Default-org insert','Leads') $$,
  '42501', null,
  'AC-103: default org_id differs from caller org A -> rejected by with check');

reset role;
-- AC-104: Engineer (org B user) cannot write projects EVEN within their OWN org. Stamp the row with the
-- Engineer's own org_id so org-isolation is satisfied — the rejection (42501) must come from the coarse
-- role gate alone (auth_role() not in the writer set), not from cross-org WITH CHECK. (Inserting without
-- org_id would be rejected by org-isolation against the default org, giving false assurance — MEDIUM-2.)
set local role authenticated;
set local request.jwt.claims = '{"sub":"b0000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok(
  $$ insert into projects (org_id, name, status)
     values ('bbbbbbbb-0000-0000-0000-000000000002','Eng tries','Leads') $$,
  '42501', null,
  'AC-104: Engineer role cannot write projects in their own org (role gate)');

select * from finish();
rollback;
