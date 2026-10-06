-- record_changes_bulk.test.sql — #719 record change history, bulk volume (spec NFR-CHG-007, risk 1).
-- AC-CHG-014: a 500-row UPDATE in one statement writes 500 events, each with the correct old and new value,
-- within the suite's timing envelope; a bulk update writes one event per CHANGED row and none for rows it left
-- as they were. Tasks are the table under test: the highest edit rate and the 0209 cascades.
-- Migration under test: 0260_record_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(8);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Bulk', 'Ongoing Project');
insert into tasks (org_id, project_id, name, status, start_date, end_date)
  select '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 'Bulk task ' || g,
         case when g % 2 = 0 then 'In Progress' else 'To Do' end::task_status,
         date '2026-01-01' + g, date '2026-03-01' + g
    from generate_series(1, 500) g;

select is(
  (select count(*)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'insert'),
  500, 'AC-CHG-014 a 500-row insert writes 500 insert events, without values');

-- ── one 500-row UPDATE statement as the PM ──────────────────────────────────────────────────────
create temp table chg_clock (started timestamptz, finished timestamptz) on commit drop;
grant all on chg_clock to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
insert into chg_clock (started) values (clock_timestamp());
update tasks set end_date = end_date + 7 where project_id = '07190000-0000-0000-0000-0000000000c1';
update chg_clock set finished = clock_timestamp();
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'update'),
  500, 'AC-CHG-014 a 500-row UPDATE statement writes exactly 500 events');
select is(
  (select count(*)::int from record_changes rc join tasks t on t.id = rc.entity_id
    where rc.entity_type = 'task' and rc.op = 'update'
      and rc.changes = jsonb_build_object('end_date', jsonb_build_object(
            'old', to_jsonb(t.end_date - 7), 'new', to_jsonb(t.end_date)))
      and rc.actor_id = '07190000-0000-0000-0000-0000000000a4'),
  500, 'AC-CHG-014 every event holds that row''s own old and new end_date and the PM as actor');
select is(
  (select count(distinct entity_id)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'update'),
  500, 'AC-CHG-014 one event per row: 500 distinct tasks');
select ok((select finished - started < interval '10 seconds' from chg_clock),
  'AC-CHG-014 the 500-row update with capture completes inside the 10 s envelope');

-- ── a bulk update that changes half the rows ────────────────────────────────────────────────────
update tasks set status = 'In Progress' where project_id = '07190000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'update'
      and changes ? 'status'),
  250, 'AC-CHG-014 a bulk status update writes events only for the 250 rows it changed');
select is(
  (select count(*)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'update'
      and changes = '{"status":{"old":"To Do","new":"In Progress"}}'::jsonb),
  250, 'AC-CHG-014 each of those events is the To Do -> In Progress move');

-- ── a bulk no-op update writes nothing ──────────────────────────────────────────────────────────
update tasks set name = name, end_date = end_date where project_id = '07190000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from record_changes
    where parent_id = '07190000-0000-0000-0000-0000000000c1' and entity_type = 'task' and op = 'update'),
  750, 'AC-CHG-014 a 500-row no-op update adds no event (500 date + 250 status events, unchanged)');

select * from finish();
rollback;
