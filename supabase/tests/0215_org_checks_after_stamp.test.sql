-- 0215_org_checks_after_stamp.test.sql — #632. (1) Catalog guard: no BEFORE INSERT trigger that reads
-- NEW.org_id and raises sorts before its table's org stamp. (2) The three journeys as a SECOND-org
-- user: /action task from a meeting, a sub-task, an incident report. (3) Mutation, last: renaming one
-- check back in front of the stamp turns the guard red and the insert dies.
begin;
select plan(7);

create temp view org_checks_before_stamp as
  with st as (
    select t.tgrelid, t.tgname from pg_trigger t join pg_proc f on f.oid = t.tgfoid
    where not t.tgisinternal and f.proname = 'stamp_org_id')
  select t.tgrelid::regclass::text || '.' || t.tgname as trg
  from pg_trigger t join pg_proc f on f.oid = t.tgfoid join st on st.tgrelid = t.tgrelid
  where not t.tgisinternal and t.tgname <> st.tgname
    and t.tgtype::int & 2 = 2 and t.tgtype::int & 4 = 4
    and t.tgname < st.tgname
    and f.prosrc ~* 'new\.org_id' and f.prosrc ~* 'raise';

select is((select coalesce(string_agg(trg, ', ' order by trg), '') from org_checks_before_stamp), '',
  'AC-ORGSTAMP-020: no org check fires before the org stamp on any table');

insert into organizations (id, name) values ('cccccccc-0000-0000-0000-00000000000c','Org C (non-seed)');
insert into auth.users (id, email) values ('c0000000-0000-0000-0000-0000000000c1','c@example.com');
insert into profiles (id, org_id, full_name, email, role) values
  ('c0000000-0000-0000-0000-0000000000c1','cccccccc-0000-0000-0000-00000000000c','PM C','c@example.com','Project Manager');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('c1111111-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c','Org C project','Leads','c0000000-0000-0000-0000-0000000000c1');
insert into meetings (id, org_id, title, project_id, created_by_id) values
  ('c2222222-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c','Org C kickoff','c1111111-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000c1');
insert into tasks (id, org_id, project_id, name, status) values
  ('c3333333-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-00000000000c','c1111111-0000-0000-0000-000000000001','Org C parent','To Do');

set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}';

-- AC-ORGSTAMP-021: /action task from a meeting, no org_id sent (the DAL shape).
select lives_ok(
  $$ insert into tasks (project_id, meeting_id, name, status)
     values ('c1111111-0000-0000-0000-000000000001','c2222222-0000-0000-0000-000000000001','From minutes','To Do') $$,
  'AC-ORGSTAMP-021: second-org user publishes an /action task from a meeting');
-- AC-ORGSTAMP-022: a sub-task.
select lives_ok(
  $$ insert into tasks (project_id, parent_task_id, name, status)
     values ('c1111111-0000-0000-0000-000000000001','c3333333-0000-0000-0000-000000000001','Sub','To Do') $$,
  'AC-ORGSTAMP-022: second-org user creates a sub-task');
-- AC-ORGSTAMP-023: an incident report on the project.
select lives_ok(
  $$ insert into incident_reports (project_id, incident_date, type, severity, description, reported_by)
     values ('c1111111-0000-0000-0000-000000000001', current_date, 'Near miss', 'Low', 'desc', 'c0000000-0000-0000-0000-0000000000c1') $$,
  'AC-ORGSTAMP-023: second-org user files an incident report');
select is((select count(*)::int from tasks where org_id = 'cccccccc-0000-0000-0000-00000000000c' and name in ('From minutes','Sub')), 2,
  'AC-ORGSTAMP-021b: both tasks landed in Org C');

-- Mutation, last (transaction rollback undoes it; no savepoint — that would also undo pgTAP's counter).
reset role;
alter trigger tasks_zz_check_meeting_same_project on public.tasks rename to tasks_check_meeting_same_project;
select is((select string_agg(trg, ', ') from org_checks_before_stamp), 'tasks.tasks_check_meeting_same_project',
  'MUTATION: with the check renamed in front of the stamp the guard names it');
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select throws_ok(
  $$ insert into tasks (project_id, meeting_id, name, status)
     values ('c1111111-0000-0000-0000-000000000001','c2222222-0000-0000-0000-000000000001','From minutes 2','To Do') $$,
  '42501', null,
  'MUTATION: the /action insert is refused again — the bug this test guards');

select * from finish();
rollback;
