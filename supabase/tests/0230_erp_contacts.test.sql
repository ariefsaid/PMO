begin;
select plan(10);
select has_column('public','contacts','erp_modified','AC-CON-001 contacts retain the ERP source watermark');
insert into organizations (id,name) values ('02300000-0000-4000-8000-000000000001','Example Contact Org');
insert into auth.users(id,email) values ('02300000-0000-4000-8000-0000000000a1','contact-manager@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('02300000-0000-4000-8000-0000000000a1','02300000-0000-4000-8000-000000000001','Example Manager','contact-manager@example.test','Project Manager','active');
insert into companies(id,org_id,name,type) values ('02300000-0000-4000-8000-000000000101','02300000-0000-4000-8000-000000000001','Example Client','Client');
insert into contacts(id,org_id,company_id,full_name) values ('02300000-0000-4000-8000-000000000111','02300000-0000-4000-8000-000000000001','02300000-0000-4000-8000-000000000101','Example Contact');
insert into external_domain_ownership(org_id,external_tier,domain) values ('02300000-0000-4000-8000-000000000001','erpnext','companies');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$update contacts set erp_modified='2099-01-01' where id='02300000-0000-4000-8000-000000000111'$$,'42501','contact native fields are read-only while the parent companies domain is externally-owned','AC-CON-001 connected user cannot forge source watermark');
select lives_ok($$update contacts set notes='Example note' where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-003 enhancements remain editable');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update contacts set erp_modified='2026-10-05 10:00:00+00',full_name='Updated Contact' where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-001 service mirror advances source watermark');
select is((select erp_modified::text from contacts where id='02300000-0000-4000-8000-000000000111'),'2026-10-05 10:00:00+00','AC-CON-001 source watermark persisted');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-0','contact-key-0','erpnext','create','pending','{"erp_doc_kind":"contact"}');
select throws_ok($$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-0','company-key-0','erpnext','create','pending','{"erp_doc_kind":"customer"}')$$,'23505',null,
'AC-CON-003 shared party identity serializes contact/company commands while pending');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-1','contact-key-1','erpnext','create','committing','{"erp_doc_kind":"contact"}');
select throws_ok($$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-1','company-key-1','erpnext','create','pending','{"erp_doc_kind":"customer"}')$$,'23505',null,
'AC-CON-003 shared party identity serializes contact/company commands while committing');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-2','contact-key-2','erpnext','create','committed','{"erp_doc_kind":"contact"}');
select throws_ok($$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-2','company-key-2','erpnext','create','pending','{"erp_doc_kind":"customer"}')$$,'23505',null,
'AC-CON-003 shared party identity serializes contact/company commands while committed');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-3','contact-key-3','erpnext','create','quarantined','{"erp_doc_kind":"contact"}');
select throws_ok($$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-3','company-key-3','erpnext','create','pending','{"erp_doc_kind":"customer"}')$$,'23505',null,
'AC-CON-003 shared party identity serializes contact/company commands while quarantined');

insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-4','contact-key-4','erpnext','create','held','{"erp_doc_kind":"contact"}');
select throws_ok($$insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
values ('02300000-0000-4000-8000-000000000001','companies','synthetic-party-4','company-key-4','erpnext','create','pending','{"erp_doc_kind":"customer"}')$$,'23505',null,
'AC-CON-003 shared party identity serializes contact/company commands while held');
select * from finish();
rollback;
