begin;
create extension if not exists pgtap;
select no_plan();

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled, leave_requests_enabled) values
  ('23600000-0000-0000-0000-00000000000a', 'RR HR Org', 'IDR', 'UTC', true, true);
insert into auth.users (id, email)
select ('23600000-0000-0000-0000-0000000000' || k)::uuid, 'rrhr-' || k || '@example.com'
  from unnest(array['a1','a2','a3','a4','a5','a6','a7','a8']) k;
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('23600000-0000-0000-0000-0000000000a1', '23600000-0000-0000-0000-00000000000a', 'Admin',      'rrhr-a1@example.com', 'Admin', 'active', null),
  ('23600000-0000-0000-0000-0000000000a2', '23600000-0000-0000-0000-00000000000a', 'HR officer', 'rrhr-a2@example.com', 'Engineer', 'active', 'hr_officer'),
  ('23600000-0000-0000-0000-0000000000a3', '23600000-0000-0000-0000-00000000000a', 'HR manager', 'rrhr-a3@example.com', 'Project Manager', 'active', 'hr_manager'),
  ('23600000-0000-0000-0000-0000000000a4', '23600000-0000-0000-0000-00000000000a', 'Store',      'rrhr-a4@example.com', 'Engineer', 'active', 'storekeeper'),
  ('23600000-0000-0000-0000-0000000000a5', '23600000-0000-0000-0000-00000000000a', 'Engineer',   'rrhr-a5@example.com', 'Engineer', 'active', null),
  ('23600000-0000-0000-0000-0000000000a6', '23600000-0000-0000-0000-00000000000a', 'Field',      'rrhr-a6@example.com', 'Engineer', 'active', 'field_user'),
  ('23600000-0000-0000-0000-0000000000a7', '23600000-0000-0000-0000-00000000000a', 'PM',         'rrhr-a7@example.com', 'Project Manager', 'active', null),
  ('23600000-0000-0000-0000-0000000000a8', '23600000-0000-0000-0000-00000000000a', 'Quality mgr','rrhr-a8@example.com', 'Project Manager', 'active', 'quality_manager');
insert into people (id, org_id, code, name, profile_id) values
  ('23600000-0000-0000-0000-000000000051', '23600000-0000-0000-0000-00000000000a', 'W1', 'Worker one', null),
  ('23600000-0000-0000-0000-000000000052', '23600000-0000-0000-0000-00000000000a', 'W2', 'HR officer self', '23600000-0000-0000-0000-0000000000a2');
insert into clearance_items (id, org_id, name, is_required) values
  ('23600000-0000-0000-0000-000000000061', '23600000-0000-0000-0000-00000000000a', 'Site induction', true);
insert into leave_types (id, org_id, name) values
  ('23600000-0000-0000-0000-000000000071', '23600000-0000-0000-0000-00000000000a', 'Annual');
insert into timesheets (id, org_id, user_id, week_start_date, status) values
  ('23600000-0000-0000-0000-000000000081', '23600000-0000-0000-0000-00000000000a', '23600000-0000-0000-0000-0000000000a5', '2026-11-16', 'Submitted');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('23600000-0000-0000-0000-000000000091', '23600000-0000-0000-0000-00000000000a', 'Site pass', 'person', false),
  ('23600000-0000-0000-0000-000000000092', '23600000-0000-0000-0000-00000000000a', 'Medical check', 'person', true);

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"sub":"23600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return 'ok';
exception when others then
  execute 'reset role';
  return sqlstate || ' ' || split_part(sqlerrm, ':', 1);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', '{"sub":"23600000-0000-0000-0000-0000000000' || p_user || '","role":"authenticated"}', true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $$;
create function pg_temp.person(p_name text) returns text language sql as $$
  select format('insert into people (code, name) values (%L, %L)', upper(replace(p_name, ' ', '')), p_name) $$;
create function pg_temp.tick(p_person text) returns text language sql as $$
  select format('insert into person_clearances (person_id, item_id, done_on) values (%L, %L, current_date)',
                '23600000-0000-0000-0000-0000000000' || p_person, '23600000-0000-0000-0000-000000000061') $$;
create function pg_temp.dtype(p_name text, p_applies text, p_medical boolean) returns text language sql as $$
  select format('insert into document_types (name, applies_to, is_medical) values (%L, %L, %L)', p_name, p_applies, p_medical) $$;


-- Make the refused peer able to read the subject, so its insert reaches the write-policy oracle.
update people set manager_id = '23600000-0000-0000-0000-0000000000a4' where code = 'W1';
-- mut:hr_medical_write: removing the HR branch makes AC-HRM-001 inserts fail.
create function pg_temp.med(p_name text) returns text language sql as $$
 select format('insert into expiry_documents (subject_kind, person_id, type_id, expires_on, medical_status) values (''person'', %L, %L, ''2027-12-31'', ''fit'')',
 '23600000-0000-0000-0000-000000000051', '23600000-0000-0000-0000-000000000092') $$;
select is(pg_temp.err('a2', pg_temp.med('officer')), 'ok', 'AC-HRM-001 HR Officer adds medical status and expiry');
select is(pg_temp.err('a3', pg_temp.med('manager')), 'ok', 'AC-HRM-001 HR Manager adds medical status and expiry');
select is(pg_temp.err('a1', pg_temp.med('admin')), 'ok', 'AC-HRM-001 Admin retains medical writes');
select matches(pg_temp.err('a4', pg_temp.med('store')), '^42501', 'AC-HRM-002 same-level other job role refused');
select matches(pg_temp.err('a6', pg_temp.med('field')), '^(42501|22023)', 'AC-HRM-002 field account refused');
select matches(pg_temp.err('a5', pg_temp.med('plain')), '^(42501|22023)', 'AC-HRM-002 plain Engineer refused');
-- The update proves stored rows, not merely a non-throwing UPDATE of zero rows.
select is(pg_temp.val('a2', $$with u as (update expiry_documents set medical_status = 'unfit' returning id) select count(*)::text from u$$), '3', 'AC-HRM-001 Officer edits medical status');
select is(pg_temp.val('a3', $$with u as (update expiry_documents set expires_on = '2028-12-31' returning id) select count(*)::text from u$$), '3', 'AC-HRM-001 Manager renews medical expiry');
select is(pg_temp.val('a2', $$with u as (update expiry_documents set archived_at = now() returning id) select count(*)::text from u$$), '3', 'AC-HRM-001 Officer archives medical records');
select is(pg_temp.val('a3', $$with u as (update expiry_documents set archived_at = null returning id) select count(*)::text from u$$), '3', 'AC-HRM-001 Manager retains archive write permission');
select is(pg_temp.val('a4', $$with u as (update expiry_documents set medical_status = 'fit' returning id) select count(*)::text from u$$), '0', 'AC-HRM-002 other role cannot edit medical rows');
select matches(pg_temp.err('a2', $$update expiry_documents set number = 'medical result'$$), '^23514', 'AC-HRM-003 medical shape still forbids extra content');
insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values ('23600000-0000-0000-0000-00000000000b', 'Other HR Org', 'IDR', 'UTC', true);
insert into people (id, org_id, code, name) values ('23600000-0000-0000-0000-000000000053','23600000-0000-0000-0000-00000000000b','OTHER','Other worker');
insert into document_types (id, org_id, name, applies_to, is_medical) values ('23600000-0000-0000-0000-000000000093','23600000-0000-0000-0000-00000000000b','Other medical','person',true);
insert into expiry_documents (subject_kind, org_id, person_id, type_id, expires_on, medical_status) values ('person','23600000-0000-0000-0000-00000000000b','23600000-0000-0000-0000-000000000053','23600000-0000-0000-0000-000000000093','2027-12-31','fit');
select is(pg_temp.val('a2', $$select count(*)::text from expiry_documents where person_id = '23600000-0000-0000-0000-000000000053'$$), '0', 'AC-HRM-004 other organisation medical record not found');
select is(pg_temp.val('a3', $$with u as (update expiry_documents set medical_status = 'unfit' where person_id = '23600000-0000-0000-0000-000000000053' returning id) select count(*)::text from u$$), '0', 'AC-HRM-004 other organisation medical record cannot be changed');
-- Executed negative controls: the same write oracle changes when either boundary is broken.
savepoint broad_writer_mutation;
alter policy expiry_documents_insert on public.expiry_documents with check (true);
select pg_temp.err('a4', pg_temp.med('broad')) as broad_result \gset
rollback to savepoint broad_writer_mutation;
select is(:'broad_result', 'ok', 'AC-HRM-MUT deny oracle detects a permissive writer mutation');
savepoint removed_hr_mutation;
\ir ../migrations/rollback/2360_hr_medical_document_writers_down.sql
select pg_temp.err('a2', pg_temp.med('removed')) as removed_result \gset
rollback to savepoint removed_hr_mutation;
select matches(:'removed_result', '^42501', 'AC-HRM-MUT allow oracle detects removing the HR writer branch');
select * from finish();
rollback;
