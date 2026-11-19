-- expiry_documents_storage.test.sql — 0994 (#2542). Owns AC-DEE-007 (bucket access by role/kind/org) and AC-DEE-008 (row writes by role).
begin;
create extension if not exists pgtap;
select plan(14);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25420000-0000-0000-0000-00000000000a', 'DEE Org',   'IDR', 'UTC'),
  ('25420000-0000-0000-0000-00000000000b', 'DEE Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25420000-0000-0000-0000-0000000000a1', 'dee-admin@example.com'),
  ('25420000-0000-0000-0000-0000000000a2', 'dee-pm@example.com'),
  ('25420000-0000-0000-0000-0000000000a3', 'dee-mgr@example.com'),
  ('25420000-0000-0000-0000-0000000000a5', 'dee-finance@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25420000-0000-0000-0000-0000000000a1', '25420000-0000-0000-0000-00000000000a', 'DEE Admin', 'dee-admin@example.com', 'Admin', 'active'),
  ('25420000-0000-0000-0000-0000000000a2', '25420000-0000-0000-0000-00000000000a', 'DEE PM', 'dee-pm@example.com', 'Project Manager', 'active'),
  ('25420000-0000-0000-0000-0000000000a3', '25420000-0000-0000-0000-00000000000a', 'DEE Mgr', 'dee-mgr@example.com', 'Engineer', 'active'),
  ('25420000-0000-0000-0000-0000000000a5', '25420000-0000-0000-0000-00000000000a', 'DEE Finance', 'dee-finance@example.com', 'Finance', 'active');
insert into people (id, org_id, code, name, manager_id) values
  ('25420000-0000-0000-0000-0000000000e1', '25420000-0000-0000-0000-00000000000a', 'P-1', 'Person One', '25420000-0000-0000-0000-0000000000a3');
insert into equipment_assets (id, org_id, code, name) values
  ('25420000-0000-0000-0000-0000000000d1', '25420000-0000-0000-0000-00000000000a', 'EQ-1', 'Crane One');
insert into document_types (id, org_id, name, applies_to) values
  ('25420000-0000-0000-0000-0000000000f1', '25420000-0000-0000-0000-00000000000a', 'Work permit', 'person'),
  ('25420000-0000-0000-0000-0000000000f3', '25420000-0000-0000-0000-00000000000a', 'Equipment certificate', 'equipment');

-- seeded objects (as owner) so read and delete have targets
insert into storage.objects (bucket_id, name, owner) values
  ('expiry-documents', '25420000-0000-0000-0000-00000000000a/person/25420000-0000-0000-0000-0000000000e1/f1/permit.pdf', null),
  ('expiry-documents', '25420000-0000-0000-0000-00000000000a/equipment/25420000-0000-0000-0000-0000000000d1/f2/cert.pdf', null);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.try_upload(p_name text) returns boolean language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name) values ('expiry-documents', p_name);
  return true;
exception when others then return false;
end $$;

set local role authenticated;

select pg_temp.act_as('25420000-0000-0000-0000-0000000000a1');
select ok(pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/person/25420000-0000-0000-0000-0000000000e1/f3/a.pdf'), 'AC-DEE-007 Admin uploads a person file');
select ok(pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/equipment/25420000-0000-0000-0000-0000000000d1/f4/a.pdf'), 'AC-DEE-007 Admin uploads an equipment file');
select ok(not pg_temp.try_upload('25420000-0000-0000-0000-00000000000b/equipment/25420000-0000-0000-0000-0000000000d1/f5/a.pdf'), 'AC-DEE-007 a path under another org is refused');
select ok(not pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/equipment/25420000-0000-0000-0000-0000000000e1/f6/a.pdf'), 'AC-DEE-007 a subject that is not in that kind is refused');

select pg_temp.act_as('25420000-0000-0000-0000-0000000000a2');
select ok(pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/equipment/25420000-0000-0000-0000-0000000000d1/f7/a.pdf'), 'AC-DEE-007 PM uploads an equipment file');
select ok(not pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/person/25420000-0000-0000-0000-0000000000e1/f8/a.pdf'), 'AC-DEE-007 PM cannot upload a person file');

select pg_temp.act_as('25420000-0000-0000-0000-0000000000a5');
select ok(not pg_temp.try_upload('25420000-0000-0000-0000-00000000000a/equipment/25420000-0000-0000-0000-0000000000d1/f9/a.pdf'), 'AC-DEE-007 Finance cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'expiry-documents'), 0, 'AC-DEE-007 Finance reads no attachments');

select pg_temp.act_as('25420000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from storage.objects where bucket_id = 'expiry-documents'), 1, 'AC-DEE-007 a person''s manager reads that person''s file only');

select pg_temp.act_as('25420000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from storage.objects where bucket_id = 'expiry-documents' and name like '%/person/%'), 0, 'AC-DEE-007 PM reads no person files');

-- AC-DEE-008: row writes by role
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a5');
select throws_ok($q$insert into expiry_documents (subject_kind, asset_id, type_id, expires_on)
  values ('equipment', '25420000-0000-0000-0000-0000000000d1', '25420000-0000-0000-0000-0000000000f3', '2027-01-01')$q$,
  '42501', null, 'AC-DEE-008 Finance cannot add a document');
select pg_temp.act_as('25420000-0000-0000-0000-0000000000a2');
select lives_ok($q$insert into expiry_documents (id, subject_kind, asset_id, type_id, expires_on)
  values ('25420000-0000-0000-0000-000000000201', 'equipment', '25420000-0000-0000-0000-0000000000d1', '25420000-0000-0000-0000-0000000000f3', '2027-01-01')$q$,
  'AC-DEE-008 PM adds an equipment document');
select lives_ok($q$update expiry_documents set archived_at = now() where id = '25420000-0000-0000-0000-000000000201'$q$,
  'AC-DEE-008 PM archives an equipment document');
select * from finish();
rollback;
