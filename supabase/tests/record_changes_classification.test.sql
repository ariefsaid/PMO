-- record_changes_classification.test.sql — #719 record change history, column classes (spec D1, Q2).
-- AC-CHG-004: a `flag` column records {"changed":true} and never its old or new value; an `omit` column
-- never appears, and an update that changes only omit columns writes no event.
-- Migration under test: 0260_record_change_history.sql.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name) values
  ('07190000-0000-0000-0000-000000000001', 'CHG Org A');
insert into auth.users (id, email) values
  ('07190000-0000-0000-0000-0000000000a1', 'chg-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('07190000-0000-0000-0000-0000000000a1', '07190000-0000-0000-0000-000000000001', 'CHG Admin', 'chg-admin@example.com', 'Admin', 'active');
insert into companies (id, org_id, name, type) values
  ('07190000-0000-0000-0000-0000000000b1', '07190000-0000-0000-0000-000000000001', 'CHG Client', 'Client');
insert into contacts (id, org_id, company_id, full_name, title, email, phone, notes) values
  ('07190000-0000-0000-0000-0000000000b2', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000b1',
   'Pat Example', 'Engineer', 'old-address@example.com', '+15550001111', 'old private note');
insert into projects (id, org_id, code, name, status) values
  ('07190000-0000-0000-0000-0000000000c1', '07190000-0000-0000-0000-000000000001', 'CHG-1', 'Alpha', 'Ongoing Project');
insert into tasks (id, org_id, project_id, name, status, description) values
  ('07190000-0000-0000-0000-0000000000d1', '07190000-0000-0000-0000-000000000001', '07190000-0000-0000-0000-0000000000c1', 'Survey', 'To Do', 'old body text');

set local role authenticated;
set local request.jwt.claims = '{"sub":"07190000-0000-0000-0000-0000000000a1","role":"authenticated"}';
update contacts set phone = '+15559992222' where id = '07190000-0000-0000-0000-0000000000b2';
reset role;
set local request.jwt.claims = '';

select is(
  (select changes from record_changes
    where entity_type = 'contact' and entity_id = '07190000-0000-0000-0000-0000000000b2' and op = 'update'),
  '{"phone":{"changed":true}}'::jsonb, 'AC-CHG-004 a phone change is recorded as changed, without values');
select ok(
  (select bool_and(strpos(to_jsonb(rc)::text, '5550001111') = 0 and strpos(to_jsonb(rc)::text, '5559992222') = 0)
     from record_changes rc where rc.entity_id = '07190000-0000-0000-0000-0000000000b2'),
  'AC-CHG-004 neither the old nor the new number appears anywhere in the contact''s history rows');
select is(
  (select parent_type || '|' || parent_id::text from record_changes
    where entity_type = 'contact' and entity_id = '07190000-0000-0000-0000-0000000000b2' and op = 'update'),
  'company|07190000-0000-0000-0000-0000000000b1', 'AC-CHG-004 (context) a contact rolls up to its company');

-- email + notes are flag, title is captured: one event, mixed shapes.
update contacts set email = 'new-address@example.com', notes = 'new private note', title = 'Lead Engineer'
 where id = '07190000-0000-0000-0000-0000000000b2';
select is(
  (select changes from record_changes
    where entity_type = 'contact' and entity_id = '07190000-0000-0000-0000-0000000000b2' and op = 'update'
    order by seq desc limit 1),
  '{"email":{"changed":true},"notes":{"changed":true},"title":{"old":"Engineer","new":"Lead Engineer"}}'::jsonb,
  'AC-CHG-004 flag and captured columns in one statement: flags carry no values, captured carry old/new');
select ok(
  (select bool_and(strpos(rc.changes::text, 'address@example.com') = 0 and strpos(rc.changes::text, 'private note') = 0)
     from record_changes rc where rc.entity_id = '07190000-0000-0000-0000-0000000000b2'),
  'AC-CHG-004 old and new email and notes appear nowhere in changes');

-- omit-only update: an external-sync mirror column alone writes nothing.
update contacts set erp_modified = now() where id = '07190000-0000-0000-0000-0000000000b2';
update companies set erp_tax_id = 'TAX-1', erp_docstatus = 1 where id = '07190000-0000-0000-0000-0000000000b1';
select is(
  (select count(*)::int from record_changes
    where entity_id in ('07190000-0000-0000-0000-0000000000b2', '07190000-0000-0000-0000-0000000000b1') and op = 'update'),
  2, 'AC-CHG-004 an update of omit columns only writes no event (still the two contact events)');

-- omit columns never ride along with a captured change.
update companies set erp_customer_name = 'Mirror Name', name = 'CHG Client Renamed' where id = '07190000-0000-0000-0000-0000000000b1';
select is(
  (select changes from record_changes
    where entity_type = 'company' and entity_id = '07190000-0000-0000-0000-0000000000b1' and op = 'update'),
  '{"name":{"old":"CHG Client","new":"CHG Client Renamed"}}'::jsonb,
  'AC-CHG-004 an omit column changed alongside a captured one does not appear');

-- free-text body on tasks is flag.
update tasks set description = 'new body text' where id = '07190000-0000-0000-0000-0000000000d1';
select is(
  (select changes from record_changes
    where entity_type = 'task' and entity_id = '07190000-0000-0000-0000-0000000000d1' and op = 'update'),
  '{"description":{"changed":true}}'::jsonb, 'AC-CHG-004 a task description change is recorded as changed, without text');

-- a task's trigger-stamped completed_at (omit) never appears; the status change that caused it does.
update tasks set status = 'Done' where id = '07190000-0000-0000-0000-0000000000d1';
select is(
  (select changes from record_changes
    where entity_type = 'task' and entity_id = '07190000-0000-0000-0000-0000000000d1' and op = 'update'
    order by seq desc limit 1),
  '{"status":{"old":"To Do","new":"Done"}}'::jsonb,
  'AC-CHG-004 a stamped column (completed_at) is omitted; the source edit (status) is captured');

select * from finish();
rollback;
