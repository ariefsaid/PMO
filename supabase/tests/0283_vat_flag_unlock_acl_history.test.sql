begin;
select plan(29);
create function pg_temp.vat_refusal_outcome(p_project uuid) returns text language plpgsql as $$
declare v_state text; v_detail text;
begin
  begin
    perform set_project_contract_value(p_project,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true);
    return 'success';
  exception when others then
    get stacked diagnostics v_state=returned_sqlstate,v_detail=pg_exception_detail;
    return v_state||'|'||coalesce(v_detail,'');
  end;
end $$;
insert into organizations(id,name) values
 ('02832000-0000-0000-0000-000000000001','VAT ACL org'),
 ('02832000-0000-0000-0000-000000000002','VAT other org');
insert into auth.users(id,email) values ('02832000-0000-0000-0000-0000000000a1','vat-acl@example.com');
insert into profiles(id,org_id,full_name,email,role) values
 ('02832000-0000-0000-0000-0000000000a1','02832000-0000-0000-0000-000000000001','Finance','vat-acl@example.com','Finance');
insert into projects(id,org_id,name,status) values
 ('02832000-0000-0000-0000-0000000000b1','02832000-0000-0000-0000-000000000001','VAT history','Leads');
select is(has_function_privilege('authenticated','public.get_project_vat_editability(uuid)','execute'),true,
 'AC-PPNC-019 authenticated members can call scoped eligibility reader');
select is(has_function_privilege('anon','public.get_project_vat_editability(uuid)','execute'),false,
 'AC-PPNC-010 anonymous callers cannot call the eligibility reader');
insert into auth.users(id,email) values
 ('02832000-0000-0000-0000-0000000000a2','vat-pm@example.com'),
 ('02832000-0000-0000-0000-0000000000a3','vat-exec@example.com'),
 ('02832000-0000-0000-0000-0000000000a4','vat-eng@example.com'),
 ('02832000-0000-0000-0000-0000000000a5','vat-inactive@example.com'),
 ('02832000-0000-0000-0000-0000000000b1','vat-other@example.com');
insert into profiles(id,org_id,full_name,email,role,status) values
 ('02832000-0000-0000-0000-0000000000a2','02832000-0000-0000-0000-000000000001','PM','vat-pm@example.com','Project Manager','active'),
 ('02832000-0000-0000-0000-0000000000a3','02832000-0000-0000-0000-000000000001','Exec','vat-exec@example.com','Executive','active'),
 ('02832000-0000-0000-0000-0000000000a4','02832000-0000-0000-0000-000000000001','Engineer','vat-eng@example.com','Engineer','active'),
 ('02832000-0000-0000-0000-0000000000a5','02832000-0000-0000-0000-000000000001','Inactive','vat-inactive@example.com','Finance','disabled'),
 ('02832000-0000-0000-0000-0000000000b1','02832000-0000-0000-0000-000000000002','Other','vat-other@example.com','Finance','active');
set local role authenticated;
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select get_project_vat_editability('02832000-0000-0000-0000-0000000000b1'::uuid) $$,
 '42501','not authorized','AC-PPNC-019 inactive member cannot read project VAT eligibility');
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select get_project_vat_editability('02832000-0000-0000-0000-0000000000b1'::uuid) $$,
 '42501','not authorized','AC-PPNC-019 wrong-org member cannot read project VAT eligibility');
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select set_project_contract_value('02832000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 'AC-PPNC-011 unchanged VAT flag save succeeds');
select is((select count(*) from record_changes where entity_type='project' and entity_id='02832000-0000-0000-0000-0000000000b1' and changes ? 'subject_to_vat'),0::bigint,
 'AC-PPNC-011 unchanged flag emits no VAT diff');
select is(get_project_vat_editability('02832000-0000-0000-0000-0000000000b1'),
  '{"eligible":true,"reason":null,"hasInvoices":false}'::jsonb,
  'AC-PPNC-019 reader exposes only eligibility, reason, and invoice presence');
select lives_ok($$ select set_project_contract_value('02832000-0000-0000-0000-0000000000b1'::uuid,100,
 p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>false) $$,
 'AC-PPNC-011 eligible Finance VAT change records successfully');
reset role;
select is((select count(*) from record_changes where entity_type='project' and entity_id='02832000-0000-0000-0000-0000000000b1'
 and changes ? 'subject_to_vat' and actor_id='02832000-0000-0000-0000-0000000000a1'),1::bigint,
 'AC-PPNC-011 successful VAT change records exactly one actor-attributed diff');
select ok((select created_at is not null and changes->'subject_to_vat'->>'old'='true'
 and changes->'subject_to_vat'->>'new'='false' from record_changes where entity_type='project'
 and entity_id='02832000-0000-0000-0000-0000000000b1' and changes ? 'subject_to_vat'),
 'AC-PPNC-011 VAT diff records old/new boolean and timestamp');

-- Each authorization refusal is checked against unchanged project/history facts.
select set_config('request.jwt.claims','{"sub":"02832000-0000-0000-0000-0000000000a2","role":"authenticated"}',true);
select is(pg_temp.vat_refusal_outcome('02832000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-role-forbidden','AC-PPNC-010 Project Manager is refused');
select is((select subject_to_vat from projects where id='02832000-0000-0000-0000-0000000000b1'),false,'AC-PPNC-010 PM refusal leaves project unchanged');
select set_config('request.jwt.claims','{"sub":"02832000-0000-0000-0000-0000000000a3","role":"authenticated"}',true);
select is(pg_temp.vat_refusal_outcome('02832000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-role-forbidden','AC-PPNC-010 Executive is refused');
select set_config('request.jwt.claims','{"sub":"02832000-0000-0000-0000-0000000000a4","role":"authenticated"}',true);
select is(pg_temp.vat_refusal_outcome('02832000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-role-forbidden','AC-PPNC-010 Engineer is refused');
select set_config('request.jwt.claims','{"sub":"02832000-0000-0000-0000-0000000000a5","role":"authenticated"}',true);
select is(pg_temp.vat_refusal_outcome('02832000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-not-authorized','AC-PPNC-010 inactive Finance member is refused');
select set_config('request.jwt.claims','{"sub":"02832000-0000-0000-0000-0000000000b1","role":"authenticated"}',true);
select is(pg_temp.vat_refusal_outcome('02832000-0000-0000-0000-0000000000b1'::uuid),'42501|vat-not-authorized','AC-PPNC-010 wrong-org Finance is refused');
reset role;
insert into sales_invoices(tax_treatment,tax_amount,id,org_id,project_id,si_number,invoice_date,amount,
 erp_outstanding_amount,status,erp_docstatus) values
 ('exclusive',25,'02832000-0000-0000-0000-0000000000e1','02832000-0000-0000-0000-000000000001',
  '02832000-0000-0000-0000-0000000000b1','SI-ACL-LIVE','2026-10-01',125,125,'Unpaid',1);
set local role authenticated;
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ select set_project_contract_value('02832000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 '42501','this project VAT setting is locked by its invoice state','AC-PPNC-011 failed VAT save is refused');
reset role;
select is((select count(*) from record_changes where entity_type='project' and entity_id='02832000-0000-0000-0000-0000000000b1' and changes ? 'subject_to_vat'),1::bigint,
 'AC-PPNC-011 failed save emits no additional VAT diff');
select is((select row(status,tax_amount,amount)::text from sales_invoices where id='02832000-0000-0000-0000-0000000000e1'),
 row('Unpaid',25.00::numeric,125.00::numeric)::text,'AC-PPNC-011 failed save leaves invoice facts unchanged');
select is((select count(*) from record_changes where entity_type='project' and entity_id='02832000-0000-0000-0000-0000000000b1' and changes ? 'subject_to_vat'),1::bigint,
 'AC-PPNC-010 role/member refusals leave VAT history unchanged');
select is((select subject_to_vat from projects where id='02832000-0000-0000-0000-0000000000b1'),false,
 'AC-PPNC-010 all role/member refusals leave project VAT unchanged');
select is((select count(*) from sales_invoices where project_id='02832000-0000-0000-0000-0000000000b1'),1::bigint,
 'AC-PPNC-010 role/member refusals leave invoice facts unchanged');
select is((select count(*) from external_command_outbox where org_id='02832000-0000-0000-0000-000000000001'),0::bigint,
 'AC-PPNC-010 role/member refusals leave outbox facts unchanged');
select is(has_column_privilege('authenticated','public.projects','subject_to_vat','update'),false,
 'AC-PPNC-010 direct VAT UPDATE remains unavailable');
set local role authenticated;
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update projects set subject_to_vat=true where id='02832000-0000-0000-0000-0000000000b1' $$,
 '42501','permission denied for table projects','AC-PPNC-010 authenticated direct UPDATE is refused');
reset role;
select is((select subject_to_vat from projects where id='02832000-0000-0000-0000-0000000000b1'),false,
 'AC-PPNC-010 direct UPDATE refusal leaves project unchanged');
select is((select count(*) from record_changes where entity_type='project' and entity_id='02832000-0000-0000-0000-0000000000b1' and changes ? 'subject_to_vat'),1::bigint,
 'AC-PPNC-010 direct UPDATE refusal leaves history unchanged');
set local role anon;
select throws_ok($$ select set_project_contract_value('02832000-0000-0000-0000-0000000000b1'::uuid,100,p_tax_treatment=>'exclusive',p_tax_amount=>0,p_subject_to_vat=>true) $$,
 '42501','permission denied for function set_project_contract_value','AC-PPNC-010 anon is refused at the grant boundary');
reset role;
select is((select subject_to_vat from projects where id='02832000-0000-0000-0000-0000000000b1'),false,
 'AC-PPNC-010 anon refusal leaves project unchanged');
select * from finish();
rollback;
