begin;
select plan(5);
insert into organizations(id,name) values ('02832000-0000-0000-0000-000000000001','VAT ACL org');
insert into auth.users(id,email) values ('02832000-0000-0000-0000-0000000000a1','vat-acl@example.com');
insert into profiles(id,org_id,full_name,email,role) values
 ('02832000-0000-0000-0000-0000000000a1','02832000-0000-0000-0000-000000000001','Finance','vat-acl@example.com','Finance');
insert into projects(id,org_id,name,status) values
 ('02832000-0000-0000-0000-0000000000b1','02832000-0000-0000-0000-000000000001','VAT history','Leads');
select is(has_function_privilege('authenticated','public.get_project_vat_editability(uuid)','execute'),true,
 'AC-PPNC-019 authenticated members can call scoped eligibility reader');
select is(has_function_privilege('anon','public.get_project_vat_editability(uuid)','execute'),false,
 'AC-PPNC-010 anonymous callers cannot call the eligibility reader');
set local role authenticated;
set local request.jwt.claims='{"sub":"02832000-0000-0000-0000-0000000000a1","role":"authenticated"}';
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
select * from finish();
rollback;
