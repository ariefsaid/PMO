begin;
create extension if not exists pgtap;
select plan(11);

insert into public.organizations (id,name) values
 ('02900000-0000-0000-0000-000000000011','Project fill org'),
 ('02900000-0000-0000-0000-000000000012','Foreign fill org');
insert into public.projects (id,org_id,name,status,currency,contract_value,tax_treatment,tax_amount,tax_rate,
                             tax_base_numerator,tax_base_denominator,subject_to_vat,customer_contract_ref)
values
 ('02900000-0000-0000-0000-0000000000f1','02900000-0000-0000-0000-000000000011','Fill target','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'FILL-1'),
 ('02900000-0000-0000-0000-0000000000f2','02900000-0000-0000-0000-000000000012','Foreign target','Ongoing Project','USD',100,'exclusive',0,0,1,1,false,'FILL-2');
insert into public.sales_invoices (id,org_id,project_id,si_number,erp_project,invoice_date,amount,tax_treatment,tax_amount,
                                   currency,status,erp_docstatus)
values
 ('02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-000000000011',null,'SI-FILL-1','ERP-A','2026-01-01',10,'exclusive',0,'USD','Unpaid',1),
 ('02900000-0000-0000-0000-0000000000f4','02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f1','SI-FILL-2','ERP-A','2026-01-01',10,'exclusive',0,'USD','Unpaid',1),
 ('02900000-0000-0000-0000-0000000000f5','02900000-0000-0000-0000-000000000011',null,'SI-FILL-3','ERP-B','2026-01-01',10,'exclusive',0,'USD','Unpaid',1),
 ('02900000-0000-0000-0000-0000000000f6','02900000-0000-0000-0000-000000000011',null,'SI-FILL-4','ERP-A','2026-01-01',10,'exclusive',0,'USD','Unpaid',1);
insert into public.external_refs (org_id,domain,pmo_record_id,external_tier,external_record_id) values
 ('02900000-0000-0000-0000-000000000011','revenue','02900000-0000-0000-0000-0000000000f3','erpnext','SI-FILL-1'),
 ('02900000-0000-0000-0000-000000000011','revenue','02900000-0000-0000-0000-0000000000f4','erpnext','SI-FILL-2'),
 ('02900000-0000-0000-0000-000000000011','revenue','02900000-0000-0000-0000-0000000000f5','erpnext','SI-FILL-3');
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-0000000000f1','ERP-A'),true,
          'AC-PFIN-004 first service fill assigns an eligible unresolved invoice');
select is((select count(*)::int from public.record_changes where entity_type='sales_invoice'
            and entity_id='02900000-0000-0000-0000-0000000000f3' and op='update'),0,
          'AC-PFIN-008 machine attribution fill adds no operator history event');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-0000000000f1','ERP-A'),false,
          'AC-PFIN-004 repeated service fill is a no-op');
select is((select project_id::text from public.sales_invoices where id='02900000-0000-0000-0000-0000000000f4'),
          '02900000-0000-0000-0000-0000000000f1','AC-PFIN-003 existing operator attribution remains unchanged');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000012','02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-0000000000f2','ERP-A'),false,
          'AC-PFIN-004 wrong org cannot fill attribution');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-0000000000f2','ERP-A'),false,
          'AC-PFIN-004 foreign project cannot fill attribution');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f3','02900000-0000-0000-0000-0000000000f1','ERP-STALE'),false,
          'AC-PFIN-003 stale source provenance cannot fill attribution');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000f5','02900000-0000-0000-0000-0000000000f1','ERP-A'),false,
          'AC-PFIN-004 provenance mismatch cannot fill attribution');
select is(public.fill_sales_invoice_project('02900000-0000-0000-0000-000000000011','02900000-0000-0000-0000-0000000000ff','02900000-0000-0000-0000-0000000000f1','ERP-A'),false,
          'AC-PFIN-004 nonexistent invoice cannot fill attribution');
reset role;
select ok(not has_function_privilege('authenticated','public.fill_sales_invoice_project(uuid,uuid,uuid,text)','EXECUTE')
          and not has_function_privilege('anon','public.fill_sales_invoice_project(uuid,uuid,uuid,text)','EXECUTE'),
          'AC-PFIN-007 machine fill is not client executable');
select ok(position('SI.PROJECT_ID IS NULL' in upper(pg_get_functiondef('public.fill_sales_invoice_project(uuid,uuid,uuid,text)'::regprocedure))) > 0,
          'AC-PFIN-004 project_id NULL predicate is the atomic concurrency fence');
select * from finish();
rollback;
