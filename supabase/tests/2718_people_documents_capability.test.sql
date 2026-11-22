-- 2718_people_documents_capability.test.sql — every person's non-medical documents: read, add and renew, and the person list that reaches them.
-- Migration under test: 1536_people_documents_capability_gate.sql (actor_has_person_documents_access, people_select, expiry_documents_*, attachment helpers).
-- Holders: the people_documents_view capability (HR Manager, HR Officer, Administrator). Medical rows stay with 2717's rule and Admin-only writes;
-- equipment documents are untouched; a person with no built-in role, or another organisation's holder, is as before.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   actor_has_person_documents_access returns false ............ 'AC-RCG-020 ...' (list, read, add, renew, upload and adapter assertions)
--   actor_has_person_documents_access returns true ............. 'AC-RCG-021 ...' (plain Engineer, no-key Engineer, other-organisation assertions)
--   drop `not is_medical` from the insert policy ................ 'AC-RCG-022 an HR Officer cannot add a medical document'
begin;
create extension if not exists pgtap;
select plan(23);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('27180000-0000-0000-0000-00000000000a', 'PDC Org',   'IDR', 'UTC', true),
  ('27180000-0000-0000-0000-00000000000b', 'PDC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('27180000-0000-0000-0000-0000000000a1', 'pdc-admin@example.com'),
  ('27180000-0000-0000-0000-0000000000a2', 'pdc-hrm@example.com'),
  ('27180000-0000-0000-0000-0000000000a3', 'pdc-hro@example.com'),
  ('27180000-0000-0000-0000-0000000000a4', 'pdc-eng@example.com'),
  ('27180000-0000-0000-0000-0000000000a5', 'pdc-legacy-eng@example.com'),
  ('27180000-0000-0000-0000-0000000000a6', 'pdc-legacy-pm@example.com'),
  ('27180000-0000-0000-0000-0000000000b1', 'pdc-xorg-hro@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27180000-0000-0000-0000-0000000000a1', '27180000-0000-0000-0000-00000000000a', 'PDC Admin',      'pdc-admin@example.com',      'Admin',           'active', null),
  ('27180000-0000-0000-0000-0000000000a2', '27180000-0000-0000-0000-00000000000a', 'PDC HR Manager', 'pdc-hrm@example.com',        'Project Manager', 'active', 'hr_manager'),
  ('27180000-0000-0000-0000-0000000000a3', '27180000-0000-0000-0000-00000000000a', 'PDC HR Officer', 'pdc-hro@example.com',        'Engineer',        'active', 'hr_officer'),
  ('27180000-0000-0000-0000-0000000000a4', '27180000-0000-0000-0000-00000000000a', 'PDC Engineer',   'pdc-eng@example.com',        'Engineer',        'active', 'engineer'),
  ('27180000-0000-0000-0000-0000000000a5', '27180000-0000-0000-0000-00000000000a', 'PDC Legacy Eng', 'pdc-legacy-eng@example.com', 'Engineer',        'active', null),
  ('27180000-0000-0000-0000-0000000000a6', '27180000-0000-0000-0000-00000000000a', 'PDC Legacy PM',  'pdc-legacy-pm@example.com',  'Project Manager', 'active', null),
  ('27180000-0000-0000-0000-0000000000b1', '27180000-0000-0000-0000-00000000000b', 'PDC XOrg HR',    'pdc-xorg-hro@example.com',   'Engineer',        'active', 'hr_officer');
insert into people (id, org_id, code, name) values
  ('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-00000000000a', 'P-1', 'PDC Person One'),
  ('27180000-0000-0000-0000-0000000000e2', '27180000-0000-0000-0000-00000000000a', 'P-2', 'PDC Person Two');
insert into equipment_assets (id, org_id, code, name) values
  ('27180000-0000-0000-0000-0000000000d1', '27180000-0000-0000-0000-00000000000a', 'EQ-1', 'Crane One');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('27180000-0000-0000-0000-0000000000f1', '27180000-0000-0000-0000-00000000000a', 'Work permit',          'person',    false),
  ('27180000-0000-0000-0000-0000000000f2', '27180000-0000-0000-0000-00000000000a', 'Medical check',        'person',    true),
  ('27180000-0000-0000-0000-0000000000f3', '27180000-0000-0000-0000-00000000000a', 'Equipment certificate', 'equipment', false);
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, number, expires_on) values
  ('27180000-0000-0000-0000-000000000101', '27180000-0000-0000-0000-00000000000a', 'person', '27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1', 'WP-1', '2026-12-20');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on) values
  ('27180000-0000-0000-0000-000000000102', '27180000-0000-0000-0000-00000000000a', 'person', '27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f2', 'fit', '2026-12-10');
insert into expiry_documents (id, org_id, subject_kind, asset_id, type_id, number, expires_on) values
  ('27180000-0000-0000-0000-000000000103', '27180000-0000-0000-0000-00000000000a', 'equipment', '27180000-0000-0000-0000-0000000000d1', '27180000-0000-0000-0000-0000000000f3', 'EC-1', '2026-12-05');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
-- one renewal attempt: how many rows the update reached
create or replace function pg_temp.renew(p_id uuid) returns integer language plpgsql as $$
declare n integer;
begin
  update public.expiry_documents set expires_on = '2027-06-30' where id = p_id;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function pg_temp.try_upload(p_name text) returns boolean language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values ('expiry-documents', p_name);
  return true;
exception when others then return false;
end $$;
create or replace function pg_temp.try_add(p_person uuid, p_type uuid) returns boolean language plpgsql as $$
begin
  insert into public.expiry_documents (subject_kind, person_id, type_id, number, expires_on) values ('person', p_person, p_type, 'NEW', '2027-01-01');
  return true;
exception when others then return false;
end $$;

set local role authenticated;

-- HR Officer (Engineer level + capability)
select pg_temp.act_as('27180000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from people), 2, 'AC-RCG-020 an HR Officer reads every person on the list');
select is((select count(*)::int from expiry_documents where subject_kind = 'person' and not is_medical), 1, 'AC-RCG-020 an HR Officer reads the person''s non-medical document');
select is((select count(*)::int from expiry_documents where subject_kind = 'equipment'), 0, 'AC-RCG-021 an HR Officer reads no equipment document');
select ok(pg_temp.try_add('27180000-0000-0000-0000-0000000000e2', '27180000-0000-0000-0000-0000000000f1'), 'AC-RCG-020 an HR Officer adds a non-medical person document');
select is(pg_temp.renew('27180000-0000-0000-0000-000000000101'), 1, 'AC-RCG-020 an HR Officer renews a non-medical person document');
select ok(not pg_temp.try_add('27180000-0000-0000-0000-0000000000e2', '27180000-0000-0000-0000-0000000000f2'), 'AC-RCG-022 an HR Officer cannot add a medical document');
select is(pg_temp.renew('27180000-0000-0000-0000-000000000102'), 0, 'AC-RCG-022 an HR Officer cannot change a medical document');
select ok(not exists (select 1 from expiry_documents where id = '27180000-0000-0000-0000-000000000102' and expires_on = '2027-06-30'), 'AC-RCG-022 the medical date is untouched');
select ok(not pg_temp.try_add('27180000-0000-0000-0000-0000000000e2', '27180000-0000-0000-0000-0000000000f3'), 'AC-RCG-021 an HR Officer cannot add an equipment-type document to a person');
select ok(pg_temp.try_upload('27180000-0000-0000-0000-00000000000a/person/27180000-0000-0000-0000-0000000000e1/f1/a.pdf'), 'AC-RCG-020 an HR Officer uploads a person file');
select ok(exists (select 1 from storage.objects where bucket_id = 'expiry-documents' and name = '27180000-0000-0000-0000-00000000000a/person/27180000-0000-0000-0000-0000000000e1/f1/a.pdf'), 'AC-RCG-020 and reads it');
select ok(not pg_temp.try_upload('27180000-0000-0000-0000-00000000000a/equipment/27180000-0000-0000-0000-0000000000d1/f2/a.pdf'), 'AC-RCG-021 an HR Officer cannot upload an equipment file');
select ok(public.actor_has_person_documents_access(), 'AC-RCG-020 the signed-in rule answers yes for the HR Officer');

-- HR Manager (Project Manager level + capability)
select pg_temp.act_as('27180000-0000-0000-0000-0000000000a2');
select ok(pg_temp.try_add('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1'), 'AC-RCG-020 an HR Manager adds a non-medical person document');
select is(pg_temp.renew('27180000-0000-0000-0000-000000000101'), 1, 'AC-RCG-020 an HR Manager renews a non-medical person document');

-- same levels without the capability
select pg_temp.act_as('27180000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from people) + (select count(*)::int from expiry_documents), 0, 'AC-RCG-021 a plain Engineer reads no person and no document');
select ok(not pg_temp.try_add('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1'), 'AC-RCG-021 a plain Engineer cannot add a person document');
select is(pg_temp.renew('27180000-0000-0000-0000-000000000101'), 0, 'AC-RCG-021 a plain Engineer cannot renew a person document');
select ok(not pg_temp.try_upload('27180000-0000-0000-0000-00000000000a/person/27180000-0000-0000-0000-0000000000e1/f3/a.pdf'), 'AC-RCG-021 a plain Engineer cannot upload a person file');
select ok(not public.actor_has_person_documents_access(), 'AC-RCG-021 the signed-in rule answers no for the plain Engineer');
select pg_temp.act_as('27180000-0000-0000-0000-0000000000a5');
select ok((select count(*)::int from people) + (select count(*)::int from expiry_documents) = 0
          and not pg_temp.try_add('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1'),
  'AC-RCG-021 an Engineer with no built-in role reads and adds nothing, as before');
select pg_temp.act_as('27180000-0000-0000-0000-0000000000a6');
select ok(not pg_temp.try_add('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1'), 'AC-RCG-021 a Project Manager with no built-in role adds no person document, as before');
select pg_temp.act_as('27180000-0000-0000-0000-0000000000b1');
select ok((select count(*)::int from people) + (select count(*)::int from expiry_documents) = 0
          and not pg_temp.try_add('27180000-0000-0000-0000-0000000000e1', '27180000-0000-0000-0000-0000000000f1'),
  'AC-RCG-021 an HR Officer of another organisation reads and adds nothing here');
reset role;

select * from finish();
rollback;
