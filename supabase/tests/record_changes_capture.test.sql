-- record_changes_capture.test.sql — #719 record change history, capture (spec D1).
-- AC-CHG-001 one event per statement-row with old+new for each changed captured column ·
-- AC-CHG-002 no event for bookkeeping-only or same-value updates · AC-CHG-003 insert event ·
-- AC-CHG-006 parent roll-up (direct column and the one-hop budget-line / procurement-child cases) ·
-- AC-CHG-012 soft-archive then restore · AC-CHG-013 a rolled-back change leaves no event.
-- Migration under test: 0260_record_change_history.sql.
-- Cast (org A): a1 Admin · a4 PM. Fixtures are written as the owner with no JWT (actor null).
begin;
create extension if not exists pgtap;
select plan(22);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com'),
  ('07190000-0000-0000-0000-0000000000a4', 'chg-pm@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active'),
  ('07190000-0000-0000-0000-0000000000a4', '07190000-0000-0000-0000-000000000001', 'CHG PM', 'chg-pm@example.com', 'Project Manager', 'active');
insert into projects (id, org_id, code, name, status, start_date, end_date) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project', '2026-01-01', '2026-06-30');
insert into tasks (id, org_id, project_id, name, status, start_date, end_date) values
  ('07190000-0000-0000-0000-0000000000d1', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 'Survey', 'To Do', '2026-02-01', '2026-02-10');
insert into budget_versions (id, org_id, project_id, version, name, status, currency) values
  ('07190000-0000-0000-0000-0000000000e1', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 1, 'V1', 'Draft', 'USD');
insert into budget_line_items (id, org_id, budget_version_id, category, budgeted_amount) values
  ('07190000-0000-0000-0000-0000000000e2', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000e1', 'Labor', 100);
insert into procurements (id, org_id, title, status, project_id) values
  ('07190000-0000-0000-0000-0000000000f1', '07190000-0000-0000-0000-000000000001', 'CHG Proc', 'Draft', '07190000-0000-0000-0000-0000000000c1');
insert into purchase_orders (id, org_id, procurement_id, po_number, status, amount) values
  ('07190000-0000-0000-0000-0000000000f2', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000f1', 'PO-CHG-1', 'Draft', 500);

-- ── AC-CHG-001: PM updates name and end_date in one statement ─────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update projects set name = 'Alpha Renamed', end_date = '2026-07-31'
 where id = '07190000-0000-0000-0000-0000000000c1';
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  1, 'AC-CHG-001 one update writes exactly one event');
select is(
  (select changes from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  '{"name":{"old":"Alpha","new":"Alpha Renamed"},"end_date":{"old":"2026-06-30","new":"2026-07-31"}}'::jsonb,
  'AC-CHG-001 the event holds old and new for exactly the two changed columns');
select is(
  (select actor_id from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  '07190000-0000-0000-0000-0000000000a4'::uuid, 'AC-CHG-001 the actor is the PM');
select ok(
  (select parent_type is null and parent_id is null
          and org_id = '07190000-0000-0000-0000-000000000001'
     from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  'AC-CHG-001 a project has no parent and the event carries the row''s org');

-- ── AC-CHG-002: bookkeeping-only and same-value updates write nothing ────────────────────────────
update projects set last_update = now() + interval '1 hour' where id = '07190000-0000-0000-0000-0000000000c1';
update projects set name = name, end_date = end_date where id = '07190000-0000-0000-0000-0000000000c1';
update procurements set updated_at = now() + interval '1 day' where id = '07190000-0000-0000-0000-0000000000f1';
update tasks set end_date = end_date where id = '07190000-0000-0000-0000-0000000000d1';
select is(
  (select count(*)::int from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  1, 'AC-CHG-002 last_update-only and same-value project updates add no event');
select is(
  (select count(*)::int from record_changes
    where entity_id in ('07190000-0000-0000-0000-0000000000f1', '07190000-0000-0000-0000-0000000000d1') and op = 'update'),
  0, 'AC-CHG-002 updated_at-only procurement update and same-value task update add no event');

-- ── AC-CHG-003: a company insert writes one insert event with the actor ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
insert into companies (id, name, type) values ('07190000-0000-0000-0000-0000000000b1', 'CHG Client', 'Client');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from record_changes where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1'),
  1, 'AC-CHG-003 one event for the insert');
select is(
  (select op || '|' || actor_id::text || '|' || changes::text || '|' || org_id::text
     from record_changes where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1'),
  'insert|07190000-0000-0000-0000-0000000000a1|{}|07190000-0000-0000-0000-000000000001',
  'AC-CHG-003 insert event: op insert, the Admin as actor, empty changes, the stamped org');
select is(
  (select actor_id from record_changes where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'insert'),
  null::uuid, 'AC-CHG-003 a fixture insert with no JWT and no app.actor_id records a null (System) actor');

-- ── AC-CHG-006: child events carry the project as parent ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a4","role":"authenticated"}';
update tasks set end_date = '2026-02-20' where id = '07190000-0000-0000-0000-0000000000d1';
reset role;
set local request.jwt.claims = '';

select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'task' and entity_id = '07190000-0000-0000-0000-0000000000d1' and op = 'update'),
  'project|07190000-0000-0000-0000-0000000000c1', 'AC-CHG-006 a task date move rolls up to its project');
select is(
  (select changes from record_changes
    where entity_type = 'task' and entity_id = '07190000-0000-0000-0000-0000000000d1' and op = 'update'),
  '{"end_date":{"old":"2026-02-10","new":"2026-02-20"}}'::jsonb, 'AC-CHG-006 the task event holds the date move');

update budget_line_items set budgeted_amount = 150 where id = '07190000-0000-0000-0000-0000000000e2';
select is(
  (select parent_type || '|' || parent_id::text || '|' || currency from record_changes
    where entity_type = 'budget_line_item' and entity_id = '07190000-0000-0000-0000-0000000000e2' and op = 'update'),
  'project|07190000-0000-0000-0000-0000000000c1|USD',
  'AC-CHG-006 a budget line rolls up to its version''s project and takes the version''s currency');
select is(
  (select changes from record_changes
    where entity_type = 'budget_line_item' and entity_id = '07190000-0000-0000-0000-0000000000e2' and op = 'update'),
  '{"budgeted_amount":{"old":100,"new":150}}'::jsonb, 'AC-CHG-006 money values are stored as numbers');

update purchase_orders set amount = 650 where id = '07190000-0000-0000-0000-0000000000f2';
select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'purchase_order' and entity_id = '07190000-0000-0000-0000-0000000000f2' and op = 'update'),
  'project|07190000-0000-0000-0000-0000000000c1', 'AC-CHG-006 a PO rolls up to its procurement''s project');
select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'budget_version' and entity_id = '07190000-0000-0000-0000-0000000000e1' and op = 'insert'),
  'project|07190000-0000-0000-0000-0000000000c1', 'AC-CHG-006 insert events carry the parent too');

-- ── AC-CHG-012: archive then restore a company ───────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update companies set archived_at = '2026-10-01 09:00:00+00' where id = '07190000-0000-0000-0000-0000000000b1';
update companies set archived_at = null where id = '07190000-0000-0000-0000-0000000000b1';
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from record_changes
    where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1' and op = 'update'),
  2, 'AC-CHG-012 archive and restore are two events');
select is(
  (select changes->'archived_at'->>'old' is null and changes->'archived_at'->>'new' is not null
     from record_changes where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1' and op = 'update'
    order by seq limit 1),
  true, 'AC-CHG-012 the first event sets archived_at');
select is(
  (select changes->'archived_at'->>'old' is not null and changes->'archived_at'->>'new' is null
     from record_changes where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1' and op = 'update'
    order by seq desc limit 1),
  true, 'AC-CHG-012 the second event clears archived_at');
select is(
  (select array_agg(key order by key) from record_changes rc, jsonb_object_keys(rc.changes) key
    where rc.entity_type = 'company' and rc.entity_id = '07190000-0000-0000-0000-0000000000b1' and rc.op = 'update'),
  array['archived_at', 'archived_at'], 'AC-CHG-012 no other column appears in the archive events');

-- ── AC-CHG-013: a rolled-back change leaves no event ─────────────────────────────────────────────
savepoint chg_013;
update projects set name = 'Never Happened' where id = '07190000-0000-0000-0000-0000000000c1';
select is(
  (select count(*)::int from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  2, 'AC-CHG-013 (setup) the change wrote its event inside the transaction');
rollback to savepoint chg_013;
select is(
  (select count(*)::int from record_changes
    where entity_type = 'project' and entity_id = '07190000-0000-0000-0000-0000000000c1' and op = 'update'),
  1, 'AC-CHG-013 rolling the change back removes its event');
select is(
  (select name from projects where id = '07190000-0000-0000-0000-0000000000c1'),
  'Alpha Renamed', 'AC-CHG-013 (control) the row is back to its committed value');

select * from finish();
rollback;
