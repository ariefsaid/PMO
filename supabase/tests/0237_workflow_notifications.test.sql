-- 0237_workflow_notifications.test.sql — AC-WFN-001..004 (#788).
begin;
select plan(13);

insert into organizations (id, name) values
  ('02320000-0000-0000-0000-000000000001','WFN Org A'),
  ('02320000-0000-0000-0000-000000000002','WFN Org B');
insert into auth.users (id, email) values
  ('02320000-0000-0000-0000-0000000000a1','wfn-emp@example.com'),
  ('02320000-0000-0000-0000-0000000000a2','wfn-mgr@example.com'),
  ('02320000-0000-0000-0000-0000000000a3','wfn-eng@example.com'),
  ('02320000-0000-0000-0000-0000000000a4','wfn-pm@example.com'),
  ('02320000-0000-0000-0000-0000000000a5','wfn-fin@example.com'),
  ('02320000-0000-0000-0000-0000000000b1','wfn-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('02320000-0000-0000-0000-0000000000a1','02320000-0000-0000-0000-000000000001','Emp','wfn-emp@example.com','Engineer'),
  ('02320000-0000-0000-0000-0000000000a2','02320000-0000-0000-0000-000000000001','Mgr','wfn-mgr@example.com','Engineer'),
  ('02320000-0000-0000-0000-0000000000a3','02320000-0000-0000-0000-000000000001','Eng','wfn-eng@example.com','Engineer'),
  ('02320000-0000-0000-0000-0000000000a4','02320000-0000-0000-0000-000000000001','PM','wfn-pm@example.com','Project Manager'),
  ('02320000-0000-0000-0000-0000000000a5','02320000-0000-0000-0000-000000000001','Fin','wfn-fin@example.com','Finance'),
  ('02320000-0000-0000-0000-0000000000b1','02320000-0000-0000-0000-000000000002','PM B','wfn-pm-b@example.com','Project Manager');
update profiles set manager_id = '02320000-0000-0000-0000-0000000000a2'
 where id = '02320000-0000-0000-0000-0000000000a1';

insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('02320000-0000-0000-0000-000000000020','02320000-0000-0000-0000-000000000001',
   '02320000-0000-0000-0000-0000000000a1','2026-01-05','Draft');
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('02320000-0000-0000-0000-000000000010','02320000-0000-0000-0000-000000000001','WFN Proc','Draft',
   '02320000-0000-0000-0000-0000000000a1');

-- Employee submits the timesheet and the procurement.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select transition_timesheet('02320000-0000-0000-0000-000000000020','Submitted');
select transition_procurement('02320000-0000-0000-0000-000000000010','Requested');
reset role;

select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000a2'
            and metadata->'entity'->>'type' = 'timesheet'), 1,
  'AC-WFN-001 the line manager is notified of the submitted timesheet');
select is((select count(*)::int from notifications where metadata->'entity'->>'type' = 'timesheet'
            and owner_id in ('02320000-0000-0000-0000-0000000000a1','02320000-0000-0000-0000-0000000000a3',
                             '02320000-0000-0000-0000-0000000000a4','02320000-0000-0000-0000-0000000000a5')), 0,
  'AC-WFN-004 owner and same-org users who cannot open/approve the timesheet get nothing');
select is((select count(*)::int from notifications where metadata->'entity'->>'id' = '02320000-0000-0000-0000-000000000010'
            and owner_id in ('02320000-0000-0000-0000-0000000000a4','02320000-0000-0000-0000-0000000000a5')), 2,
  'AC-WFN-001 PM and Finance are notified of the requested procurement');
select is((select count(*)::int from notifications where metadata->'entity'->>'id' = '02320000-0000-0000-0000-000000000010'
            and owner_id in ('02320000-0000-0000-0000-0000000000a1','02320000-0000-0000-0000-0000000000a3')), 0,
  'AC-WFN-004 requester and an Engineer (cannot approve) are not notified');
select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000b1'), 0,
  'AC-WFN-004 a user in another org gets nothing');

-- Decisions notify the submitter.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_timesheet('02320000-0000-0000-0000-000000000020','Approved');
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select transition_procurement('02320000-0000-0000-0000-000000000010','Rejected','Missing quote');
reset role;

select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000a1'
            and title = 'Your timesheet was approved'), 1, 'AC-WFN-002 the submitter is told the timesheet was approved');
select is((select body from notifications where owner_id = '02320000-0000-0000-0000-0000000000a1'
            and title = 'Your procurement was rejected'), 'Missing quote',
  'AC-WFN-002 the rejection comment reaches the requester');
select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000a4'
            and title like 'Your %'), 0, 'AC-WFN-002 the deciding approver is never notified of their own decision');

-- Task assignment.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('02320000-0000-0000-0000-000000000030','02320000-0000-0000-0000-000000000001','WFN Proj','Ongoing Project',date '2026-01-01',date '2026-12-31');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into tasks (org_id, project_id, name, assignee_id) values
  ('02320000-0000-0000-0000-000000000001','02320000-0000-0000-0000-000000000030','Assigned elsewhere','02320000-0000-0000-0000-0000000000a3'),
  ('02320000-0000-0000-0000-000000000001','02320000-0000-0000-0000-000000000030','Self assigned','02320000-0000-0000-0000-0000000000a4');
reset role;
select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000a3'
            and title = 'A task was assigned to you'), 1, 'AC-WFN-003 the assignee is notified');
select is((select count(*)::int from notifications where owner_id = '02320000-0000-0000-0000-0000000000a4'
            and title = 'A task was assigned to you'), 0, 'AC-WFN-003 assigning to yourself notifies nobody');

-- Read isolation + no client writes for another user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02320000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from notifications), 0, 'AC-WFN-004 an other-org user cannot read any of these notifications');
select throws_ok(
  $$ insert into notifications (org_id, owner_id, title) values
     ('02320000-0000-0000-0000-000000000002','02320000-0000-0000-0000-0000000000a1','forged') $$,
  '42501', null, 'AC-WFN-004 a client cannot insert a notification for another user');
reset role;
set local role anon;
select is((select count(*)::int from notifications), 0, 'AC-WFN-004 anon reads no notifications');

select * from finish();
rollback;
