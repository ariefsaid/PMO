-- 1105_document_expiry_templates.test.sql — #2616 (map #2516): expiry warnings store a message key and parameters; user text stays literal.
begin;
create extension if not exists pgtap;
select plan(9);

insert into organizations (id, name, default_currency, default_timezone) values ('26160000-0000-0000-0000-00000000000a', 'DXT Org', 'IDR', 'UTC');
insert into auth.users (id, email) values ('26160000-0000-0000-0000-0000000000a1', 'dxt-admin@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('26160000-0000-0000-0000-0000000000a1', '26160000-0000-0000-0000-00000000000a', 'DXT Admin', 'dxt-admin@example.com', 'Admin', 'active');
insert into people (id, org_id, code, name) values
  ('26160000-0000-0000-0000-0000000000e1', '26160000-0000-0000-0000-00000000000a', 'P-T1', 'Budi {{x}} 50%');
insert into document_types (id, org_id, name, applies_to, notify_roles) values
  ('26160000-0000-0000-0000-0000000000f1', '26160000-0000-0000-0000-00000000000a', 'Permit {{type}}', 'person', '{Admin}');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on) values
  ('26160000-0000-0000-0000-000000000101', '26160000-0000-0000-0000-00000000000a', 'person', '26160000-0000-0000-0000-0000000000e1', '26160000-0000-0000-0000-0000000000f1', '2026-11-28');

select is(public.run_document_expiry_warnings('2026-11-21'), 1, 'AC-DEXT-001 the run sends one warning to the Admin (7 days left)');
select is((select message_key from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), 'documentExpiry', 'AC-DEXT-001 the warning stores the documentExpiry message key');
select is((select message_params->>'type' from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), 'Permit {{type}}', 'AC-DEXT-002 the document type is stored literally');
select is((select message_params->>'subject' from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), 'Budi {{x}} 50%', 'AC-DEXT-002 the person is stored literally');
select is((select (message_params->>'days')::int from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), 7, 'AC-DEXT-001 days left is a number');
select is((select message_params->>'expires_on' from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), '2026-11-28', 'AC-DEXT-001 the expiry date is stored as an ISO date, not an English month');
select is((select severity from notifications where owner_id = '26160000-0000-0000-0000-0000000000a1'), 'critical', 'AC-DEXT-001 severity is unchanged by the template');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '26160000-0000-0000-0000-0000000000a1', 'role', 'authenticated')::text, true);
insert into notifications (id, org_id, owner_id, title, body, metadata, message_key, message_params) values
  ('26160000-0000-0000-0000-000000000201', '26160000-0000-0000-0000-00000000000a', '26160000-0000-0000-0000-0000000000a1', 'Mine', 'Hello',
   '{"producer":"document-expiry"}', 'documentExpiry', '{"type":"x","subject":"y","days":1,"expires_on":"2026-01-01"}');
select is((select message_key from notifications where id = '26160000-0000-0000-0000-000000000201'), 'literal', 'AC-DEXT-003 a user cannot pick the expiry template');
reset role;

alter table public.notifications disable trigger notifications_message_template;
insert into notifications (id, org_id, owner_id, title, body) values
  ('26160000-0000-0000-0000-000000000202', '26160000-0000-0000-0000-00000000000a', '26160000-0000-0000-0000-0000000000a1', 'Old expiry', 'Old text expires 28 Nov 2026.');
alter table public.notifications enable trigger notifications_message_template;
select is((select body from notifications where id = '26160000-0000-0000-0000-000000000202'), 'Old text expires 28 Nov 2026.', 'AC-DEXT-004 an existing notification keeps its stored text');

select * from finish();
rollback;
