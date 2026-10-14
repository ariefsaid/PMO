begin;
create extension if not exists pgtap;
select plan(8);

insert into public.organizations (id,name) values
  ('02870000-0000-0000-0000-000000000001','Project finance test org'),
  ('02870000-0000-0000-0000-000000000002','Foreign project finance test org');
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
select throws_ok($$update public.sales_invoices set project_id='02870000-0000-0000-0000-0000000000d3'
                  where id='02870000-0000-0000-0000-0000000000e1'$$,
                 'P0002','project not found','AC-PFIN-007 service-side project assignment enforces same-org target');
select is((select project_id::text from public.sales_invoices where id='02870000-0000-0000-0000-0000000000e1'),
          '02870000-0000-0000-0000-0000000000d1','AC-PFIN-007 rejected cross-org update leaves attribution unchanged');

select * from finish();
rollback;
