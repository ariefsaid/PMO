-- 0046_timesheet_entry_with_check.test.sql
-- AC-TSE-022 / FR-TSE-018 / NFR-TSE-SEC-002: the hardened timesheet_entries_write WITH CHECK
-- closes the write-time hole — a same-org user CANNOT write an entry onto another user's sheet
-- (INSERT a new entry pointing at B's sheet, or UPDATE an own entry to point at B's sheet), but
-- CAN still update hours on their own Draft entry (no over-restrict). RLS WITH CHECK violations
-- surface as SQLSTATE 42501 (as 0033 establishes).
-- Template: 0033_project_direct_update_revoked.test.sql (JWT-switch + throws_ok).
begin;
select plan(3);

-- Fixtures: one org; users A and B (both profiles); one Active project; A has a Draft sheet TA
-- with one own entry EA; B has a Draft sheet TB.
insert into organizations (id, name) values
  ('00460000-0000-0000-0000-000000000001','TSE WithCheck Org');

insert into auth.users (id, email) values
  ('00460000-0000-0000-0000-0000000000a1','tse-wc-a@example.com'),
  ('00460000-0000-0000-0000-0000000000b1','tse-wc-b@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00460000-0000-0000-0000-0000000000a1','00460000-0000-0000-0000-000000000001','WC A','tse-wc-a@example.com','Engineer'),
  ('00460000-0000-0000-0000-0000000000b1','00460000-0000-0000-0000-000000000001','WC B','tse-wc-b@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('00460000-0000-0000-0000-000000000010','00460000-0000-0000-0000-000000000001','WC Project','Ongoing Project');

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00460000-0000-0000-0000-000000000a01','00460000-0000-0000-0000-000000000001','00460000-0000-0000-0000-0000000000a1','2026-06-01','Draft'),
  ('00460000-0000-0000-0000-000000000b01','00460000-0000-0000-0000-000000000001','00460000-0000-0000-0000-0000000000b1','2026-06-01','Draft');

insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('00460000-0000-0000-0000-0000000000ea','00460000-0000-0000-0000-000000000001','00460000-0000-0000-0000-000000000a01','00460000-0000-0000-0000-000000000010','2026-06-01',8);

-- Become user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00460000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-TSE-022: A cannot INSERT an entry onto B's sheet (hardened WITH CHECK rejects the post-image).
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00460000-0000-0000-0000-000000000b01',
               '00460000-0000-0000-0000-000000000010', '2026-06-02', 8) $$,
  '42501', null,
  'AC-TSE-022: A cannot INSERT an entry onto B''s sheet (hardened WITH CHECK)');

-- AC-TSE-022: A cannot UPDATE an own entry to point at B's sheet (post-image fails WITH CHECK).
select throws_ok(
  $$ update timesheet_entries set timesheet_id = '00460000-0000-0000-0000-000000000b01'
       where id = '00460000-0000-0000-0000-0000000000ea' $$,
  '42501', null,
  'AC-TSE-022: A cannot UPDATE an entry to point at B''s sheet');

-- AC-TSE-022: A CAN still update hours on A's own Draft entry (no over-restrict).
select lives_ok(
  $$ update timesheet_entries set hours = 6
       where id = '00460000-0000-0000-0000-0000000000ea' $$,
  'AC-TSE-022: A can still update hours on A''s own Draft entry (no over-restrict)');

reset role;
select * from finish();
rollback;
