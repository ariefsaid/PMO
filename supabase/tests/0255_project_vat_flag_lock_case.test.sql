-- 0255_project_vat_flag_lock_case.test.sql — #858 item 4: the VAT-flag lock matches an in-flight outbox row whatever the case of projectId.
begin;
select plan(2);

insert into organizations (id, name) values ('02550000-0000-0000-0000-000000000001','VAT Case Org');
insert into projects (id, org_id, name, status) values
  ('02550000-0000-0000-0000-0000000000b1','02550000-0000-0000-0000-000000000001','Upper-case in-flight','Leads'),
  ('02550000-0000-0000-0000-0000000000b2','02550000-0000-0000-0000-000000000001','Upper-case settled','Leads');
insert into external_command_outbox (org_id, domain, pmo_record_id, idempotency_key, external_tier, operation, state, payload) values
  ('02550000-0000-0000-0000-000000000001','revenue','si-up-flight','k-up-flight','erpnext','create','committing',
   '{"erp_doc_kind":"sales-invoice","projectId":"02550000-0000-0000-0000-0000000000B1","vat_flag_at_resolution":true}'),
  ('02550000-0000-0000-0000-000000000001','revenue','si-up-done','k-up-done','erpnext','create','confirmed',
   '{"erp_doc_kind":"sales-invoice","projectId":"02550000-0000-0000-0000-0000000000B2"}');

select throws_ok(
  $$ update public.projects set subject_to_vat = false where id = '02550000-0000-0000-0000-0000000000b1' $$,
  '42501', 'this project VAT setting is locked by its invoice state',
  'AC-858-4 an in-flight create with an upper-case projectId still locks the VAT flag');
select lives_ok(
  $$ update public.projects set subject_to_vat = false where id = '02550000-0000-0000-0000-0000000000b2' $$,
  'AC-858-4 a terminal outbox row with an upper-case projectId does not lock the VAT flag');

select * from finish();
rollback;
