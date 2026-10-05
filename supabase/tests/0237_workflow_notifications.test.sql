-- 0237_workflow_notifications.test.sql — AC-WFN-001..004 (#788).
-- Each recipient rule has a case where breaking that rule changes the recipient set (mutation-checked):
--   requester exclusion · actor exclusion · active-member gate (disabled + banned) · Admin/Executive arms
--   (Executive only when the owner has no line manager) · task cross-org assignee · empty approval note.
begin;
select plan(23);

insert into organizations (id, name) values
  ('02370000-0000-0000-0000-000000000001','WFN Org A'),
  ('02370000-0000-0000-0000-000000000002','WFN Org B');
insert into auth.users (id, email) values
  ('02370000-0000-0000-0000-0000000000a1','wfn-emp@example.com'),
  ('02370000-0000-0000-0000-0000000000a2','wfn-mgr@example.com'),
  ('02370000-0000-0000-0000-0000000000a3','wfn-eng@example.com'),
  ('02370000-0000-0000-0000-0000000000a4','wfn-pm@example.com'),
  ('02370000-0000-0000-0000-0000000000a5','wfn-fin@example.com'),
  ('02370000-0000-0000-0000-0000000000a6','wfn-admin@example.com'),
  ('02370000-0000-0000-0000-0000000000a7','wfn-exec@example.com'),
  ('02370000-0000-0000-0000-0000000000a8','wfn-pm-disabled@example.com'),
  ('02370000-0000-0000-0000-0000000000a9','wfn-pm-banned@example.com'),
  ('02370000-0000-0000-0000-0000000000b1','wfn-pm-b@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('02370000-0000-0000-0000-0000000000a1','02370000-0000-0000-0000-000000000001','Emp','wfn-emp@example.com','Engineer','active'),
  ('02370000-0000-0000-0000-0000000000a2','02370000-0000-0000-0000-000000000001','Mgr','wfn-mgr@example.com','Engineer','active'),
  ('02370000-0000-0000-0000-0000000000a3','02370000-0000-0000-0000-000000000001','Eng (no manager)','wfn-eng@example.com','Engineer','active'),
  ('02370000-0000-0000-0000-0000000000a4','02370000-0000-0000-0000-000000000001','PM','wfn-pm@example.com','Project Manager','active'),
  ('02370000-0000-0000-0000-0000000000a5','02370000-0000-0000-0000-000000000001','Fin','wfn-fin@example.com','Finance','active'),
  ('02370000-0000-0000-0000-0000000000a6','02370000-0000-0000-0000-000000000001','Admin','wfn-admin@example.com','Admin','active'),
  ('02370000-0000-0000-0000-0000000000a7','02370000-0000-0000-0000-000000000001','Exec','wfn-exec@example.com','Executive','active'),
  ('02370000-0000-0000-0000-0000000000a8','02370000-0000-0000-0000-000000000001','PM disabled','wfn-pm-disabled@example.com','Project Manager','disabled'),
  ('02370000-0000-0000-0000-0000000000a9','02370000-0000-0000-0000-000000000001','PM banned','wfn-pm-banned@example.com','Project Manager','active'),
  ('02370000-0000-0000-0000-0000000000b1','02370000-0000-0000-0000-000000000002','PM B','wfn-pm-b@example.com','Project Manager','active');
update auth.users set banned_until = now() + interval '1 day' where id = '02370000-0000-0000-0000-0000000000a9';
update profiles set manager_id = '02370000-0000-0000-0000-0000000000a2'
 where id = '02370000-0000-0000-0000-0000000000a1';

-- T1: owner has a line manager. T2: owner has none.
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('02370000-0000-0000-0000-000000000021','02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-0000000000a1','2026-01-05','Draft'),
  ('02370000-0000-0000-0000-000000000022','02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-0000000000a3','2026-01-05','Draft');
-- P1: requested+submitted by the Engineer. P2: requester is the PM but a DIFFERENT user (Engineer) submits.
-- P3: requested by the Engineer but the ADMIN (an approver-role user) submits.
insert into procurements (id, org_id, title, status, requested_by_id) values
  ('02370000-0000-0000-0000-000000000011','02370000-0000-0000-0000-000000000001','WFN Proc 1','Draft','02370000-0000-0000-0000-0000000000a1'),
  ('02370000-0000-0000-0000-000000000012','02370000-0000-0000-0000-000000000001','WFN Proc 2','Draft','02370000-0000-0000-0000-0000000000a4'),
  ('02370000-0000-0000-0000-000000000013','02370000-0000-0000-0000-000000000001','WFN Proc 3','Draft','02370000-0000-0000-0000-0000000000a3');

-- Owners notified about one entity, as a sorted array.
create function pg_temp.who(p_entity uuid) returns text[] language sql stable as $$
  select coalesce(array_agg(right(owner_id::text, 2) order by owner_id::text), array[]::text[])
    from notifications where metadata->'entity'->>'id' = p_entity::text and title like '%awaiting%' $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select transition_timesheet('02370000-0000-0000-0000-000000000021','Submitted');
select transition_procurement('02370000-0000-0000-0000-000000000011','Requested');
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select transition_timesheet('02370000-0000-0000-0000-000000000022','Submitted');
select transition_procurement('02370000-0000-0000-0000-000000000012','Requested');
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a6","role":"authenticated"}';
select transition_procurement('02370000-0000-0000-0000-000000000013','Requested');
reset role;

-- Timesheet submit: line manager + Admin; Executive ONLY when the owner has no manager; never the owner.
select is(pg_temp.who('02370000-0000-0000-0000-000000000021'), array['a2','a6'],
  'AC-WFN-001 manager-ed timesheet: the line manager and the Admin are notified, nobody else');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a6'
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000021'), 1,
  'AC-WFN-001 the Admin (break-glass arm) is notified of a submitted timesheet');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a7'
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000021'), 0,
  'AC-WFN-004 an Executive is NOT notified when the owner has a line manager');
select is(pg_temp.who('02370000-0000-0000-0000-000000000022'), array['a6','a7'],
  'AC-WFN-001 manager-less timesheet: the Executive fallback and the Admin are notified, never the owner');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a1'
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000021'), 0,
  'AC-WFN-004 the timesheet owner is not notified of their own submission');

-- Procurement submit: every active approver-role user in the org, minus the requester and the actor.
select is(pg_temp.who('02370000-0000-0000-0000-000000000011'), array['a4','a5','a6','a7'],
  'AC-WFN-001 requested procurement: PM, Finance, Admin and Executive are notified; Engineers are not');
select is((select count(*)::int from notifications where owner_id in
            ('02370000-0000-0000-0000-0000000000a8','02370000-0000-0000-0000-0000000000a9')
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000011'), 0,
  'AC-WFN-004 a disabled PM and a banned PM get nothing (active-member gate)');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000b1'), 0,
  'AC-WFN-004 a user in another org gets nothing');
select is(pg_temp.who('02370000-0000-0000-0000-000000000012'), array['a5','a6','a7'],
  'AC-WFN-004 the PM who is the REQUESTER is not told to approve their own request (submitted by someone else)');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a4'
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000012'), 0,
  'AC-WFN-004 requester exclusion: the PM requester has no notification for their own procurement');
select is(pg_temp.who('02370000-0000-0000-0000-000000000013'), array['a4','a5','a7'],
  'AC-WFN-004 the Admin who SUBMITS (an approver-role candidate) is not notified of their own action');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a6'
            and metadata->'entity'->>'id' = '02370000-0000-0000-0000-000000000013'), 0,
  'AC-WFN-004 actor exclusion: the acting Admin has no notification for the procurement they submitted');

-- Decisions notify the submitter (never the decider).
set local role authenticated;
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select transition_timesheet('02370000-0000-0000-0000-000000000021','Approved');
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select transition_procurement('02370000-0000-0000-0000-000000000011','Rejected','Missing quote');
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select transition_procurement('02370000-0000-0000-0000-000000000012','Approved','   ');
reset role;

select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a1'
            and title = 'Your timesheet was approved'), 1, 'AC-WFN-002 the submitter is told the timesheet was approved');
select is((select body from notifications where owner_id = '02370000-0000-0000-0000-0000000000a1'
            and title = 'Your procurement was rejected'), 'Missing quote',
  'AC-WFN-002 the rejection comment reaches the requester');
select is((select body from notifications where owner_id = '02370000-0000-0000-0000-0000000000a4'
            and title = 'Your procurement was approved'), 'WFN Proc 2',
  'AC-WFN-002 an empty approval note falls back to the procurement title');
select is((select count(*)::int from notifications where owner_id in
            ('02370000-0000-0000-0000-0000000000a2','02370000-0000-0000-0000-0000000000a5')
            and title like 'Your %'), 0, 'AC-WFN-002 the deciding approvers are not notified of their own decision');

-- Task assignment.
insert into projects (id, org_id, name, status, start_date, end_date) values
  ('02370000-0000-0000-0000-000000000030','02370000-0000-0000-0000-000000000001','WFN Proj','Ongoing Project',date '2026-01-01',date '2026-12-31');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into tasks (org_id, project_id, name, assignee_id) values
  ('02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-000000000030','Assigned elsewhere','02370000-0000-0000-0000-0000000000a3'),
  ('02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-000000000030','Self assigned','02370000-0000-0000-0000-0000000000a4'),
  ('02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-000000000030','Assigned to a disabled user','02370000-0000-0000-0000-0000000000a8');
reset role;
-- Cross-org assignee: a task row of org A pointing at org B's PM (inserted as the table owner so no
-- RLS/FK-adjacent guard can pre-empt the trigger; the actor is still a human JWT).
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into tasks (org_id, project_id, name, assignee_id) values
  ('02370000-0000-0000-0000-000000000001','02370000-0000-0000-0000-000000000030','Assigned across orgs','02370000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a3'
            and title = 'A task was assigned to you'), 1, 'AC-WFN-003 the assignee is notified');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a4'
            and title = 'A task was assigned to you'), 0, 'AC-WFN-003 assigning to yourself notifies nobody');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000a8'
            and title = 'A task was assigned to you'), 0, 'AC-WFN-003 a disabled assignee is not notified');
select is((select count(*)::int from notifications where owner_id = '02370000-0000-0000-0000-0000000000b1'
            and title = 'A task was assigned to you'), 0, 'AC-WFN-004 a task assigned to another org''s user notifies nobody');

-- Read isolation + no client writes for another user.
set local role authenticated;
set local request.jwt.claims = '{"sub":"02370000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select count(*)::int from notifications), 0, 'AC-WFN-004 an other-org user cannot read any of these notifications');
select throws_ok(
  $$ insert into notifications (org_id, owner_id, title) values
     ('02370000-0000-0000-0000-000000000002','02370000-0000-0000-0000-0000000000a1','forged') $$,
  '42501', null, 'AC-WFN-004 a client cannot insert a notification for another user');
reset role;
set local role anon;
select is((select count(*)::int from notifications), 0, 'AC-WFN-004 anon reads no notifications');

select * from finish();
rollback;
