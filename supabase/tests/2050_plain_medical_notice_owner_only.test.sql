-- 2050_plain_medical_notice_owner_only.test.sql — a direct manager's plain notice of a medical document's expiry is that manager's
-- alone (migration 2050): the organisation emails document_expiry with Engineer as an extra role, yet an unrelated Engineer gets
-- neither the notice nor its email. A non-medical expiry notice is the control: its email still reaches the extra role.
-- MUTATION NOTES:
--   mut:rr_owner_only (2050 enqueue_notification_email; drop the owner-only test) -> RR-MN-03 goes red
--   mut:rr_plain_marker (2050 run_document_expiry_warnings; drop the marker) -> RR-MN-03 goes red
--   mut:rr_medical_plain (2050; never plain) -> 'RR-MN-01 the manager gets exactly one plain notice' goes red
begin;
create extension if not exists pgtap;
select plan(7);

insert into organizations (id, name, default_currency, default_timezone) values ('20500000-0000-0000-0000-00000000000a', 'RR MN Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('20500000-0000-0000-0000-0000000000a3', 'rrmn-mgr@example.com'),
  ('20500000-0000-0000-0000-0000000000a5', 'rrmn-other@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('20500000-0000-0000-0000-0000000000a3', '20500000-0000-0000-0000-00000000000a', 'RRMN Mgr', 'rrmn-mgr@example.com', 'Engineer', 'active'),
  ('20500000-0000-0000-0000-0000000000a5', '20500000-0000-0000-0000-00000000000a', 'RRMN Other', 'rrmn-other@example.com', 'Engineer', 'active');
insert into people (id, org_id, code, name, manager_id) values
  ('20500000-0000-0000-0000-0000000000e1', '20500000-0000-0000-0000-00000000000a', 'MN-1', 'Worker One', '20500000-0000-0000-0000-0000000000a3');
insert into document_types (id, org_id, name, applies_to, is_medical, notify_roles) values
  ('20500000-0000-0000-0000-0000000000f1', '20500000-0000-0000-0000-00000000000a', 'Fitness check', 'person', true, '{}'),
  ('20500000-0000-0000-0000-0000000000f2', '20500000-0000-0000-0000-00000000000a', 'Site pass', 'person', false, '{}');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on, medical_status) values
  ('20500000-0000-0000-0000-0000000000c1', '20500000-0000-0000-0000-00000000000a', 'person', '20500000-0000-0000-0000-0000000000e1', '20500000-0000-0000-0000-0000000000f1', '2026-12-04', 'fit');
insert into expiry_documents (id, org_id, subject_kind, person_id, type_id, expires_on) values
  ('20500000-0000-0000-0000-0000000000c2', '20500000-0000-0000-0000-00000000000a', 'person', '20500000-0000-0000-0000-0000000000e1', '20500000-0000-0000-0000-0000000000f2', '2026-12-04');
insert into email_event_settings (org_id, event_key, enabled, extra_roles) values
  ('20500000-0000-0000-0000-00000000000a', 'document_expiry', true, array['Engineer'])
  on conflict (org_id, event_key) do update set enabled = true, extra_roles = excluded.extra_roles;

create function pg_temp.mailed(p_type text) returns text language sql as $$
  select string_agg(right(o.recipient_id::text, 2), ',' order by o.recipient_id)
    from email_outbox o join notifications n on n.id = o.notification_id
   where n.org_id = '20500000-0000-0000-0000-00000000000a' and n.title like p_type || ' expires%' $$;

select lives_ok($$select public.run_document_expiry_warnings('2026-11-20')$$, 'RR-MN-01 the warning run completes');
select is((select count(*)::int from document_expiry_notices where org_id = '20500000-0000-0000-0000-00000000000a'
             and recipient_id = '20500000-0000-0000-0000-0000000000a3'), 2, 'RR-MN-01 the run warns the manager of both documents');
select is((select count(*)::int from notifications where owner_id = '20500000-0000-0000-0000-0000000000a3' and title like 'Fitness check expires%'
             and metadata->'entity'->>'id' is null), 1,
  'RR-MN-01 the manager gets exactly one plain notice of the medical document');
select is((select count(*)::int from notifications where owner_id = '20500000-0000-0000-0000-0000000000a5'), 0,
  'RR-MN-02 an unrelated Engineer gets no notice');
select is(pg_temp.mailed('Fitness check'), 'a3', 'RR-MN-03 the plain notice is emailed to the manager alone, never to the extra role');
select is(pg_temp.mailed('Site pass'), 'a3,a5', 'RR-MN-04 a non-medical expiry email still reaches the extra role');
select is((select count(*)::int from email_outbox where recipient_id = '20500000-0000-0000-0000-0000000000a5'
             and notification_id in (select id from notifications where title like 'Fitness check%')), 0,
  'RR-MN-03 no outbox row of the medical notice for the unrelated Engineer');

select * from finish();
rollback;
