-- clearance_item_document_type.test.sql — fix/walk-people item 8 (migration 1612).
-- AC-CLD-001 a linked item reads its dates from the person's document · AC-CLD-002 no document = not done · AC-CLD-003 the summary agrees ·
-- AC-CLD-004 the linked type must be the organisation's, for people · AC-CLD-005 an unlinked item still uses the recorded date.
begin;
create extension if not exists pgtap;
select plan(9);
insert into organizations (id, name, default_currency, default_timezone) values ('27120000-0000-0000-0000-00000000000a', 'CLD Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('27120000-0000-0000-0000-0000000000a1', 'cld-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('27120000-0000-0000-0000-0000000000a1', '27120000-0000-0000-0000-00000000000a', 'CLD Admin', 'cld-admin@example.com', 'Admin', 'active');
insert into people (id, org_id, code, name) values
  ('27120000-0000-0000-0000-0000000000c1', '27120000-0000-0000-0000-00000000000a', 'C-1', 'Person One'),
  ('27120000-0000-0000-0000-0000000000c2', '27120000-0000-0000-0000-00000000000a', 'C-2', 'Person Two');
insert into document_types (id, org_id, name, applies_to) values
  ('27120000-0000-0000-0000-0000000000b1', '27120000-0000-0000-0000-00000000000a', 'Licence', 'person'),
  ('27120000-0000-0000-0000-0000000000b2', '27120000-0000-0000-0000-00000000000a', 'Crane certificate', 'equipment');
insert into expiry_documents (org_id, subject_kind, person_id, type_id, issued_on, expires_on) values
  ('27120000-0000-0000-0000-00000000000a', 'person', '27120000-0000-0000-0000-0000000000c1', '27120000-0000-0000-0000-0000000000b1', current_date - 100, current_date + 400);
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true) $$;
set local role authenticated;
select pg_temp.act_as('27120000-0000-0000-0000-0000000000a1');

insert into clearance_items (id, name, sort_order, document_type_id) values ('27120000-0000-0000-0000-0000000000d1', 'Licence valid', 1, '27120000-0000-0000-0000-0000000000b1');
select is((select expires_on from person_clearance_items('27120000-0000-0000-0000-0000000000c1')), current_date + 400, 'AC-CLD-001 the checklist shows the document''s expiry, not a second typed one');
select is((select state from person_clearance_items('27120000-0000-0000-0000-0000000000c1')), 'done', 'AC-CLD-001 and the state follows it');
select is((select state from person_clearance_items('27120000-0000-0000-0000-0000000000c2')), 'missing', 'AC-CLD-002 a person with no such document is not done');
select is((select cleared from person_clearance_summary() where person_id = '27120000-0000-0000-0000-0000000000c1'), true, 'AC-CLD-003 the summary counts the document');
select is((select cleared from person_clearance_summary() where person_id = '27120000-0000-0000-0000-0000000000c2'), false, 'AC-CLD-003 and not its absence');
select throws_ok($$ insert into clearance_items (name, document_type_id) values ('Crane', '27120000-0000-0000-0000-0000000000b2') $$, '23514', null, 'AC-CLD-004 a type for equipment cannot be linked');
select throws_ok($$ insert into clearance_items (name, document_type_id) values ('Ghost', gen_random_uuid()) $$, '23503', null, 'AC-CLD-004 an unknown type is refused');
insert into clearance_items (id, name, sort_order) values ('27120000-0000-0000-0000-0000000000d2', 'Induction', 2);
insert into person_clearances (person_id, item_id, done_on) values ('27120000-0000-0000-0000-0000000000c1', '27120000-0000-0000-0000-0000000000d2', current_date);
select is((select done_on from person_clearance_items('27120000-0000-0000-0000-0000000000c1') where name = 'Induction'), current_date, 'AC-CLD-005 an unlinked item still uses its recorded date');
select is((select document_type_name from person_clearance_items('27120000-0000-0000-0000-0000000000c1') where name = 'Licence valid'), 'Licence', 'AC-CLD-001 the row names its document type');
select * from finish();
rollback;
