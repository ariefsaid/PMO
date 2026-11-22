-- 2717_medical_documents_capability.test.sql — medical-document status and dates: one rule, read by the app and the expiry email.
-- Migration under test: 1535_medical_documents_capability_gate.sql (may_see_medical_documents, expiry_documents_select, enqueue_notification_email).
-- Holders: the Admin access level and the medical_documents_view capability (HR Manager, HR Officer, Administrator).
-- A person without it sees no medical row and gets no medical email copy; a person with no built-in role is as before.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   may_see_medical_documents returns only `p.role = 'Admin'` ... 'AC-RCG-010 an HR Officer reads the medical row' (and the HR Manager,
--                                                                  list, adapter and email assertions)
--   may_see_medical_documents returns true ........................ 'AC-RCG-011 a plain Engineer reads no medical row' (and the others)
begin;
create extension if not exists pgtap;
select plan(15);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('27170000-0000-0000-0000-00000000000a', 'MDC Org',   'IDR', 'UTC', true),
  ('27170000-0000-0000-0000-00000000000b', 'MDC Other', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('27170000-0000-0000-0000-0000000000a1', 'mdc-admin@example.com'),
  ('27170000-0000-0000-0000-0000000000a2', 'mdc-hrm@example.com'),
  ('27170000-0000-0000-0000-0000000000a3', 'mdc-hro@example.com'),
  ('27170000-0000-0000-0000-0000000000a4', 'mdc-eng@example.com'),
  ('27170000-0000-0000-0000-0000000000a5', 'mdc-legacy-eng@example.com'),
  ('27170000-0000-0000-0000-0000000000a6', 'mdc-legacy-pm@example.com'),
  ('27170000-0000-0000-0000-0000000000a7', 'mdc-fin@example.com'),
  ('27170000-0000-0000-0000-0000000000a8', 'mdc-hro-off@example.com'),
  ('27170000-0000-0000-0000-0000000000b1', 'mdc-xorg-hro@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('27170000-0000-0000-0000-0000000000a1', '27170000-0000-0000-0000-00000000000a', 'MDC Admin',      'mdc-admin@example.com',      'Admin',           'active',   null),
  ('27170000-0000-0000-0000-0000000000a2', '27170000-0000-0000-0000-00000000000a', 'MDC HR Manager', 'mdc-hrm@example.com',        'Project Manager', 'active',   'hr_manager'),
  ('27170000-0000-0000-0000-0000000000a3', '27170000-0000-0000-0000-00000000000a', 'MDC HR Officer', 'mdc-hro@example.com',        'Engineer',        'active',   'hr_officer'),
  ('27170000-0000-0000-0000-0000000000a4', '27170000-0000-0000-0000-00000000000a', 'MDC Engineer',   'mdc-eng@example.com',        'Engineer',        'active',   'engineer'),
  ('27170000-0000-0000-0000-0000000000a5', '27170000-0000-0000-0000-00000000000a', 'MDC Legacy Eng', 'mdc-legacy-eng@example.com', 'Engineer',        'active',   null),
  ('27170000-0000-0000-0000-0000000000a6', '27170000-0000-0000-0000-00000000000a', 'MDC Legacy PM',  'mdc-legacy-pm@example.com',  'Project Manager', 'active',   null),
  ('27170000-0000-0000-0000-0000000000a7', '27170000-0000-0000-0000-00000000000a', 'MDC Finance',    'mdc-fin@example.com',        'Finance',         'active',   null),
  ('27170000-0000-0000-0000-0000000000a8', '27170000-0000-0000-0000-00000000000a', 'MDC HR Off',     'mdc-hro-off@example.com',    'Engineer',        'active',   'hr_officer'),
  ('27170000-0000-0000-0000-0000000000b1', '27170000-0000-0000-0000-00000000000b', 'MDC XOrg HR',    'mdc-xorg-hro@example.com',   'Engineer',        'active',   'hr_officer');
update profiles set status = 'disabled' where id = '27170000-0000-0000-0000-0000000000a8';
insert into email_event_settings (org_id, event_key, enabled, extra_roles) values
  ('27170000-0000-0000-0000-00000000000a', 'document_expiry', true, array['Project Manager', 'Engineer']);

insert into people (id, org_id, code, name) values
  ('27170000-0000-0000-0000-0000000000e1', '27170000-0000-0000-0000-00000000000a', 'P-1', 'MDC Person');
insert into document_types (id, org_id, name, applies_to, is_medical, notify_roles) values
  ('27170000-0000-0000-0000-0000000000f1', '27170000-0000-0000-0000-00000000000a', 'Work permit',   'person', false, '{}'),
  ('27170000-0000-0000-0000-0000000000f2', '27170000-0000-0000-0000-00000000000a', 'Medical check', 'person', true,  '{}');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, number, expires_on) values
  ('27170000-0000-0000-0000-000000000101', '27170000-0000-0000-0000-00000000000a', 'person', '27170000-0000-0000-0000-0000000000e1', '27170000-0000-0000-0000-0000000000f1', 'WP-1', '2026-12-20');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on) values
  ('27170000-0000-0000-0000-000000000102', '27170000-0000-0000-0000-00000000000a', 'person', '27170000-0000-0000-0000-0000000000e1', '27170000-0000-0000-0000-0000000000f2', 'fit', '2026-12-10');

create or replace function pg_temp.act_as(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.medical_rows() returns integer language sql stable as $$
  select count(*)::int from public.expiry_documents where is_medical
$$;
create or replace function pg_temp.outbox_recipients(p_entity uuid) returns uuid[] language sql stable as $$
  select coalesce(array_agg(o.recipient_id order by o.recipient_id), '{}'::uuid[])
    from email_outbox o join notifications n on n.id = o.notification_id
   where n.metadata->'entity'->>'id' = p_entity::text
$$;

-- the email channel: the expiry run writes the notices, the extra roles are the copies
select is(public.run_document_expiry_warnings('2026-11-20'), 2, 'AC-RCG-012 the expiry run sends the two notices');
select is(pg_temp.outbox_recipients('27170000-0000-0000-0000-000000000102'::uuid),
  array['27170000-0000-0000-0000-0000000000a1'::uuid, '27170000-0000-0000-0000-0000000000a2'::uuid, '27170000-0000-0000-0000-0000000000a3'::uuid],
  'AC-RCG-012 the medical notice reaches the Admin addressee and the holders of the capability only');
select is(pg_temp.outbox_recipients('27170000-0000-0000-0000-000000000101'::uuid),
  array['27170000-0000-0000-0000-0000000000a1'::uuid, '27170000-0000-0000-0000-0000000000a2'::uuid, '27170000-0000-0000-0000-0000000000a3'::uuid,
        '27170000-0000-0000-0000-0000000000a4'::uuid, '27170000-0000-0000-0000-0000000000a5'::uuid, '27170000-0000-0000-0000-0000000000a6'::uuid],
  'AC-RCG-012 the non-medical notice reaches every extra role, as before');

-- the app channel: the same rule through the row policy
set local role authenticated;
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a3');
select is(pg_temp.medical_rows(), 1, 'AC-RCG-010 an HR Officer reads the medical row');
select is((select count(*)::int from list_expiring_documents(30, '2026-11-20') where is_medical), 1, 'AC-RCG-010 and sees it on the expiry list');
select ok(public.actor_may_see_medical_documents(), 'AC-RCG-010 the signed-in rule answers yes for the HR Officer');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a2');
select is(pg_temp.medical_rows(), 1, 'AC-RCG-010 an HR Manager reads the medical row');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a1');
select is(pg_temp.medical_rows(), 1, 'AC-RCG-010 an Admin reads the medical row');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a4');
select is(pg_temp.medical_rows(), 0, 'AC-RCG-011 a plain Engineer reads no medical row');
select ok(not public.actor_may_see_medical_documents(), 'AC-RCG-011 the signed-in rule answers no for the plain Engineer');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a5');
select is(pg_temp.medical_rows(), 0, 'AC-RCG-011 an Engineer with no built-in role reads none, as before');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a6');
select is(pg_temp.medical_rows(), 0, 'AC-RCG-011 a Project Manager with no built-in role reads none, as before');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000a7');
select is(pg_temp.medical_rows(), 0, 'AC-RCG-011 Finance reads none, as before');
select pg_temp.act_as('27170000-0000-0000-0000-0000000000b1');
select is(pg_temp.medical_rows(), 0, 'AC-RCG-011 an HR Officer of another organisation reads none');
reset role;

select ok(not public.may_see_medical_documents('27170000-0000-0000-0000-0000000000a8')
          and not has_function_privilege('authenticated', 'public.may_see_medical_documents(uuid)', 'execute'),
  'AC-RCG-013 a disabled HR Officer holds nothing, and the profile-keyed rule is not callable by a signed-in role');

select * from finish();
rollback;
