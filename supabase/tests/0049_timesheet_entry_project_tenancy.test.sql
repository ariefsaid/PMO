-- 0049_timesheet_entry_project_tenancy.test.sql
-- NFR-TSE-TENANCY-001 / FR-TSE-018: the hardened timesheet_entries_write policy also guards the
-- parent PROJECT's org — an org-A user CANNOT persist an org-B project_id onto their OWN org-A
-- Draft entry (the security-auditor's live-exploit defect: every sibling child-table policy in
-- 0002_rls.sql 'audit HIGH-2' carries this parent-org guard; the entry policy now does too).
-- INSERT and UPDATE-repoint to an org-B project are rejected with SQLSTATE 42501; INSERT with an
-- own org-A project still succeeds (no over-restrict).
-- Template: 0046/0048 (JWT-switch + throws_ok/lives_ok).
begin;
select plan(3);

-- Fixtures: org-A + org-B. User A in org-A owns a Draft sheet TA with one own org-A entry EA on
-- the org-A project. org-B has its own project PB. (The entry's org_id always = A's org so the
-- existing org_id/own/Draft guards pass — isolating the project-parent guard.)
insert into organizations (id, name) values
  ('00490000-0000-0000-0000-00000000000a','TSE Proj Tenancy Org A'),
  ('00490000-0000-0000-0000-00000000000b','TSE Proj Tenancy Org B');

insert into auth.users (id, email) values
  ('00490000-0000-0000-0000-0000000000a1','tse-pt-a@example.com');

insert into profiles (id, org_id, full_name, email, role) values
  ('00490000-0000-0000-0000-0000000000a1','00490000-0000-0000-0000-00000000000a','PT A','tse-pt-a@example.com','Engineer');

insert into projects (id, org_id, name, status) values
  ('00490000-0000-0000-0000-0000000000a9','00490000-0000-0000-0000-00000000000a','PT Project A','Ongoing Project'),
  ('00490000-0000-0000-0000-0000000000b9','00490000-0000-0000-0000-00000000000b','PT Project B','Ongoing Project');

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('00490000-0000-0000-0000-000000000a01','00490000-0000-0000-0000-00000000000a','00490000-0000-0000-0000-0000000000a1','2026-06-01','Draft');

insert into timesheet_entries (id, org_id, timesheet_id, project_id, entry_date, hours) values
  ('00490000-0000-0000-0000-0000000000ea','00490000-0000-0000-0000-00000000000a','00490000-0000-0000-0000-000000000a01','00490000-0000-0000-0000-0000000000a9','2026-06-01',8);

-- Become user A (org-A).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00490000-0000-0000-0000-0000000000a1","role":"authenticated"}';

-- NFR-TSE-TENANCY-001: A cannot INSERT an entry onto her OWN org-A Draft sheet that references an
-- org-B project (the project-parent org guard rejects the post-image).
select throws_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00490000-0000-0000-0000-000000000a01',
               '00490000-0000-0000-0000-0000000000b9', '2026-06-02', 8) $$,
  '42501', null,
  'NFR-TSE-TENANCY-001: A cannot INSERT an own entry referencing an org-B project (project-parent guard)');

-- NFR-TSE-TENANCY-001: A cannot UPDATE-repoint her OWN org-A entry to an org-B project (post-image
-- fails the project-parent org guard).
select throws_ok(
  $$ update timesheet_entries set project_id = '00490000-0000-0000-0000-0000000000b9'
       where id = '00490000-0000-0000-0000-0000000000ea' $$,
  '42501', null,
  'NFR-TSE-TENANCY-001: A cannot UPDATE-repoint an own entry to an org-B project (project-parent guard)');

-- FR-TSE-018: A CAN still INSERT an entry referencing her OWN org-A project (no over-restrict).
select lives_ok(
  $$ insert into timesheet_entries (org_id, timesheet_id, project_id, entry_date, hours)
       values (auth_org_id(), '00490000-0000-0000-0000-000000000a01',
               '00490000-0000-0000-0000-0000000000a9', '2026-06-03', 4) $$,
  'FR-TSE-018: A can still INSERT an entry referencing her own org-A project (no over-restrict)');

reset role;
select * from finish();
rollback;
