-- document_expiry.test.sql — 0970-0974 (#2527). Owns AC-DEX-001..008 (RLS, runner schedule, idempotency, list, medical shape).
begin;
create extension if not exists pgtap;
select plan(45);

insert into organizations (id, name, default_currency, default_timezone) values
  ('25270000-0000-0000-0000-00000000000a', 'DEX Org',   'IDR', 'UTC'),
  ('25270000-0000-0000-0000-00000000000b', 'DEX Other', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('25270000-0000-0000-0000-0000000000a1', 'dex-admin@example.com'),
  ('25270000-0000-0000-0000-0000000000a2', 'dex-pm@example.com'),
  ('25270000-0000-0000-0000-0000000000a3', 'dex-mgr@example.com'),
  ('25270000-0000-0000-0000-0000000000a4', 'dex-eng@example.com'),
  ('25270000-0000-0000-0000-0000000000b1', 'dex-xorg@example.com'),
  ('25270000-0000-0000-0000-0000000000a5', 'dex-finance@example.com'),
  ('25270000-0000-0000-0000-0000000000a6', 'dex-executive@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('25270000-0000-0000-0000-0000000000a1', '25270000-0000-0000-0000-00000000000a', 'DEX Admin', 'dex-admin@example.com', 'Admin', 'active'),
  ('25270000-0000-0000-0000-0000000000a2', '25270000-0000-0000-0000-00000000000a', 'DEX PM',    'dex-pm@example.com',    'Project Manager', 'active'),
  ('25270000-0000-0000-0000-0000000000a3', '25270000-0000-0000-0000-00000000000a', 'DEX Mgr',   'dex-mgr@example.com',   'Engineer', 'active'),
  ('25270000-0000-0000-0000-0000000000a4', '25270000-0000-0000-0000-00000000000a', 'DEX Eng',   'dex-eng@example.com',   'Engineer', 'active'),
  ('25270000-0000-0000-0000-0000000000b1', '25270000-0000-0000-0000-00000000000b', 'DEX XOrg',  'dex-xorg@example.com',  'Admin', 'active'),
  ('25270000-0000-0000-0000-0000000000a5', '25270000-0000-0000-0000-00000000000a', 'Finance', 'dex-finance@example.com', 'Finance', 'active'),
  ('25270000-0000-0000-0000-0000000000a6', '25270000-0000-0000-0000-00000000000a', 'Executive', 'dex-executive@example.com', 'Executive', 'active');
insert into people (id, org_id, code, name, manager_id, profile_id) values
  ('25270000-0000-0000-0000-0000000000e1', '25270000-0000-0000-0000-00000000000a', 'P-1', 'Person One', '25270000-0000-0000-0000-0000000000a3', '25270000-0000-0000-0000-0000000000a4'),
  ('25270000-0000-0000-0000-0000000000e9', '25270000-0000-0000-0000-00000000000b', 'P-X', 'Foreign Person', null, null);
insert into equipment_assets (id, org_id, code, name) values
  ('25270000-0000-0000-0000-0000000000d1', '25270000-0000-0000-0000-00000000000a', 'EQ-1', 'Crane One');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('25270000-0000-0000-0000-0000000000f1', '25270000-0000-0000-0000-00000000000a', 'Work permit', 'person', false),
  ('25270000-0000-0000-0000-0000000000f2', '25270000-0000-0000-0000-00000000000a', 'Medical check', 'person', true),
  ('25270000-0000-0000-0000-0000000000f3', '25270000-0000-0000-0000-00000000000a', 'Equipment certificate', 'equipment', false);

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

select is((select notify_roles from document_types where name = 'Work permit'), array['Admin'], 'AC-DEX-001 person type defaults to HR (Admin)');
select is((select notify_roles from document_types where name = 'Equipment certificate'), array['Admin','Project Manager'], 'AC-DEX-001 equipment type defaults to Admin + PM');

-- documents (as owner): work permit expires 2026-12-20; equipment cert 2026-12-05; medical 2026-12-10; far-future permit
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, number, expires_on) values
  ('25270000-0000-0000-0000-000000000101', '25270000-0000-0000-0000-00000000000a', 'person', '25270000-0000-0000-0000-0000000000e1', '25270000-0000-0000-0000-0000000000f1', 'WP-1', '2026-12-20');
insert into expiry_documents (id, org_id, subject_kind, asset_id, type_id, number, expires_on) values
  ('25270000-0000-0000-0000-000000000102', '25270000-0000-0000-0000-00000000000a', 'equipment', '25270000-0000-0000-0000-0000000000d1', '25270000-0000-0000-0000-0000000000f3', 'EC-1', '2026-12-05');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on) values
  ('25270000-0000-0000-0000-000000000103', '25270000-0000-0000-0000-00000000000a', 'person', '25270000-0000-0000-0000-0000000000e1', '25270000-0000-0000-0000-0000000000f2', 'fit', '2026-12-10');

select is((select is_medical from expiry_documents where id = '25270000-0000-0000-0000-000000000103'), true, 'AC-DEX-002 is_medical is stamped from the type');
select throws_ok($$insert into expiry_documents (org_id, subject_kind, person_id, type_id, number, medical_status, expires_on)
  values ('25270000-0000-0000-0000-00000000000a','person','25270000-0000-0000-0000-0000000000e1','25270000-0000-0000-0000-0000000000f2','R-99','fit','2027-01-01')$$,
  '23514', null, 'AC-DEX-002 a medical document cannot carry a number (status and date only)');
select throws_ok($$insert into expiry_documents (org_id, subject_kind, person_id, type_id, expires_on)
  values ('25270000-0000-0000-0000-00000000000a','person','25270000-0000-0000-0000-0000000000e1','25270000-0000-0000-0000-0000000000f3','2027-01-01')$$,
  '22023', null, 'AC-DEX-002 an equipment type cannot be used on a person');
select throws_ok($$insert into expiry_documents (org_id, subject_kind, person_id, type_id, expires_on)
  values ('25270000-0000-0000-0000-00000000000a','person','25270000-0000-0000-0000-0000000000e9','25270000-0000-0000-0000-0000000000f1','2027-01-01')$$,
  '22023', null, 'AC-DEX-002 a foreign-org person is rejected');

select throws_ok($$insert into people (org_id, code, name, profile_id) values ('25270000-0000-0000-0000-00000000000a','CROSS-P','Cross profile','25270000-0000-0000-0000-0000000000b1')$$, '23503', null, 'AC-DEX-005 cross-org profile is rejected');
select throws_ok($$insert into people (org_id, code, name, manager_id) values ('25270000-0000-0000-0000-00000000000a','CROSS-M','Cross manager','25270000-0000-0000-0000-0000000000b1')$$, '23503', null, 'AC-DEX-005 cross-org manager is rejected');
-- time-controlled runner. Warning days default {30,14,7}.
select is(public.run_document_expiry_warnings('2026-11-04'), 0, 'AC-DEX-003 nothing is sent before the first threshold (earliest doc is 31 days out)');
-- 2026-11-20: equipment cert (12-05) is 15 days out -> threshold 30; permit (12-20) is 30 days -> threshold 30; medical 12-10 is 20 -> 30
select is(public.run_document_expiry_warnings('2026-11-20'), 7, 'AC-DEX-003 30-day wave: permit→manager+admin, medical→admin, the subject and the manager as a plain notice (24 Nov ruling), certificate→admin+PM');
select is(public.run_document_expiry_warnings('2026-11-20'), 0, 'AC-DEX-004 re-running the same day sends nothing (idempotent)');
select is((select count(*)::int from notifications where owner_id = '25270000-0000-0000-0000-0000000000a1' and body like '%Work permit%'), 1,
  'AC-DEX-003 permit notice reached HR (Admin) at 30 days') ;
select is((select count(*)::int from notifications where owner_id = '25270000-0000-0000-0000-0000000000a3'), 2, 'AC-DEX-003 the person''s manager is notified for both person documents (2043: the medical one too)');
select is((select (metadata->'entity'->>'id') is null and (metadata->'entity'->>'type') is null and body = 'Person One — Medical check expires 10 Dec 2026.'
             from notifications where owner_id = '25270000-0000-0000-0000-0000000000a3' and body like '%Medical check%'), true,
  'AC-DEX-003 the manager''s medical notice names the person, the type and the date, and links to no document (2043)');
select is((select count(*)::int from notifications where owner_id = '25270000-0000-0000-0000-0000000000a4'), 1, 'AC-DEX-003 the medical subject receives their own warning under the 24 Nov ruling');
select is((select count(*)::int from notifications where owner_id = '25270000-0000-0000-0000-0000000000a2'), 1, 'AC-DEX-003 equipment notice reaches the PM role only for equipment');
select is(public.run_document_expiry_warnings('2026-12-01'), 5, 'AC-DEX-004 next crossings only: certificate to 7 days (2), medical to 14 days (3: admin, subject and manager); permit stays at 30');
select is((select severity from notifications where owner_id = '25270000-0000-0000-0000-0000000000a2' and body like '%Crane One%' and title like '%expires in 4 days%'), 'critical', 'AC-DEX-004 the 7-day warning is critical');
select is((select count(*)::int from notifications where body ilike '%fit%' or body ilike '%unfit%'), 0, 'AC-DEX-002 no notification discloses a medical status');

-- RLS
set local role authenticated;
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from expiry_documents), 0, 'AC-DEX-005 an unrelated Engineer sees no documents');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from expiry_documents where is_medical), 0, 'AC-DEX-005 the manager told of a medical expiry still reads no medical document (2043)');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a4');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a5');
select is((select count(*)::int from expiry_documents), 0, 'AC-DEX-005 Finance cannot read unrelated documents');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a6');
select is((select count(*)::int from expiry_documents), 0, 'AC-DEX-005 Executive cannot read unrelated documents');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a3');
select is((select count(*)::int from expiry_documents), 1, 'AC-DEX-005 a manager sees their report''s non-medical document only');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from expiry_documents), 1, 'AC-DEX-005 a PM sees equipment documents only');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from expiry_documents), 3, 'AC-DEX-005 Admin sees all three, including medical');
select is((select count(*)::int from list_expiring_documents(15, '2026-11-20')), 1, 'AC-DEX-006 the list shows only what expires within the window (certificate, 15 days)');
select is((select count(*)::int from list_expiring_documents(30, '2026-11-20')), 3, 'AC-DEX-006 a 30-day list includes all three');
select throws_ok($$insert into expiry_documents (subject_kind, person_id, type_id, expires_on, is_medical)
  values ('person','25270000-0000-0000-0000-0000000000e1','25270000-0000-0000-0000-0000000000f1','2027-01-01', true)$$,
  '42501', null, 'AC-DEX-007 is_medical is not client-writable');
select lives_ok($$select set_document_warning_days(array[5,60,5])$$, 'AC-DEX-008 Admin sets the warning days');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a2');
select throws_ok($$select set_document_warning_days(array[10])$$, '42501', null, 'AC-DEX-008 a PM cannot change the warning days');
select throws_ok($$insert into expiry_documents (subject_kind, person_id, type_id, expires_on)
  values ('person','25270000-0000-0000-0000-0000000000e1','25270000-0000-0000-0000-0000000000f1','2027-01-01')$$,
  '42501', null, 'AC-DEX-005 a PM cannot write person documents');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from expiry_documents), 0, 'AC-DEX-005 another organisation sees nothing');
select is((select count(*)::int from people where id = '25270000-0000-0000-0000-0000000000e1'), 0, 'AC-DEX-005 another organisation cannot read the person');
select is((select count(*)::int from document_types), 0, 'AC-DEX-005 another organisation cannot read document types');
select throws_ok($$select * from document_expiry_notices$$, '42501', null, 'AC-DEX-005 another organisation cannot read notice records');
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a4');
select is((select count(*)::int from expiry_documents where subject_kind = 'person'), 0, 'AC-DEX-005 linked person cannot read own documents');
select is((select count(*)::int from expiry_documents where subject_kind = 'equipment'), 0, 'AC-DEX-005 unrelated Engineer cannot read equipment documents');
reset role;
select is((select document_warning_days from organizations where id = '25270000-0000-0000-0000-00000000000a'), array[60,5], 'AC-DEX-008 warning days are stored sorted and unique');
select is((select document_warning_days from organizations where id = '25270000-0000-0000-0000-00000000000b'), array[30,14,7], 'AC-DEX-008 updating one organisation leaves the other unchanged');
set local role anon;
select throws_ok($$select public.set_document_warning_days(array[10])$$, '42501', null, 'AC-DEX-008 anonymous callers cannot change warning days');
reset role;

insert into expiry_documents (org_id, subject_kind, person_id, type_id, expires_on)
select '25270000-0000-0000-0000-00000000000a', 'person', '25270000-0000-0000-0000-0000000000e1', '25270000-0000-0000-0000-0000000000f1', '2026-12-01' from generate_series(1, 501);
set local role authenticated;
select pg_temp.act_as('25270000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from list_expiring_documents(30, '2026-11-20')), 504, 'AC-DEX-006 list includes more than 500 documents');
select lives_ok($$insert into expiry_documents (subject_kind, person_id, type_id, expires_on)
  values ('person', '25270000-0000-0000-0000-0000000000e1', '25270000-0000-0000-0000-0000000000f1', '2027-01-01')$$,
  'AC-DEX-005 Admin can insert without specifying org_id');
reset role;
select throws_ok($$update people set manager_id = '25270000-0000-0000-0000-0000000000b1' where id = '25270000-0000-0000-0000-0000000000e1'$$, '23503', null, 'AC-DEX-005 cross-org manager update is rejected');
select throws_ok($$update people set profile_id = '25270000-0000-0000-0000-0000000000b1' where id = '25270000-0000-0000-0000-0000000000e1'$$, '23503', null, 'AC-DEX-005 cross-org profile update is rejected');

select * from finish();
rollback;
