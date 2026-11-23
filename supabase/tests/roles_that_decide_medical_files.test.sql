-- roles_that_decide_medical_files.test.sql — the people-documents right writes a person's NON-medical stored files only.
-- Migration under test: 1844_expiry_person_files_align_medical.sql (expiry_document_object_writable, expiry_document_object_is_medical).
-- AC-RTD-018 an HR Officer (holder of the people-documents right) cannot insert, overwrite or delete a stored file that a medical
-- document names; an Admin can; the HR Officer's non-medical person files work as before.
-- A medical document holds no file today (the 0970 shape constraint), so the fixture lifts that constraint inside this transaction
-- to prove the storage rule on its own; the rollback restores it.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   1844 drop "and not public.expiry_document_object_is_medical(p_name)" (mut:medical_object)
--        ..................... 'AC-RTD-018 an HR Officer cannot upload a file a medical document names' (and the overwrite/delete ones)
--   1844 make expiry_document_object_is_medical return false .......... the same three assertions
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('18440000-0000-0000-0000-00000000000a', 'RTD Med Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('18440000-0000-0000-0000-0000000000a1', 'rtdm-med-admin@example.com'),
  ('18440000-0000-0000-0000-0000000000a2', 'rtdm-med-hro@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('18440000-0000-0000-0000-0000000000a1', '18440000-0000-0000-0000-00000000000a', 'Med Admin', 'rtdm-med-admin@example.com', 'Admin',    'active', null),
  ('18440000-0000-0000-0000-0000000000a2', '18440000-0000-0000-0000-00000000000a', 'Med HRO',   'rtdm-med-hro@example.com',   'Engineer', 'active', 'hr_officer');
insert into people (id, org_id, code, name) values
  ('18440000-0000-0000-0000-0000000000e1', '18440000-0000-0000-0000-00000000000a', 'MP-1', 'Med Person');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('18440000-0000-0000-0000-0000000000f1', '18440000-0000-0000-0000-00000000000a', 'Permit',  'person', false),
  ('18440000-0000-0000-0000-0000000000f2', '18440000-0000-0000-0000-00000000000a', 'Medical', 'person', true);

-- the storage rule on its own: a medical document that names stored files (lifted shape constraint, this transaction only)
alter table public.expiry_documents drop constraint expiry_documents_medical_shape;
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on, attachment_path) values
  ('18440000-0000-0000-0000-000000000102', '18440000-0000-0000-0000-00000000000a', 'person', '18440000-0000-0000-0000-0000000000e1',
   '18440000-0000-0000-0000-0000000000f2', 'fit', '2026-12-10',
   '18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on, attachment_path) values
  ('18440000-0000-0000-0000-000000000103', '18440000-0000-0000-0000-00000000000a', 'person', '18440000-0000-0000-0000-0000000000e1',
   '18440000-0000-0000-0000-0000000000f2', 'fit', '2026-12-11',
   '18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m2/new.pdf');
insert into storage.objects (bucket_id, name) values
  ('expiry-documents', '18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try_upload(p_name text) returns boolean language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values ('expiry-documents', p_name);
  return true;
exception when others then return false;
end $$;
-- rows an overwrite (update) or a delete reached; an RLS refusal is a silent 0
create or replace function pg_temp.touch(p_name text) returns integer language plpgsql as $$
declare n integer;
begin
  update storage.objects set metadata = '{"touched":true}'::jsonb where bucket_id = 'expiry-documents' and name = p_name;
  get diagnostics n = row_count;
  return n;
end $$;
create or replace function pg_temp.remove(p_name text) returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'expiry-documents' and name = p_name;
  get diagnostics n = row_count;
  return n;
end $$;

set local role authenticated;

select pg_temp.act_as('18440000-0000-0000-0000-0000000000a2');
select ok(not pg_temp.try_upload('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m2/new.pdf'),
  'AC-RTD-018 an HR Officer cannot upload a file a medical document names');
select is(pg_temp.touch('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf'), 0,
  'AC-RTD-018 an HR Officer cannot overwrite a medical document''s stored file');
select is(pg_temp.remove('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf'), 0,
  'AC-RTD-018 an HR Officer cannot delete a medical document''s stored file');
select ok(pg_temp.try_upload('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/p1/permit.pdf'),
  'AC-RTD-018 an HR Officer still uploads a non-medical person file');
select is(pg_temp.touch('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/p1/permit.pdf'), 1,
  'AC-RTD-018 and overwrites it');

select pg_temp.act_as('18440000-0000-0000-0000-0000000000a1');
select ok(pg_temp.try_upload('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m2/new.pdf'),
  'AC-RTD-018 an Admin uploads a file a medical document names');
select is(pg_temp.touch('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf'), 1,
  'AC-RTD-018 an Admin overwrites a medical document''s stored file');
select is(pg_temp.remove('18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf'), 1,
  'AC-RTD-018 an Admin deletes a medical document''s stored file');
reset role;
select is((select count(*)::int from storage.objects where bucket_id = 'expiry-documents'
            and name = '18440000-0000-0000-0000-00000000000a/person/18440000-0000-0000-0000-0000000000e1/m1/med.pdf'), 0,
  'AC-RTD-018 the Admin''s delete removed the file');

select * from finish();
rollback;
