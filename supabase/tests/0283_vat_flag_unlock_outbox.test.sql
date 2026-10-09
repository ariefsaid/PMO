begin;
select plan(4);
insert into organizations(id,name) values ('02831000-0000-0000-0000-000000000001','VAT witness org');
insert into projects(id,org_id,name,status) values ('02831000-0000-0000-0000-0000000000b1','02831000-0000-0000-0000-000000000001','Witness project','Leads');

select throws_ok(
  $$ insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
     values ('02831000-0000-0000-0000-000000000001','revenue','new-si-stale','witness-stale','erpnext','create','pending',
       '{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1","vat_flag_at_resolution":false}') $$,
  'P0001','project VAT changed before this invoice command could be sent',
  'AC-PPNC-015 stale VAT witness is refused before activation');
select lives_ok(
  $$ insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
     values ('02831000-0000-0000-0000-000000000001','revenue','new-si-valid','witness-valid','erpnext','create','pending',
       '{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1","vat_flag_at_resolution":true}') $$,
  'AC-PPNC-015 matching server VAT witness is accepted');
select throws_ok(
  $$ update projects set subject_to_vat=false where id='02831000-0000-0000-0000-0000000000b1' $$,
  '42501','this project VAT setting is locked by its invoice state',
  'AC-PPNC-008 an active associated SI command blocks VAT changes');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
  values ('02831000-0000-0000-0000-000000000001','revenue','new-si-failed','witness-failed','erpnext','create','failed',
    '{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1"}');
select throws_ok(
  $$ update external_command_outbox set state='pending' where pmo_record_id='new-si-failed' $$,
  'P0001','invoice VAT context could not be verified',
  'AC-PPNC-015 failed command cannot revive without a valid VAT witness');
select * from finish();
rollback;
