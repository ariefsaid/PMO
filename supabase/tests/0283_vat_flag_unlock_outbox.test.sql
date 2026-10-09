begin;
select plan(35);
create function pg_temp.vat_change_outcome(p_project uuid) returns text language plpgsql as $$
declare v_state text; v_detail text;
begin
  perform set_config('request.jwt.claims','{"sub":"02831000-0000-0000-0000-0000000000a1","role":"authenticated"}',true);
  begin
    perform set_project_contract_value(p_project,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false);
    return 'success';
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate, v_detail=pg_exception_detail;
    return v_state||'|'||coalesce(v_detail,'');
  end;
end $$;
insert into organizations(id,name) values ('02831000-0000-0000-0000-000000000001','VAT witness org');
insert into auth.users(id,email) values ('02831000-0000-0000-0000-0000000000a1','vat-witness@example.com');
insert into profiles(id,org_id,full_name,email,role) values
 ('02831000-0000-0000-0000-0000000000a1','02831000-0000-0000-0000-000000000001','Witness','vat-witness@example.com','Finance');
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
delete from external_command_outbox where idempotency_key='witness-valid';
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
  values ('02831000-0000-0000-0000-000000000001','revenue','new-si-failed','witness-failed','erpnext','create','failed',
    '{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1"}');
select throws_ok(
  $$ update external_command_outbox set state='pending' where pmo_record_id='new-si-failed' $$,
  'P0001','invoice VAT context could not be verified',
  'AC-PPNC-015 failed command cannot revive without a valid VAT witness');
-- AC-PPNC-008: all operational SI verbs are blocked in each active outbox state.
do $$
declare
  v_state text;
  v_verb text;
  v_operation text;
  v_payload jsonb;
  v_project uuid;
  v_n integer := 0;
begin
  foreach v_state in array array['pending','committing','committed','quarantined','held'] loop
    foreach v_verb in array array['create','cancel','amend','update','submit'] loop
      v_n := v_n + 1;
      v_project := ('02831a00-0000-0000-0000-'||lpad(v_n::text,12,'0'))::uuid;
      v_operation := case when v_verb in ('create','update') then v_verb else 'transition' end;
      v_payload := jsonb_build_object('erp_doc_kind','sales-invoice','projectId',v_project::text);
      if v_state='pending' and v_verb='create' then v_payload := jsonb_set(v_payload,'{projectId}',to_jsonb(upper(v_project::text))); end if;
      if v_operation='transition' then v_payload := v_payload || jsonb_build_object('verb',v_verb); end if;
      if v_verb in ('create','update','amend') then v_payload := v_payload || '{"vat_flag_at_resolution":true}'::jsonb; end if;
      insert into projects(id,org_id,name,status) values (v_project,'02831000-0000-0000-0000-000000000001','Matrix '||v_n,'Leads');
      insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
        values ('02831000-0000-0000-0000-000000000001','revenue',
          'matrix-'||v_state||'-'||v_verb,'matrix-'||v_state||'-'||v_verb,'erpnext',v_operation,v_state,v_payload);
    end loop;
  end loop;
end $$;
select is(pg_temp.vat_change_outcome((payload->>'projectId')::uuid),'42501|vat-command-pending',
  'AC-PPNC-008 '||state||' SI '||substring(idempotency_key from 'matrix-[^-]+-(.*)')||' refuses the VAT change')
 from external_command_outbox where idempotency_key like 'matrix-%' order by idempotency_key;

-- AC-PPNC-008 identity associations work before a claim mirror and without projectId.
insert into progress_claims(id,org_id,project_id,kind,currency,gross_amount,created_by)
 values ('02831000-0000-0000-0000-0000000000c1','02831000-0000-0000-0000-000000000001',
         '02831000-0000-0000-0000-0000000000b1','progress','USD',100,'02831000-0000-0000-0000-0000000000a1');
insert into project_documents(id,org_id,project_id,category,title,author_id) values
 ('02831000-0000-0000-0000-0000000000c2','02831000-0000-0000-0000-000000000001',
  '02831000-0000-0000-0000-0000000000b1','Evidence','Claim evidence','02831000-0000-0000-0000-0000000000a1');
insert into progress_claim_evidence(org_id,claim_id,document_id,document_status,attached_by) values
 ('02831000-0000-0000-0000-000000000001','02831000-0000-0000-0000-0000000000c1',
  '02831000-0000-0000-0000-0000000000c2','Approved','02831000-0000-0000-0000-0000000000a1');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
 values ('02831000-0000-0000-0000-000000000001','revenue','02831000-0000-0000-0000-0000000000C1',
  'claim-no-mirror','erpnext','transition','pending',
  '{"erp_doc_kind":"sales-invoice","verb":"cancel","vat_flag_at_resolution":true}');
select is(pg_temp.vat_change_outcome('02831000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-command-pending',
 'AC-PPNC-008 claim pmo_record_id blocks before a mirror exists');
delete from external_command_outbox where idempotency_key='claim-no-mirror';

insert into sales_invoices(tax_treatment,tax_amount,id,org_id,project_id,si_number,invoice_date,amount,
 erp_outstanding_amount,status,erp_docstatus,author_user_id)
 values ('exclusive',0,'02831000-0000-0000-0000-0000000000d1','02831000-0000-0000-0000-000000000001',
 '02831000-0000-0000-0000-0000000000b1','SI-ASSOC','2026-10-01',100,0,'Cancelled',2,null);
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload)
 values ('02831000-0000-0000-0000-000000000001','revenue','02831000-0000-0000-0000-0000000000D1',
  'invoice-id-only','erpnext','transition','held','{"erp_doc_kind":"sales-invoice","verb":"submit"}');
select is(pg_temp.vat_change_outcome('02831000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-command-pending',
 'AC-PPNC-008 command without projectId associates through invoice pmo_record_id');
delete from external_command_outbox where idempotency_key='invoice-id-only';

insert into organizations(id,name) values ('02831000-0000-0000-0000-000000000002','Other org');
insert into projects(id,org_id,name,status) values
 ('02831000-0000-0000-0000-0000000000b2','02831000-0000-0000-0000-000000000001','Other project','Leads'),
 ('02831000-0000-0000-0000-0000000000b3','02831000-0000-0000-0000-000000000002','Foreign project','Leads');
insert into external_command_outbox(org_id,domain,pmo_record_id,idempotency_key,external_tier,operation,state,payload) values
 ('02831000-0000-0000-0000-000000000001','revenue','terminal-confirmed','unrelated-confirmed','erpnext','create','confirmed','{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1"}'),
 ('02831000-0000-0000-0000-000000000001','revenue','terminal-failed','unrelated-failed','erpnext','create','failed','{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b1"}'),
 ('02831000-0000-0000-0000-000000000001','revenue','incoming','incoming-flight','erpnext','create','pending','{"erp_doc_kind":"incoming-payment","projectId":"02831000-0000-0000-0000-0000000000b1"}'),
 ('02831000-0000-0000-0000-000000000001','revenue','other-project','other-project-flight','erpnext','create','held','{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b2","vat_flag_at_resolution":true}'),
 ('02831000-0000-0000-0000-000000000002','revenue','other-org','other-org-flight','erpnext','create','quarantined','{"erp_doc_kind":"sales-invoice","projectId":"02831000-0000-0000-0000-0000000000b3","vat_flag_at_resolution":true}');
set local role authenticated;
set local request.jwt.claims='{"sub":"02831000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok(
 $$ select set_project_contract_value('02831000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
 'AC-PPNC-009 terminal, incoming-payment, other-project and other-org commands do not block');
select is((select subject_to_vat from projects where id='02831000-0000-0000-0000-0000000000b1'),false,
 'AC-PPNC-009 eligible change commits despite unrelated commands');
select lives_ok(
 $$ select set_project_contract_value('02831000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 'AC-PPNC-009 project remains changeable with unrelated commands present');
select is((select subject_to_vat from projects where id='02831000-0000-0000-0000-0000000000b1'),true,
 'AC-PPNC-009 reverse change also succeeds');

select * from finish();
rollback;
