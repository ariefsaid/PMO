-- 0047_timesheet_entry_own_draft.test.sql
-- AC-TSE-023 / FR-TSE-018 / NFR-TSE-SEC-001: the hardened WITH CHECK requires the post-image
-- entry's parent timesheet to be the caller's OWN and in Draft. A user cannot write onto their
-- own Submitted (non-Draft) sheet, but can write onto their own Draft sheet (no over-restrict).
begin;
select plan(2);

-- Fixtures: one org; user A; one Active project; A owns a Submitted sheet TS and a Draft sheet TD.
insert into organizations (id, name) values
  ('00470000-0000-0000-0000-000000000001','TSE OwnDraft Org');

insert into auth.users (id, email) values
  ('00470000-0000-0000-0000-0000000000a1','tse-od-a@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00470000-0000-0000-0000-0000000000a1','00470000-0000-0000-0000-000000000001','OD A','tse-od-a@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('00470000-0000-0000-0000-000000000010','00470000-0000-0000-0000-000000000001','OD Project','Ongoing Project');

-- TS is for week 2026-06-01, TD for week 2026-06-08 (both Mondays; satisfies week_is_monday and
-- unique(user_id, week_start_date)).
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00470000-0000-0000-0000-000000000071','00470000-0000-0000-0000-000000000001','00470000-0000-0000-0000-0000000000a1','2026-06-01','Submitted'),
  ('00470000-0000-0000-0000-000000000074','00470000-0000-0000-0000-000000000001','00470000-0000-0000-0000-0000000000a1','2026-06-08','Draft');

-- Become user A.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00470000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- AC-TSE-023: A cannot INSERT an entry onto A's own Submitted sheet (status != Draft).
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00470000-0000-0000-0000-000000000071',
               '00470000-0000-0000-0000-000000000010', '2026-06-01', 8) $$,
  '42501', null,
  'AC-TSE-023: A cannot INSERT an entry onto A''s own Submitted sheet');

-- AC-TSE-023: A CAN INSERT a valid entry onto A's own Draft sheet.
select lives_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00470000-0000-0000-0000-000000000074',
               '00470000-0000-0000-0000-000000000010', '2026-06-08', 8) $$,
  'AC-TSE-023: A can INSERT a valid entry onto A''s own Draft sheet');

reset role;
select * from finish();
rollback;
