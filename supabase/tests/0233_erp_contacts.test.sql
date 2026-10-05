begin;
select plan(25);
select has_column('public','contacts','erp_modified','AC-CON-001 contacts retain the ERP source watermark');
insert into organizations (id,name) values ('02300000-0000-4000-8000-000000000001','Example Contact Org');
insert into auth.users(id,email) values ('02300000-0000-4000-8000-0000000000a1','contact-manager@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('02300000-0000-4000-8000-0000000000a1','02300000-0000-4000-8000-000000000001','Example Manager','contact-manager@example.test','Project Manager','active');
insert into companies(id,org_id,name,type) values ('02300000-0000-4000-8000-000000000101','02300000-0000-4000-8000-000000000001','Example Client','Client');
insert into contacts(id,org_id,company_id,full_name) values ('02300000-0000-4000-8000-000000000111','02300000-0000-4000-8000-000000000001','02300000-0000-4000-8000-000000000101','Example Contact');
insert into external_domain_ownership(org_id,external_tier,domain) values ('02300000-0000-4000-8000-000000000001','erpnext','companies');
insert into auth.users(id,email) values ('02300000-0000-4000-8000-0000000000a2','contact-admin@example.test');
insert into profiles(id,org_id,full_name,email,role,status) values ('02300000-0000-4000-8000-0000000000a2','02300000-0000-4000-8000-000000000001','Example Admin','contact-admin@example.test','Admin','active');
insert into companies(id,org_id,name,type) values ('02300000-0000-4000-8000-000000000102','02300000-0000-4000-8000-000000000001','Example Vendor','Vendor');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02300000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$update contacts set erp_modified='2099-01-01' where id='02300000-0000-4000-8000-000000000111'$$,'42501','contact native fields are read-only while the parent companies domain is externally-owned','AC-CON-001 connected user cannot forge source watermark');
select lives_ok($$update contacts set notes='Example note' where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-003 enhancements remain editable');
select throws_ok($$update contacts set company_id='02300000-0000-4000-8000-000000000102' where id='02300000-0000-4000-8000-000000000111'$$,'42501','contact native fields are read-only while the parent companies domain is externally-owned','AC-CON-001 connected parent identity stays owned by ERP');
select lives_ok($$update contacts set title='Example role',archived_at=now() where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-003 title and soft archive remain enhancements');
set local request.jwt.claims = '{"sub":"02300000-0000-4000-8000-0000000000a2","role":"authenticated"}';
with deleted as (delete from contacts where id='02300000-0000-4000-8000-000000000111' returning id) select is((select count(*) from deleted),0::bigint,'AC-CON-001 connected admin cannot delete externally owned existence');
select is((select company_id::text from contacts where id='02300000-0000-4000-8000-000000000111'),'02300000-0000-4000-8000-000000000101','AC-CON-001 denied parent/existence mutations preserve original mirror');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$update contacts set erp_modified='2026-10-05 10:00:00+00',full_name='Updated Contact' where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-001 service mirror advances source watermark');
select is((select erp_modified::text from contacts where id='02300000-0000-4000-8000-000000000111'),'2026-10-05 10:00:00+00','AC-CON-001 source watermark persisted');

select lives_ok($$update contacts set company_id='02300000-0000-4000-8000-000000000102' where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-001 service mirror can reconcile ERP parent');
select is((select company_id::text from contacts where id='02300000-0000-4000-8000-000000000111'),'02300000-0000-4000-8000-000000000102','AC-CON-001 service parent persisted');
select lives_ok($$delete from contacts where id='02300000-0000-4000-8000-000000000111'$$,'AC-CON-001 service retains controlled mirror existence');
reset role;
delete from external_domain_ownership where org_id='02300000-0000-4000-8000-000000000001' and domain='companies';
insert into contacts(id,org_id,company_id,full_name) values ('02300000-0000-4000-8000-000000000112','02300000-0000-4000-8000-000000000001','02300000-0000-4000-8000-000000000101','Standalone Contact');
set local role authenticated;
set local request.jwt.claims = '{"sub":"02300000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select lives_ok($$update contacts set company_id='02300000-0000-4000-8000-000000000102',full_name='Standalone Update' where id='02300000-0000-4000-8000-000000000112'$$,'AC-CON-003 standalone native updates remain writable');
with deleted as (delete from contacts where id='02300000-0000-4000-8000-000000000112' returning id) select is((select count(*) from deleted),1::bigint,'AC-CON-003 standalone admin retains hard delete');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(has_table_privilege('authenticated','public.contacts','UPDATE,DELETE'),'AC-CON-001 authenticated contact mutation grants are reachable');

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
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,claim_generation)
values ('02300000-0000-4000-8000-000000000301','02300000-0000-4000-8000-000000000001','companies','contact-ref-proof','contact-ref-key','erpnext','create','committed','{"erp_doc_kind":"contact"}',1);
select is(record_outbox_ref('02300000-0000-4000-8000-000000000301',1,'companies','contact-ref-proof','erpnext','Contact:REF-1'),1,'AC-CON-003 create inserts Contact identity');
select is(record_outbox_ref('02300000-0000-4000-8000-000000000301',1,'companies','contact-ref-proof','erpnext','Contact:REF-1'),1,'AC-CON-003 same command finalization replays identical identity');
select throws_ok($$select record_outbox_ref('02300000-0000-4000-8000-000000000301',1,'companies','contact-ref-proof','erpnext','Contact:REF-2')$$,'23505','Contact mapping identity conflict','AC-CON-003 Contact create reference recording keeps existing identity');
select is((select external_record_id from external_refs where pmo_record_id='contact-ref-proof'),'Contact:REF-1','AC-CON-003 refused Contact reference write preserves mapping');
insert into external_command_outbox(id,org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload,claim_generation)
values ('02300000-0000-4000-8000-000000000302','02300000-0000-4000-8000-000000000001','companies','customer-ref-proof','customer-ref-key','erpnext','create','committed','{"erp_doc_kind":"customer"}',1);
select record_outbox_ref('02300000-0000-4000-8000-000000000302',1,'companies','customer-ref-proof','erpnext','Customer:REF-1');
select record_outbox_ref('02300000-0000-4000-8000-000000000302',1,'companies','customer-ref-proof','erpnext','Customer:REF-2');
select is((select external_record_id from external_refs where pmo_record_id='customer-ref-proof'),'Customer:REF-2','AC-CON-003 neighboring party reference semantics preserved');
select * from finish();
rollback;
