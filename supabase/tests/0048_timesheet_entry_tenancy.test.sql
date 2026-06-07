-- 0048_timesheet_entry_tenancy.test.sql
-- AC-TSE-024 / NFR-TSE-TENANCY-001: a user in org-A cannot write an entry referencing a timesheet
-- in org-B, regardless of the org_id value supplied. Both the auth_org_id()-supplied variant (the
-- org match fails) and the explicit-foreign-org_id literal variant (the WITH CHECK org clause +
-- the ownership exists() both fail) are rejected with SQLSTATE 42501.
begin;
select plan(2);

-- Fixtures: org-A + org-B; user A in org-A; a Draft timesheet TBORG owned by user B in org-B; an
-- Active project in org-B.
insert into organizations (id, name) values
  ('00480000-0000-0000-0000-00000000000a','TSE Tenancy Org A'),
  ('00480000-0000-0000-0000-00000000000b','TSE Tenancy Org B');

insert into auth.users (id, email) values
  ('00480000-0000-0000-0000-0000000000a1','tse-tn-a@example.com'),
  ('00480000-0000-0000-0000-0000000000b1','tse-tn-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00480000-0000-0000-0000-0000000000a1','00480000-0000-0000-0000-00000000000a','TN A','tse-tn-a@example.com','Engineer'),
  ('00480000-0000-0000-0000-0000000000b1','00480000-0000-0000-0000-00000000000b','TN B','tse-tn-b@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('00480000-0000-0000-0000-0000000000b9','00480000-0000-0000-0000-00000000000b','TN Project B','Ongoing Project');

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00480000-0000-0000-0000-000000000081','00480000-0000-0000-0000-00000000000b','00480000-0000-0000-0000-0000000000b1','2026-06-01','Draft');

-- Become user A (org-A).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00480000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-TSE-024: A (org-A) cannot write an entry referencing an org-B timesheet, supplying her own
-- org via auth_org_id() (org mismatch + ownership exists() both block).
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00480000-0000-0000-0000-000000000081',
               '00480000-0000-0000-0000-0000000000b9', '2026-06-01', 8) $$,
  '42501', null,
  'AC-TSE-024: A (org-A) cannot write an entry referencing an org-B timesheet (auth_org_id())');

-- AC-TSE-024: A cannot smuggle the entry in by supplying org-B's org_id literal either (the
-- org_id = auth_org_id() WITH CHECK clause rejects the foreign org_id).
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values ('00480000-0000-0000-0000-00000000000b', '00480000-0000-0000-0000-000000000081',
               '00480000-0000-0000-0000-0000000000b9', '2026-06-01', 8) $$,
  '42501', null,
  'AC-TSE-024: A cannot write an entry with an explicit foreign org_id literal either');

reset role;
select * from finish();
rollback;
