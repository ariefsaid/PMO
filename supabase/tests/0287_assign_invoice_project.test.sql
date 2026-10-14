begin;
create extension if not exists pgtap;
select plan(28);

insert into public.organizations (id,name) values
  ('02870000-0000-0000-0000-000000000001','Project finance test org'),
  ('02870000-0000-0000-0000-000000000002','Foreign project finance test org');
insert into auth.users (id,email) values
  ('02870000-0000-0000-0000-0000000000a1','finance@example.test'),
  ('02870000-0000-0000-0000-0000000000a2','admin@example.test'),
  ('02870000-0000-0000-0000-0000000000a3','executive@example.test'),
  ('02870000-0000-0000-0000-0000000000a4','manager@example.test'),
  ('02870000-0000-0000-0000-0000000000a5','engineer@example.test');
insert into public.profiles (id,org_id,full_name,email,role,status) values
  ('02870000-0000-0000-0000-0000000000a1','02870000-0000-0000-0000-000000000001','Finance','finance@example.test','Finance','active'),
  ('02870000-0000-0000-0000-0000000000a2','02870000-0000-0000-0000-000000000001','Admin','admin@example.test','Admin','active'),
  ('02870000-0000-0000-0000-0000000000a3','02870000-0000-0000-0000-000000000001','Executive','executive@example.test','Executive','active'),
  ('02870000-0000-0000-0000-0000000000a4','02870000-0000-0000-0000-000000000001','Manager','manager@example.test','Project Manager','active'),
  ('02870000-0000-0000-0000-0000000000a5','02870000-0000-0000-0000-000000000001','Engineer','engineer@example.test','Engineer','active');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
  ('02870000-0000-0000-0000-0000000000d1','02870000-0000-0000-0000-000000000001','Project A','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'TEST-A'),
  ('02870000-0000-0000-0000-0000000000d2','02870000-0000-0000-0000-000000000001','Project B','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'TEST-B'),
  ('02870000-0000-0000-0000-0000000000d3','02870000-0000-0000-0000-000000000002','Foreign project','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'TEST-C');

select has_column('public','sales_invoices','erp_project','AC-PFIN-001 nullable ERP provenance is present');
select col_is_null('public','sales_invoices','erp_project','AC-PFIN-001 ERP provenance is nullable');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid='public.sales_invoices'::regclass),
          'AC-PFIN-007 sales invoice RLS remains enabled and forced');
select ok(not exists (select 1 from information_schema.columns where table_schema='public'
                       and table_name='incoming_payments' and column_name='project_id'),
          'AC-PFIN-005 receipts do not gain a project attribution column');
select ok(not exists (select 1 from pg_proc where oid = to_regprocedure('public.fill_sales_invoice_project(uuid,uuid,uuid,text)')),
          'AC-PFIN-007 machine fill is not exposed before its implementation');
select ok(not has_column_privilege('authenticated','public.sales_invoices','erp_project','UPDATE')
          and not has_column_privilege('authenticated','public.sales_invoices','erp_project','INSERT'),
          'AC-PFIN-007 authenticated cannot write ERP provenance');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus)
values ('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-000000000001',
        '02870000-0000-0000-0000-0000000000d1','SI-TEST','2026-01-01',10,'exclusive',0,'USD','Unpaid',1);
insert into public.external_domain_ownership (org_id,external_tier,domain)
values ('02870000-0000-0000-0000-000000000001','erpnext','revenue');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id)
values ('02870000-0000-0000-0000-000000000001','revenue','02870000-0000-0000-0000-0000000000e1','erpnext','SI-TEST');
insert into public.sales_invoices (id,org_id,project_id,si_number,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus,native_lines,pmo_native,author_user_id)
values ('02870000-0000-0000-0000-0000000000e2','02870000-0000-0000-0000-000000000001',null,
        null,'2026-01-01',10,'exclusive',0,'USD','Unpaid',null,'[{"description":"native"}]',true,'02870000-0000-0000-0000-0000000000a1'),
       ('02870000-0000-0000-0000-0000000000e3','02870000-0000-0000-0000-000000000001',null,
        'SI-AUTHORED','2026-01-01',10,'exclusive',0,'USD','Unpaid',1,null,false,'02870000-0000-0000-0000-0000000000a1');
insert into public.sales_invoice_authors (org_id,sales_invoice_id,user_id)
values ('02870000-0000-0000-0000-000000000001','02870000-0000-0000-0000-0000000000e3',
        '02870000-0000-0000-0000-0000000000a1');
update public.sales_invoices set project_id=null where id='02870000-0000-0000-0000-0000000000e1';
delete from public.record_changes where entity_type='sales_invoice' and entity_id='02870000-0000-0000-0000-0000000000e1';
create temp table before_assignment as
select to_jsonb(si)-'project_id' as row_data from public.sales_invoices si
where id='02870000-0000-0000-0000-0000000000e1';
grant select on before_assignment to authenticated;

set local role authenticated;
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a1","role":"authenticated"}';
select lives_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                'AC-PFIN-006 Finance can attribute an adopted ERP invoice');
select is((select project_id::text from public.sales_invoices where id='02870000-0000-0000-0000-0000000000e1'),
          '02870000-0000-0000-0000-0000000000d1','AC-PFIN-006 Finance assignment changes only the project link');
select is((select to_jsonb(si)-'project_id' from public.sales_invoices si where id='02870000-0000-0000-0000-0000000000e1'),
          (select row_data from before_assignment),'AC-PFIN-006 assignment preserves every non-project field');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select lives_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d2')$$,
                'AC-PFIN-006 Admin can correct an adopted ERP invoice');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a3","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                 '42501',null,'AC-PFIN-007 Executive cannot assign an invoice project');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a4","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                 '42501',null,'AC-PFIN-007 Project Manager cannot assign an invoice project');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a5","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                 '42501',null,'AC-PFIN-007 Engineer cannot assign an invoice project');
reset role;
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                 '42501',null,'AC-PFIN-007 anonymous role cannot assign an invoice project');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d3')$$,
                 'P0002',null,'AC-PFIN-007 foreign project is refused');
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000ff','02870000-0000-0000-0000-0000000000d1')$$,
                 'P0002',null,'AC-PFIN-007 foreign or missing invoice is refused');
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1',null)$$,
                 'P0002',null,'AC-PFIN-007 null project is refused');
set local request.jwt.claims='{"sub":"02870000-0000-0000-0000-0000000000a2","role":"authenticated"}';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e2','02870000-0000-0000-0000-0000000000d1')$$,
                 '23514',null,'AC-PFIN-007 native invoice is refused');
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e3','02870000-0000-0000-0000-0000000000d1')$$,
                 '23514',null,'AC-PFIN-007 PMO-authored ERP invoice is refused');
delete from public.external_refs where pmo_record_id='02870000-0000-0000-0000-0000000000e1';
select throws_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d1')$$,
                 '23514',null,'AC-PFIN-007 missing current ERP reference is refused');
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id)
values ('02870000-0000-0000-0000-000000000001','revenue','02870000-0000-0000-0000-0000000000e1','erpnext','SI-TEST');
create temp table before_noop as select to_jsonb(si) as row_data from public.sales_invoices si
where id='02870000-0000-0000-0000-0000000000e1';
grant select on before_noop to authenticated;
select lives_ok($$select public.assign_sales_invoice_project('02870000-0000-0000-0000-0000000000e1','02870000-0000-0000-0000-0000000000d2')$$,
                'AC-PFIN-006 repeated assignment to the same project succeeds');
select is((select to_jsonb(si) from public.sales_invoices si where id='02870000-0000-0000-0000-0000000000e1'),
          (select row_data from before_noop),'AC-PFIN-006 repeated assignment is a no-op');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='02870000-0000-0000-0000-0000000000e1' and op='update'),
          2,'AC-PFIN-008 two actual project changes create exactly two history events');
select is((select actor_id from public.record_changes where entity_type='sales_invoice'
            and entity_id='02870000-0000-0000-0000-0000000000e1' order by seq desc limit 1),
          '02870000-0000-0000-0000-0000000000a2'::uuid,'AC-PFIN-008 history retains the authenticated operator actor');
select is((select changes->'project_id' from public.record_changes where entity_type='sales_invoice'
            and entity_id='02870000-0000-0000-0000-0000000000e1' order by seq desc limit 1),
          '{"old":"02870000-0000-0000-0000-0000000000d1","new":"02870000-0000-0000-0000-0000000000d2"}'::jsonb,
          'AC-PFIN-008 latest event records old and new project references');
select is((select parent_id::text from public.record_changes where entity_type='sales_invoice'
            and entity_id='02870000-0000-0000-0000-0000000000e1' order by seq desc limit 1),
          '02870000-0000-0000-0000-0000000000d2','AC-PFIN-008 latest history parent is the new project');

select throws_ok($$update public.sales_invoices set project_id='02870000-0000-0000-0000-0000000000d3'
                  where id='02870000-0000-0000-0000-0000000000e1'$$,
                 'P0002','project not found','AC-PFIN-007 service-side project assignment enforces same-org target');
select is((select project_id::text from public.sales_invoices where id='02870000-0000-0000-0000-0000000000e1'),
          '02870000-0000-0000-0000-0000000000d2','AC-PFIN-007 rejected cross-org update leaves attribution unchanged');

select * from finish();
rollback;
