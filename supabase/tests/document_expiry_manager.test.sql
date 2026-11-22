-- document_expiry_manager.test.sql — 1760/1761 (expiry-to-manager). Owns AC-EXM-001..005 (needs notify_person from 1750).
begin;
create extension if not exists pgtap;
select plan(20);

insert into organizations (id, name, default_currency, default_timezone) values ('17600000-0000-0000-0000-00000000000a', 'EXM Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('17600000-0000-0000-0000-0000000000a1', 'exm-admin@example.com'),
  ('17600000-0000-0000-0000-0000000000a3', 'exm-mgr@example.com'),
  ('17600000-0000-0000-0000-0000000000a4', 'exm-worker@example.com'),
  ('17600000-0000-0000-0000-0000000000a5', 'exm-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17600000-0000-0000-0000-0000000000a1', '17600000-0000-0000-0000-00000000000a', 'EXM Admin', 'exm-admin@example.com', 'Admin', 'active'),
  ('17600000-0000-0000-0000-0000000000a3', '17600000-0000-0000-0000-00000000000a', 'EXM Mgr', 'exm-mgr@example.com', 'Engineer', 'active'),
  ('17600000-0000-0000-0000-0000000000a4', '17600000-0000-0000-0000-00000000000a', 'EXM Worker', 'exm-worker@example.com', 'Engineer', 'active'),
  ('17600000-0000-0000-0000-0000000000a5', '17600000-0000-0000-0000-00000000000a', 'EXM Other', 'exm-other@example.com', 'Engineer', 'active');
insert into people (id, org_id, code, name, manager_id, profile_id) values
  ('17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-00000000000a', 'X-1', 'Worker One', '17600000-0000-0000-0000-0000000000a3', '17600000-0000-0000-0000-0000000000a4'),
  ('17600000-0000-0000-0000-0000000000e2', '17600000-0000-0000-0000-00000000000a', 'X-2', 'Worker Two', '17600000-0000-0000-0000-0000000000a5', null);
create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

-- AC-EXM-003: explicit empty stays empty; omitted gets the kind default
insert into document_types (id, org_id, name, applies_to, is_medical, notify_roles) values
  ('17600000-0000-0000-0000-0000000000f1', '17600000-0000-0000-0000-00000000000a', 'Manager only', 'person', false, '{}');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('17600000-0000-0000-0000-0000000000f2', '17600000-0000-0000-0000-00000000000a', 'Defaulted', 'person', false),
  ('17600000-0000-0000-0000-0000000000f3', '17600000-0000-0000-0000-00000000000a', 'Defaulted gear', 'equipment', false),
  ('17600000-0000-0000-0000-0000000000f4', '17600000-0000-0000-0000-00000000000a', 'Tells person', 'person', false),
  ('17600000-0000-0000-0000-0000000000f5', '17600000-0000-0000-0000-00000000000a', 'Medical', 'person', true);
update document_types set notify_person = true, notify_roles = '{}' where id = '17600000-0000-0000-0000-0000000000f4';

select is((select notify_roles from document_types where name = 'Manager only'), '{}'::text[], 'AC-EXM-003 an explicit empty role list stays empty');
select is((select notify_roles from document_types where name = 'Defaulted'), array['Admin'], 'AC-EXM-003 omitted list: person type defaults to Admin');
select is((select notify_roles from document_types where name = 'Defaulted gear'), array['Admin','Project Manager'], 'AC-EXM-003 omitted list: equipment type defaults to Admin + PM');
select is((select notify_person from document_types where name = 'Defaulted'), false, 'AC-EXM-002 the person is not warned unless the type says so (default off)');

insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on) values
  ('17600000-0000-0000-0000-0000000000c1', '17600000-0000-0000-0000-00000000000a', 'person', '17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-0000000000f1', '2026-12-04'),
  ('17600000-0000-0000-0000-0000000000c2', '17600000-0000-0000-0000-00000000000a', 'person', '17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-0000000000f4', '2026-12-04');
select is(public.run_document_expiry_warnings('2026-11-20'), 3, 'AC-EXM-001/002 manager-only type: manager; also-tell-the-person type: manager and worker');
select is((select array_agg(recipient_id order by recipient_id) from document_expiry_notices where document_id = '17600000-0000-0000-0000-0000000000c1'), array['17600000-0000-0000-0000-0000000000a3']::uuid[], 'AC-EXM-001 manager-only type warns the manager and not the worker');
select is((select array_agg(recipient_id order by recipient_id) from document_expiry_notices where document_id = '17600000-0000-0000-0000-0000000000c2'), array['17600000-0000-0000-0000-0000000000a3', '17600000-0000-0000-0000-0000000000a4']::uuid[], 'AC-EXM-002 the type that tells the person warns the worker as well as the manager');

-- AC-EXM-004/005: the manager records the renewal for their own people only; the worker is told
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on) values
  ('17600000-0000-0000-0000-0000000000c3', '17600000-0000-0000-0000-00000000000a', 'person', '17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-0000000000f2', '2027-01-10'),
  ('17600000-0000-0000-0000-0000000000c4', '17600000-0000-0000-0000-00000000000a', 'person', '17600000-0000-0000-0000-0000000000e2', '17600000-0000-0000-0000-0000000000f2', '2027-01-10');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on, medical_status) values
  ('17600000-0000-0000-0000-0000000000c5', '17600000-0000-0000-0000-00000000000a', 'person', '17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-0000000000f5', '2027-01-10', 'fit');

select pg_temp.act_as('17600000-0000-0000-0000-0000000000a3');
select lives_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c3', '2027-02-10')$$, 'AC-EXM-004 a manager records the renewal for their own person');
select is((select expires_on from expiry_documents where id = '17600000-0000-0000-0000-0000000000c3'), '2027-02-10'::date, 'AC-EXM-004 the new date is saved');
select throws_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c4', '2027-02-10')$$, '42501', null, 'AC-EXM-004 a manager cannot renew someone else''s person');
select throws_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c3', '2027-02-10')$$, '22023', null, 'AC-EXM-004 a date that is not later is refused');
select throws_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c5', '2027-02-10')$$, '42501', null, 'AC-EXM-004 a manager cannot renew a medical document');
select pg_temp.act_as('17600000-0000-0000-0000-0000000000a1');
select lives_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c4', '2027-03-10')$$, 'AC-EXM-004 Admin keeps the right to record any renewal');
select pg_temp.act_as('17600000-0000-0000-0000-0000000000a4');
select throws_ok($$select public.record_document_renewal('17600000-0000-0000-0000-0000000000c3', '2027-05-10')$$, '42501', null, 'AC-EXM-004 the worker cannot renew their own document');
select is((select expires_on from expiry_documents where id = '17600000-0000-0000-0000-0000000000c3'), '2027-02-10'::date, 'AC-EXM-004 a refused renewal changes nothing');

select is((select count(*)::int from notifications where owner_id = '17600000-0000-0000-0000-0000000000a4' and title like '% renewed' and body like '%10 Feb 2027%'), 1, 'AC-EXM-005 the worker is told once, with the new date');
select is((select count(*)::int from notifications where owner_id = '17600000-0000-0000-0000-0000000000a5'), 0, 'AC-EXM-005 the unlinked person''s notice goes nowhere (no-op, no error)');
select is((select count(*)::int from notifications where body like '%fit%' and title like '% renewed'), 0, 'AC-EXM-005 no notice carries a medical status');

select is((select count(*)::int from email_outbox o join notifications n on n.id = o.notification_id where n.owner_id = '17600000-0000-0000-0000-0000000000a4' and n.title like '% renewed'), 0, 'AC-EXM-005 the renewal notice queues no expiry email (its kind maps to no email event)');

-- audit: exactly one row for the manager's renewal of c3 (10 Jan 2027 -> 10 Feb 2027), by the manager. MUTATION: drop the log_audit call -> red.
select is((select count(*)::int from audit_events where action = 'expiry_document.renewed' and entity_id = '17600000-0000-0000-0000-0000000000c3'
             and actor_id = '17600000-0000-0000-0000-0000000000a3' and detail = jsonb_build_object('from', '2027-01-10'::date, 'to', '2027-02-10'::date)), 1,
  'AC-EXM-004 a renewal writes exactly one audit row with the document, both dates and the actor');

select * from finish();
rollback;
