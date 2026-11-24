-- 2131_headcount_evidence.test.sql — evidence on a head count day (docs/specs/headcount-evidence.spec.md).
-- AC-HCE-001 the recorder attaches a project document · 002 only the recorder's authority (crew controller, crew manager or Project Administrator), never a field
-- account or another crew's stranger · 003 the document is the work order's project's own · 004 an approved line is final · 005 the approver
-- reads it before approving; another organisation reads nothing · 006 detach.
-- MUTATION NOTES: attach/detach_headcount_document: replace the recorder predicate with `true` -> the Engineer/field-account refusal checks red; remove the Project Administrator branch -> the Project Administrator attach/detach checks red;
-- delete the `v_d_project is distinct from v_project` test -> 'AC-HCE-003 ...' red; delete the `approved_at is not null` refusal -> 'AC-HCE-004' red;
-- remove `perform public.assert_not_light();` -> 'AC-HCE-002 a field account ...' red.
begin;
create extension if not exists pgtap;
select plan(21);

insert into organizations (id, name, default_currency) values ('21310000-0000-0000-0000-00000000000a', 'HCE Org', 'IDR'), ('21310000-0000-0000-0000-00000000000b', 'HCE Other', 'IDR');
update organizations set built_in_roles_enabled = true where id = '21310000-0000-0000-0000-00000000000a';
insert into auth.users (id, email) values
  ('21310000-0000-0000-0000-0000000000a1', 'hce-admin@example.com'), ('21310000-0000-0000-0000-0000000000a3', 'hce-pm@example.com'),
  ('21310000-0000-0000-0000-0000000000a5', 'hce-foreman@example.com'), ('21310000-0000-0000-0000-0000000000a6', 'hce-eng@example.com'),
  ('21310000-0000-0000-0000-0000000000a8', 'hce-project-admin@example.com'),
  ('21310000-0000-0000-0000-0000000000a7', 'hce-field@example.com'), ('21310000-0000-0000-0000-0000000000b1', 'hce-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('21310000-0000-0000-0000-0000000000a1', '21310000-0000-0000-0000-00000000000a', 'Admin', 'hce-admin@example.com', 'Admin', 'active', null),
  ('21310000-0000-0000-0000-0000000000a3', '21310000-0000-0000-0000-00000000000a', 'PM', 'hce-pm@example.com', 'Project Manager', 'active', null),
  ('21310000-0000-0000-0000-0000000000a5', '21310000-0000-0000-0000-00000000000a', 'Foreman', 'hce-foreman@example.com', 'Engineer', 'active', null),
  ('21310000-0000-0000-0000-0000000000a6', '21310000-0000-0000-0000-00000000000a', 'Engineer', 'hce-eng@example.com', 'Engineer', 'active', null),
  ('21310000-0000-0000-0000-0000000000a7', '21310000-0000-0000-0000-00000000000a', 'Field', 'hce-field@example.com', 'Engineer', 'active', 'field_user'),
  ('21310000-0000-0000-0000-0000000000a8', '21310000-0000-0000-0000-00000000000a', 'Project Admin', 'hce-project-admin@example.com', 'Engineer', 'active', 'project_administrator'),
  ('21310000-0000-0000-0000-0000000000b1', '21310000-0000-0000-0000-00000000000b', 'Other', 'hce-other@example.com', 'Admin', 'active', null);
insert into projects (id, org_id, name, status, currency) values
  ('21310000-0000-0000-0000-0000000000d1', '21310000-0000-0000-0000-00000000000a', 'HCE Site', 'Ongoing Project', 'IDR'),
  ('21310000-0000-0000-0000-0000000000d2', '21310000-0000-0000-0000-00000000000a', 'HCE Other Site', 'Ongoing Project', 'IDR');
insert into work_orders (id, org_id, project_id, wo_number, title, status, order_value, tax_treatment, tax_amount, currency) values
  ('21310000-0000-0000-0000-000000000401', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-0000000000d1', 'WO-1', 'One', 'Issued', 10000, 'exclusive', 0, 'IDR');
insert into crews (id, org_id, code, name, field_controller_id) values
  ('21310000-0000-0000-0000-000000000c01', '21310000-0000-0000-0000-00000000000a', 'HCE-A', 'Crew A', '21310000-0000-0000-0000-0000000000a5');
insert into crews (id, org_id, code, name, field_controller_id) values
  ('21310000-0000-0000-0000-000000000c02', '21310000-0000-0000-0000-00000000000a', 'HCE-B', 'Crew B', '21310000-0000-0000-0000-0000000000a7');
insert into labour_cost_classes (id, org_id, code, name) values ('21310000-0000-0000-0000-000000000e01', '21310000-0000-0000-0000-00000000000a', 'hce_guard', 'Guard');
insert into work_order_crews (org_id, work_order_id, crew_id, valid_from) values
  ('21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-000000000401', '21310000-0000-0000-0000-000000000c01', current_date - 40);
insert into project_documents (id, org_id, project_id, category, title, status, file_path) values
  ('21310000-0000-0000-0000-00000000f001', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-0000000000d1', 'Photo', 'Gate photo', 'Draft', '21310000-0000-0000-0000-00000000000a/21310000-0000-0000-0000-0000000000d1/21310000-0000-0000-0000-00000000f001/gate.jpg'),
  ('21310000-0000-0000-0000-00000000f002', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-0000000000d1', 'Photo', 'Second photo', 'Draft', '21310000-0000-0000-0000-00000000000a/21310000-0000-0000-0000-0000000000d1/21310000-0000-0000-0000-00000000f002/two.jpg'),
  ('21310000-0000-0000-0000-00000000f003', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-0000000000d2', 'Photo', 'Wrong project', 'Draft', '21310000-0000-0000-0000-00000000000a/21310000-0000-0000-0000-0000000000d2/21310000-0000-0000-0000-00000000f003/three.jpg'),
  ('21310000-0000-0000-0000-00000000f004', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-0000000000d1', 'Photo', 'No file', 'Draft', null);
insert into headcount_days (id, org_id, work_order_id, crew_id, class_id, work_date, head_count, recorded_by_ids) values
  ('21310000-0000-0000-0000-000000000b01', '21310000-0000-0000-0000-00000000000a', '21310000-0000-0000-0000-000000000401', '21310000-0000-0000-0000-000000000c02',
   '21310000-0000-0000-0000-000000000e01', current_date - 2, 2, '{}');
create temp table d as select public.equipment_org_today('21310000-0000-0000-0000-00000000000a') as t;
grant select on d to authenticated;
create temp table ids (k text primary key, v uuid) on commit drop;
grant all on ids to authenticated;
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

set local role authenticated;
select pg_temp.act_as('21310000-0000-0000-0000-0000000000a5');
insert into ids select 'line', public.record_headcount_day('21310000-0000-0000-0000-000000000401', '21310000-0000-0000-0000-000000000c01', (select t from d) - 1, '21310000-0000-0000-0000-000000000e01', 3);
insert into ids select 'att', public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f001');
select ok((select v from ids where k = 'att') is not null, 'AC-HCE-001 the crew''s foreman attaches a document to the head count');
select is((select count(*)::int from headcount_day_documents), 1, 'AC-HCE-001 and reads it back');
select lives_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f001')$$, 'AC-HCE-001 attaching the same file again is harmless');
select is((select count(*)::int from headcount_day_documents), 1, 'AC-HCE-001 it is cited once');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f003')$$, '23514', null,
  'AC-HCE-003 a document of another project is refused');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f004')$$, '23514', null,
  'AC-HCE-003 a document with no file is refused');

select pg_temp.act_as('21310000-0000-0000-0000-0000000000a6');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f002')$$, '42501', null,
  'AC-HCE-002 an Engineer who is not the crew''s foreman is refused');
select pg_temp.act_as('21310000-0000-0000-0000-0000000000a7');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f002')$$, '42501', null,
  'AC-HCE-002 a field account is refused');
select throws_ok($$select public.attach_headcount_document('21310000-0000-0000-0000-000000000b01', '21310000-0000-0000-0000-00000000f002')$$, '42501', null,
  'AC-HCE-002 a field account that is its crew''s field controller is still refused');
select pg_temp.act_as('21310000-0000-0000-0000-0000000000a8');
insert into ids select 'project-admin-line', public.record_headcount_day('21310000-0000-0000-0000-000000000401', '21310000-0000-0000-0000-000000000c01', (select t from d) - 2, '21310000-0000-0000-0000-000000000e01', 4);
insert into ids select 'project-admin-att', public.attach_headcount_document((select v from ids where k = 'project-admin-line'), '21310000-0000-0000-0000-00000000f002');
select ok((select v from ids where k = 'project-admin-att') is not null, 'AC-HCE-002 the Project Administrator attaches evidence to the head count it recorded');
select lives_ok($$select public.detach_headcount_document((select v from ids where k = 'project-admin-att'))$$, 'AC-HCE-002 the Project Administrator may also detach evidence from its open line');
select throws_ok($$select public.approve_headcount_day((select v from ids where k = 'project-admin-line'))$$, '42501', null,
  'AC-HCE-002 the Project Administrator''s recording authority does not grant approval');
select pg_temp.act_as('21310000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f002')$$, 'P0002', null,
  'AC-HCE-005 another organisation''s Admin cannot see the line');
select is((select count(*)::int from headcount_day_documents), 0, 'AC-HCE-005 another organisation reads no evidence');

select pg_temp.act_as('21310000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from headcount_day_documents), 1, 'AC-HCE-005 the approving Project Manager sees the evidence before approving');
select pg_temp.act_as('21310000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f002')$$, 'AC-HCE-002 an Admin attaches too');
select lives_ok($$select public.detach_headcount_document((select v from ids where k = 'att'))$$, 'AC-HCE-006 a file is detached while the line is open');
select is((select count(*)::int from headcount_day_documents), 1, 'AC-HCE-006 one file remains');

select pg_temp.act_as('21310000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.approve_headcount_day((select v from ids where k = 'line'))$$, 'the Project Manager approves the line');
select throws_ok($$select public.attach_headcount_document((select v from ids where k = 'line'), '21310000-0000-0000-0000-00000000f001')$$, '23514', null,
  'AC-HCE-004 an approved line takes no more files');
select throws_ok($$select public.detach_headcount_document((select id from headcount_day_documents limit 1))$$, '23514', null,
  'AC-HCE-004 and loses none');
select * from finish();
rollback;
