-- Mutation: change 2384 medical_owner_email to v_plain; the exact duplicate-email assertion must fail.
begin;
create extension if not exists pgtap;
select plan(10);

insert into organizations (id, name, default_currency, default_timezone) values ('17600000-0000-0000-0000-00000000000a', 'EXM Org', 'IDR', 'UTC');
insert into auth.users (id, email) values
  ('17600000-0000-0000-0000-0000000000a1', 'exm-admin@example.com'),
  ('17600000-0000-0000-0000-0000000000a3', 'exm-mgr@example.com'),
  ('17600000-0000-0000-0000-0000000000a4', 'exm-worker@example.com'),
  ('17600000-0000-0000-0000-0000000000a5', 'exm-other@example.com'),
  ('17600000-0000-0000-0000-0000000000a6', 'exm-hr@example.com');
insert into profiles (id, org_id, full_name, email, role, status) values
  ('17600000-0000-0000-0000-0000000000a1', '17600000-0000-0000-0000-00000000000a', 'EXM Admin', 'exm-admin@example.com', 'Admin', 'active'),
  ('17600000-0000-0000-0000-0000000000a3', '17600000-0000-0000-0000-00000000000a', 'EXM Mgr', 'exm-mgr@example.com', 'Engineer', 'active'),
  ('17600000-0000-0000-0000-0000000000a4', '17600000-0000-0000-0000-00000000000a', 'EXM Worker', 'exm-worker@example.com', 'Engineer', 'active'),
  ('17600000-0000-0000-0000-0000000000a5', '17600000-0000-0000-0000-00000000000a', 'EXM Other', 'exm-other@example.com', 'Engineer', 'active');
insert into profiles (id, org_id, full_name, email, role, status, built_in_role) values
  ('17600000-0000-0000-0000-0000000000a6', '17600000-0000-0000-0000-00000000000a', 'EXM HR', 'exm-hr@example.com', 'Engineer', 'active', 'hr_officer');
insert into people (id, org_id, code, name, manager_id, profile_id) values
  ('17600000-0000-0000-0000-0000000000e1', '17600000-0000-0000-0000-00000000000a', 'X-1', 'Worker One', '17600000-0000-0000-0000-0000000000a3', '17600000-0000-0000-0000-0000000000a4'),
  ('17600000-0000-0000-0000-0000000000e2', '17600000-0000-0000-0000-00000000000a', 'X-2', 'Worker Two', '17600000-0000-0000-0000-0000000000a5', null);

update organizations set built_in_roles_enabled=true;
insert into document_types(id,org_id,name,applies_to,is_medical,notify_roles,notify_person) values('17600000-0000-0000-0000-0000000000f6','17600000-0000-0000-0000-00000000000a','Medical expiry','person',true,array['Project Manager'],false);
insert into expiry_documents(id,org_id,subject_kind,person_id,type_id,expires_on,medical_status) values('17600000-0000-0000-0000-0000000000c6','17600000-0000-0000-0000-00000000000a','person','17600000-0000-0000-0000-0000000000e1','17600000-0000-0000-0000-0000000000f6',current_date+7,'fit');
insert into email_event_settings(org_id,event_key,enabled,extra_roles) values('17600000-0000-0000-0000-00000000000a','document_expiry',true,array['Engineer','Admin']);
select run_document_expiry_warnings(current_date);
select ok(exists(select 1 from document_expiry_notices where recipient_id='17600000-0000-0000-0000-0000000000a6'),'AC-SITE-013 HR officer with medical right receives warning independent of access-level list');
select ok(exists(select 1 from document_expiry_notices where recipient_id='17600000-0000-0000-0000-0000000000a3'),'AC-SITE-013 direct manager receives warning');
select ok(not exists(select 1 from document_expiry_notices where recipient_id='17600000-0000-0000-0000-0000000000a5'),'AC-SITE-013 unrelated person without medical right receives nothing');
select is((select count(*) from (select o.recipient_id from email_outbox o join notifications n on n.id=o.notification_id where n.metadata->'entity'->>'id'='17600000-0000-0000-0000-0000000000c6' group by o.recipient_id having count(*)>1) duplicates),0::bigint,'AC-SITE-013 each medical recipient gets only one email even with matching extra roles');
select ok(not exists(select 1 from document_expiry_notices where recipient_id='17600000-0000-0000-0000-0000000000a4'),'AC-SR-005 medical expiry excludes worker before release');
select ok(exists(select 1 from notifications where owner_id='17600000-0000-0000-0000-0000000000a3' and metadata->'entity'->>'id' is null and metadata->>'email_owner_only'='true'),'AC-SR-005 manager receives plain owner-only notice');
select is(public.may_see_medical_documents('17600000-0000-0000-0000-0000000000a3'),false,'AC-SR-005 manager gains no medical document right');
insert into document_types(id,org_id,name,applies_to,is_medical,notify_roles,notify_person) values
 ('17600000-0000-0000-0000-0000000000f7','17600000-0000-0000-0000-00000000000a','Site badge','person',false,array['Admin'],false),
 ('17600000-0000-0000-0000-0000000000f8','17600000-0000-0000-0000-00000000000a','Employment contract','person',false,array['Admin'],true);
insert into expiry_documents(id,org_id,subject_kind,person_id,type_id,expires_on) values
 ('17600000-0000-0000-0000-0000000000c7','17600000-0000-0000-0000-00000000000a','person','17600000-0000-0000-0000-0000000000e1','17600000-0000-0000-0000-0000000000f7',current_date+7),
 ('17600000-0000-0000-0000-0000000000c8','17600000-0000-0000-0000-00000000000a','person','17600000-0000-0000-0000-0000000000e1','17600000-0000-0000-0000-0000000000f8',current_date+7);
select run_document_expiry_warnings(current_date);
select ok(not exists(select 1 from document_expiry_notices where document_id='17600000-0000-0000-0000-0000000000c7' and recipient_id='17600000-0000-0000-0000-0000000000a4'),'AC-SR-005 badge person switch off excludes worker');
select ok(exists(select 1 from document_expiry_notices where document_id='17600000-0000-0000-0000-0000000000c8' and recipient_id='17600000-0000-0000-0000-0000000000a4'),'AC-SR-005 other type person switch on still notifies worker');
select ok(exists(select 1 from document_expiry_notices where document_id='17600000-0000-0000-0000-0000000000c7' and recipient_id='17600000-0000-0000-0000-0000000000a3'),'AC-SR-005 badge still warns manager');
select * from finish(); rollback;
