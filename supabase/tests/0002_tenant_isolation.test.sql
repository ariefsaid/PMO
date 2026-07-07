begin;
select plan(6);

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

-- AC-103b (AMENDED — harden/org-id-seam, charter tenancy seam / post-audit MED-1/2): insert WITHOUT
-- org_id now SUCCEEDS and is stamped with the caller's (org A's) real org by the before-insert
-- stamp_org_id() trigger (0074), not left on the seed-org column default. This is the seam fix: an
-- authenticated non-seed-org user relying on the default used to be incorrectly rejected (the OLD
-- assertion here, "-> cross-org -> rejected", documented that bug as if it were correct D-2 behavior).
-- The seed-org-literal default is not a real "other org" the caller is forging into — it's the DAL's
-- known non-forgery default value — so the trigger treats it as "no org_id supplied" and coerces it to
-- auth_org_id(). Genuinely-foreign explicit org_id (e.g. line ~39 above, org B) is UNCHANGED: still
-- preserved by the trigger and hard-rejected by RLS WITH CHECK (42501) — narrow-variant contract, see
-- 0074's migration comment and 0131_org_stamp_trigger.test.sql.
select lives_ok(
  $$ insert into projects (id, name, status)
     values ('a2222222-0000-0000-0000-000000000002','Default-org insert','Leads') $$,
  'AC-103b: insert WITHOUT org_id now succeeds (trigger stamps caller''s own org, not the seed default)');
select is(
  (select org_id from projects where id = 'a2222222-0000-0000-0000-000000000002'),
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'AC-103b: the stamped org_id is org A (the caller''s real org), not the seed-org column default');

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
