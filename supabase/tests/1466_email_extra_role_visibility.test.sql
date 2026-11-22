-- 1466_email_extra_role_visibility.test.sql — an extra-role email copy passes the same visibility test the in-app notice applies.
-- Migration under test: 1466_email_extra_role_visibility.sql (enqueue_notification_email).
-- A notice naming a medical expiry document is copied to an extra role only when that recipient may see medical documents
-- (the medical_documents_view capability, or the Admin access level). A notice naming a categorised register document is
-- copied to an extra role only when the recipient's role may view its category. The addressee's own copy is unchanged.
-- MUTATION NOTES (break the rule; the named assertion must go red; restore):
--   drop the expiry-document clause ............................ 'the medical expiry notice reaches only the recipients who may see medical documents'
--   drop the project-document clause ........................... 'a categorised register notice reaches only the roles that may view the category'
begin;
create extension if not exists pgtap;
select plan(6);

insert into organizations (id, name, default_currency, default_timezone, built_in_roles_enabled) values
  ('14660000-0000-0000-0000-00000000000a', 'EVX Org', 'IDR', 'UTC', true);
insert into auth.users (id, email) values
  ('14660000-0000-0000-0000-0000000000a1', 'evx-admin@example.com'),
  ('14660000-0000-0000-0000-0000000000a2', 'evx-pm@example.com'),
  ('14660000-0000-0000-0000-0000000000a3', 'evx-eng@example.com'),
  ('14660000-0000-0000-0000-0000000000a4', 'evx-hr@example.com'),
  ('14660000-0000-0000-0000-0000000000a5', 'evx-fin@example.com');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('14660000-0000-0000-0000-0000000000a1', '14660000-0000-0000-0000-00000000000a', 'EVX Admin', 'evx-admin@example.com', 'Admin',           'active', null),
  ('14660000-0000-0000-0000-0000000000a2', '14660000-0000-0000-0000-00000000000a', 'EVX PM',    'evx-pm@example.com',    'Project Manager', 'active', null),
  ('14660000-0000-0000-0000-0000000000a3', '14660000-0000-0000-0000-00000000000a', 'EVX Eng',   'evx-eng@example.com',   'Engineer',        'active', 'engineer'),
  ('14660000-0000-0000-0000-0000000000a4', '14660000-0000-0000-0000-00000000000a', 'EVX HR',    'evx-hr@example.com',    'Engineer',        'active', 'hr_officer'),
  ('14660000-0000-0000-0000-0000000000a5', '14660000-0000-0000-0000-00000000000a', 'EVX Fin',   'evx-fin@example.com',   'Finance',         'active', null);
insert into email_event_settings (org_id, event_key, enabled, extra_roles) values
  ('14660000-0000-0000-0000-00000000000a', 'document_expiry', true, array['Project Manager', 'Engineer']),
  ('14660000-0000-0000-0000-00000000000a', 'approval_request', true, array['Admin', 'Project Manager', 'Engineer']);

insert into people (id, org_id, code, name) values
  ('14660000-0000-0000-0000-0000000000e1', '14660000-0000-0000-0000-00000000000a', 'P-1', 'EVX Person');
insert into document_types (id, org_id, name, applies_to, is_medical) values
  ('14660000-0000-0000-0000-0000000000f1', '14660000-0000-0000-0000-00000000000a', 'Work permit',   'person', false),
  ('14660000-0000-0000-0000-0000000000f2', '14660000-0000-0000-0000-00000000000a', 'Medical check', 'person', true);
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, number, expires_on) values
  ('14660000-0000-0000-0000-000000000101', '14660000-0000-0000-0000-00000000000a', 'person', '14660000-0000-0000-0000-0000000000e1', '14660000-0000-0000-0000-0000000000f1', 'WP-1', '2026-12-20');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, medical_status, expires_on) values
  ('14660000-0000-0000-0000-000000000102', '14660000-0000-0000-0000-00000000000a', 'person', '14660000-0000-0000-0000-0000000000e1', '14660000-0000-0000-0000-0000000000f2', 'fit', '2026-12-10');

insert into document_categories (id, org_id, name, sort_order) values
  ('14660000-0000-0000-0000-000000000ca1', '14660000-0000-0000-0000-00000000000a', 'Restricted', 1),
  ('14660000-0000-0000-0000-000000000cb1', '14660000-0000-0000-0000-00000000000a', 'Shared', 2);
insert into document_category_roles (category_id, org_id, role) values
  ('14660000-0000-0000-0000-000000000ca1', '14660000-0000-0000-0000-00000000000a', 'Admin'),
  ('14660000-0000-0000-0000-000000000cb1', '14660000-0000-0000-0000-00000000000a', 'Admin'),
  ('14660000-0000-0000-0000-000000000cb1', '14660000-0000-0000-0000-00000000000a', 'Project Manager');
insert into projects (id, org_id, name, status, project_manager_id) values
  ('14660000-0000-0000-0000-0000000000d1', '14660000-0000-0000-0000-00000000000a', 'EVX Site', 'Ongoing Project', '14660000-0000-0000-0000-0000000000a2');
insert into project_documents (id, org_id, project_id, category, category_id, title) values
  ('14660000-0000-0000-0000-000000001001', '14660000-0000-0000-0000-00000000000a', '14660000-0000-0000-0000-0000000000d1', 'Restricted', '14660000-0000-0000-0000-000000000ca1', 'Restricted drawing'),
  ('14660000-0000-0000-0000-000000001002', '14660000-0000-0000-0000-00000000000a', '14660000-0000-0000-0000-0000000000d1', 'Shared', '14660000-0000-0000-0000-000000000cb1', 'Shared drawing');

-- who received an email copy for the notification naming this entity
create or replace function pg_temp.outbox_recipients(p_entity uuid) returns uuid[] language sql stable as $$
  select coalesce(array_agg(o.recipient_id order by o.recipient_id), '{}'::uuid[])
    from email_outbox o
    join notifications n on n.id = o.notification_id
   where n.metadata->'entity'->>'id' = p_entity::text
$$;

-- 1. document expiry through the real producer (0971): the type's notify roles are the addressee, the
--    event's extra roles are the copies.
select is((select notify_roles from document_types where name = 'Work permit'), array['Admin'],
  'the person type''s notify roles default to Admin');
select is(public.run_document_expiry_warnings('2026-11-20'), 2, 'the expiry run sends the two notices');

select is(pg_temp.outbox_recipients('14660000-0000-0000-0000-000000000102'::uuid),
  array['14660000-0000-0000-0000-0000000000a1'::uuid, '14660000-0000-0000-0000-0000000000a4'::uuid],
  'the medical expiry notice reaches only the recipients who may see medical documents (addressee + the capability holder)');
select is(pg_temp.outbox_recipients('14660000-0000-0000-0000-000000000101'::uuid),
  array['14660000-0000-0000-0000-0000000000a1'::uuid, '14660000-0000-0000-0000-0000000000a2'::uuid,
        '14660000-0000-0000-0000-0000000000a3'::uuid, '14660000-0000-0000-0000-0000000000a4'::uuid],
  'the work-permit notice reaches the addressee and every extra role');

-- 2. a notice naming a categorised register document (the owner addressee plus the event's extra roles)
insert into notifications (org_id, owner_id, severity, title, body, metadata) values
  ('14660000-0000-0000-0000-00000000000a', '14660000-0000-0000-0000-0000000000a5', 'info', 'Drawing awaiting your approval', null,
   jsonb_build_object('email_event', 'approval_request',
                      'entity', jsonb_build_object('type', 'project_document', 'id', '14660000-0000-0000-0000-000000001001'::uuid,
                                                   'label', 'Restricted drawing')));
insert into notifications (org_id, owner_id, severity, title, body, metadata) values
  ('14660000-0000-0000-0000-00000000000a', '14660000-0000-0000-0000-0000000000a5', 'info', 'Drawing awaiting your approval', null,
   jsonb_build_object('email_event', 'approval_request',
                      'entity', jsonb_build_object('type', 'project_document', 'id', '14660000-0000-0000-0000-000000001002'::uuid,
                                                   'label', 'Shared drawing')));

select is(pg_temp.outbox_recipients('14660000-0000-0000-0000-000000001001'::uuid),
  array['14660000-0000-0000-0000-0000000000a1'::uuid, '14660000-0000-0000-0000-0000000000a5'::uuid],
  'a restricted-category notice reaches its addressee and only the extra roles that may view the category');
select is(pg_temp.outbox_recipients('14660000-0000-0000-0000-000000001002'::uuid),
  array['14660000-0000-0000-0000-0000000000a1'::uuid, '14660000-0000-0000-0000-0000000000a2'::uuid,
        '14660000-0000-0000-0000-0000000000a5'::uuid],
  'a shared-category notice reaches its addressee and the extra roles that may view the category');

select * from finish();
rollback;
